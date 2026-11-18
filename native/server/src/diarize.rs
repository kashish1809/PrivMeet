//! Who spoke when: sherpa-onnx (pyannote segmentation + speaker embeddings) through sherpa-rs,
//! a port of backend/meetings/pipeline/diarize.py with the same models, threshold and fixes.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};

use std::ffi::{c_void, CString};

use crate::meetings::Segment;

/// Higher = fewer speakers. 0.5 split one narrator into ~13 voices; 0.8 matched the cast.
fn threshold() -> f32 {
    std::env::var("DIARIZE_THRESHOLD").ok().and_then(|v| v.parse().ok()).unwrap_or(0.8)
}

/// DIARIZE_SPEAKERS forces the number of speakers; 0 means detect.
fn forced_speakers() -> i32 {
    std::env::var("DIARIZE_SPEAKERS").ok().and_then(|v| v.parse().ok()).unwrap_or(0)
}

/// DIARIZE_MODELS_DIR, else MODELS_DIR/diarize (settings.py).
pub fn models_dir(models_dir: &Path) -> PathBuf {
    std::env::var("DIARIZE_MODELS_DIR").map(PathBuf::from).unwrap_or_else(|_| models_dir.join("diarize"))
}

pub fn model_paths(models_dir: &Path) -> (PathBuf, PathBuf) {
    let d = self::models_dir(models_dir);
    (d.join("segmentation.onnx"), d.join("embedding.onnx"))
}

pub fn available(models_dir: &Path) -> bool {
    let (a, b) = model_paths(models_dir);
    a.is_file() && b.is_file()
}

/// The progress closure behind sherpa-onnx's C callback: (chunks done, chunks total) -> 0 to go on.
type Progress = Box<dyn Fn(i32, i32) -> i32 + Send>;

unsafe extern "C" fn progress_trampoline(done: i32, total: i32, arg: *mut c_void) -> i32 {
    // SAFETY: `arg` is the &mut Progress passed to ProcessWithCallback below, alive for the call
    let cb = unsafe { &*(arg as *const Progress) };
    cb(done, total)
}

/// Speaker turns [(start, end, speaker)] sorted by start time.
///
/// Calls sherpa-onnx's C API directly: sherpa-rs's Diarize::new hard-codes one thread for the
/// segmentation and embedding models, which made diarization the slowest stage (R1.22).
pub fn diarize(samples: Vec<f32>, models_dir: &Path, threads: i64, on_progress: &(dyn Fn(f64) + Sync)) -> Result<Vec<(f64, f64, i64)>, String> {
    use sherpa_rs_sys as sys;
    let (seg, emb) = model_paths(models_dir);
    let n = forced_speakers();
    let cstr = |p: &Path| CString::new(p.to_string_lossy().as_bytes()).map_err(|e| e.to_string());
    let (seg, emb, provider) = (cstr(&seg)?, cstr(&emb)?, CString::new("cpu").unwrap());
    let threads = threads.clamp(1, 64) as i32;
    let config = sys::SherpaOnnxOfflineSpeakerDiarizationConfig {
        segmentation: sys::SherpaOnnxOfflineSpeakerSegmentationModelConfig {
            pyannote: sys::SherpaOnnxOfflineSpeakerSegmentationPyannoteModelConfig { model: seg.as_ptr() },
            num_threads: threads,
            debug: 0,
            provider: provider.as_ptr(),
        },
        embedding: sys::SherpaOnnxSpeakerEmbeddingExtractorConfig { model: emb.as_ptr(), num_threads: threads, debug: 0, provider: provider.as_ptr() },
        clustering: sys::SherpaOnnxFastClusteringConfig { num_clusters: if n > 0 { n } else { -1 }, threshold: threshold() },
        min_duration_on: 0.0,
        min_duration_off: 0.0,
    };
    let t0 = std::time::Instant::now();
    // SAFETY: every pointer in `config` points into a CString that outlives this call
    let sd = unsafe { sys::SherpaOnnxCreateOfflineSpeakerDiarization(&config) };
    if sd.is_null() {
        return Err("Cannot load the diarization models.".into());
    }
    let pct = std::sync::Arc::new(std::sync::atomic::AtomicI32::new(0));
    let seen = pct.clone();
    let cb: Progress = Box::new(move |done: i32, total: i32| {
        seen.store(if total > 0 { 100 * done / total } else { 0 }, std::sync::atomic::Ordering::Relaxed);
        i32::from(crate::pipeline::cancelled()) // 0 = keep going, 1 = stop (POST .../cancel)
    });
    let run = || -> Result<Vec<(f64, f64, i64)>, String> {
        // SAFETY: `sd` is valid until destroyed below; `samples` and `cb` outlive the call; the
        // result and its segment array are read, then freed with their own destroy functions
        unsafe {
            let result = sys::SherpaOnnxOfflineSpeakerDiarizationProcessWithCallback(
                sd,
                samples.as_ptr(),
                samples.len() as i32,
                Some(progress_trampoline),
                &cb as *const Progress as *mut c_void,
            );
            if result.is_null() {
                return Err(if crate::pipeline::cancelled() { crate::meetings::CANCELLED.into() } else { "Diarization failed.".into() });
            }
            let count = sys::SherpaOnnxOfflineSpeakerDiarizationResultGetNumSegments(result).max(0) as usize;
            let ptr = sys::SherpaOnnxOfflineSpeakerDiarizationResultSortByStartTime(result);
            let turns = if ptr.is_null() || count == 0 {
                vec![]
            } else {
                std::slice::from_raw_parts(ptr, count).iter().map(|s| (s.start as f64, s.end as f64, s.speaker as i64)).collect()
            };
            if !ptr.is_null() {
                sys::SherpaOnnxOfflineSpeakerDiarizationDestroySegment(ptr);
            }
            sys::SherpaOnnxOfflineSpeakerDiarizationDestroyResult(result);
            Ok(turns)
        }
    };
    let loaded = t0.elapsed().as_secs_f64();
    let out = crate::stt::with_progress(&pct, on_progress, run);
    eprintln!("diarization: models loaded in {loaded:.1} s, {:.1} s of audio in {:.1} s on {threads} threads", samples.len() as f64 / 16000.0, t0.elapsed().as_secs_f64() - loaded);
    // SAFETY: created above, used by nothing after this
    unsafe { sys::SherpaOnnxDestroyOfflineSpeakerDiarization(sd) };
    let mut turns = out.map_err(|e| format!("Diarization failed: {e}"))?;
    turns.sort_by(|a, b| a.0.total_cmp(&b.0));
    Ok(turns)
}

