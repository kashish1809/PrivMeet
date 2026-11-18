//! Who spoke when: sherpa-onnx (pyannote segmentation + speaker embeddings) through sherpa-rs,
//! a port of backend/meetings/pipeline/diarize.py with the same models, threshold and fixes.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};

use sherpa_rs::diarize::{Diarize, DiarizeConfig};

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

/// Speaker turns [(start, end, speaker)] sorted by start time.
pub fn diarize(samples: Vec<f32>, models_dir: &Path, threads: i64, on_progress: &dyn Fn(f64)) -> Result<Vec<(f64, f64, i64)>, String> {
    let (seg, emb) = model_paths(models_dir);
    let n = forced_speakers();
    let config = DiarizeConfig {
        num_clusters: Some(if n > 0 { n } else { -1 }),
        threshold: Some(threshold()),
        min_duration_on: Some(0.0),
        min_duration_off: Some(0.0),
        provider: Some("cpu".into()),
        debug: false,
    };
    // shortcut: sherpa-rs takes its thread count from the provider defaults, not `threads`;
    // upgrade when sherpa-rs exposes num_threads on DiarizeConfig.
    let _ = threads;
    let mut sd = Diarize::new(&seg, &emb, config).map_err(|e| format!("Cannot load the diarization models: {e}"))?;
    let pct = std::sync::Arc::new(std::sync::atomic::AtomicI32::new(0));
    let seen = pct.clone();
    let cb = Box::new(move |done: i32, total: i32| {
        seen.store(if total > 0 { 100 * done / total } else { 0 }, std::sync::atomic::Ordering::Relaxed);
        0 // 0 = keep going
    });
    let mut turns: Vec<(f64, f64, i64)> = crate::stt::with_progress(&pct, on_progress, || sd.compute(samples, Some(cb)))
        .map_err(|e| format!("Diarization failed: {e}"))?
        .into_iter()
        .map(|s| (s.start as f64, s.end as f64, s.speaker as i64))
        .collect();
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