/// A cluster this small is a fragment of a real speaker (bug B7): at most 30 s and 10 % of
/// the talk, and every piece of it flanked by the same one other speaker.
const STRAY_MAX_SECONDS: f64 = 30.0;
const STRAY_MAX_SHARE: f64 = 0.1;

fn talk_time(segs: &[Segment]) -> HashMap<i64, f64> {
    let mut t = HashMap::new();
    for s in segs {
        if let Some(k) = s.speaker {
            *t.entry(k).or_insert(0.0) += (s.end - s.start).max(0.0);
        }
    }
    t
}

fn neighbours(segs: &[Segment], speaker: i64) -> HashSet<i64> {
    let labelled: Vec<i64> = segs.iter().filter_map(|s| s.speaker).collect();
    let mut around = HashSet::new();
    for (i, k) in labelled.iter().enumerate() {
        if *k != speaker {
            continue;
        }
        for j in [i.wrapping_sub(1), i + 1] {
            if let Some(o) = labelled.get(j).filter(|o| **o != speaker) {
                around.insert(*o);
            }
        }
    }
    around
}

/// Fold a tiny speaker surrounded by one other speaker back into it.
pub fn merge_strays(segs: &mut [Segment]) {
    let mut totals = talk_time(segs);
    if totals.len() < 2 {
        return;
    }
    let overall: f64 = totals.values().sum::<f64>().max(1e-9);
    let mut order: Vec<i64> = totals.keys().copied().collect();
    order.sort_by(|a, b| totals[a].total_cmp(&totals[b])); // smallest first
    for speaker in order {
        if !totals.contains_key(&speaker) || totals.len() < 2 {
            continue;
        }
        if totals[&speaker] > STRAY_MAX_SECONDS || totals[&speaker] / overall > STRAY_MAX_SHARE {
            continue;
        }
        let around = neighbours(segs, speaker);
        if around.len() != 1 {
            continue;
        }
        let host = *around.iter().next().unwrap();
        for s in segs.iter_mut().filter(|s| s.speaker == Some(speaker)) {
            s.speaker = Some(host);
        }
        let moved = totals.remove(&speaker).unwrap_or(0.0);
        *totals.entry(host).or_insert(0.0) += moved;
    }
}

/// Renumber speakers 0..n-1 by first appearance ("Speaker 1, 2, 3", not "1, 4, 12").
pub fn renumber(segs: &mut [Segment]) {
    let mut order: BTreeMap<i64, i64> = BTreeMap::new();
    let mut next = 0;
    for s in segs.iter_mut() {
        if let Some(k) = s.speaker {
            let n = *order.entry(k).or_insert_with(|| {
                next += 1;
                next - 1
            });
            s.speaker = Some(n);
        }
    }
}

/// Give each transcript segment the speaker whose turns overlap it the most.
pub fn assign_speakers(segs: &mut [Segment], turns: &[(f64, f64, i64)]) {
    for s in segs.iter_mut() {
        let mut overlap: HashMap<i64, f64> = HashMap::new();
        for (a, b, k) in turns {
            if *a >= s.end {
                break;
            }
            let o = s.end.min(*b) - s.start.max(*a);
            if o > 0.0 {
                *overlap.entry(*k).or_insert(0.0) += o;
            }
        }
        s.speaker = overlap.into_iter().max_by(|a, b| a.1.total_cmp(&b.1)).map(|(k, _)| k);
    }
    merge_strays(segs);
    renumber(segs);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(a: f64, b: f64) -> Segment {
        Segment { id: 0, start: a, end: b, speaker: None, text: String::new() }
    }

    #[test]
    fn assigns_merges_and_renumbers() {
        // speaker 7 talks 0-60 and 61-120, speaker 3 has a 1 s fragment in the middle, speaker 9 talks after
        let turns = vec![(0.0, 60.0, 7), (60.0, 61.0, 3), (61.0, 120.0, 7), (120.0, 200.0, 9)];
        let mut segs = vec![seg(0.0, 60.0), seg(60.0, 61.0), seg(61.0, 120.0), seg(125.0, 190.0), seg(300.0, 301.0)];
        assign_speakers(&mut segs, &turns);
        let got: Vec<Option<i64>> = segs.iter().map(|s| s.speaker).collect();
        assert_eq!(got, vec![Some(0), Some(0), Some(0), Some(1), None]);
    }
}
