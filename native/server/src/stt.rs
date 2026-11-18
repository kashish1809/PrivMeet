//! Speech to text: whisper.cpp on this machine (whisper-rs), or the provider's
//! /audio/transcriptions in cloud mode. A port of backend/meetings/pipeline/transcribe.py.

use std::path::{Path, PathBuf};

use whisper_rs::{get_lang_str_full, FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::hw::{self, Profile};
use crate::{audio, providers};

#[derive(Clone, Debug)]
pub struct Seg {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

/// What the upload asked for: a language ("" = detect) and whether to translate into English.
#[derive(Clone, Copy, Default)]
pub struct Lang<'a> {
    pub hint: &'a str,
    pub translate: bool,
}

pub struct Info {
    pub duration: f64,
    pub language: String,
}

/// A segment shorter than this holds no speech: Whisper writes lines into trailing silence.
const MIN_SECONDS: f64 = 0.2;
const FILLER: &[&str] = &[
    "thank you", "thanks", "thank you very much", "thanks for watching", "thank you for watching", "bye", "you",
    "okay", "ok", "subtitles by the amaraorg community",
];
const FILLER_MAX_SECONDS: f64 = 2.0;
const FILLER_MIN_GAP: f64 = 3.0;

fn is_filler(text: &str) -> bool {
    let t: String = text.trim().to_lowercase().chars().filter(|c| c.is_alphanumeric() || *c == '_' || *c == ' ').collect();
    FILLER.contains(&t.trim())
}

/// Drop what Whisper writes into silence: a segment too short to hold speech, and a lone
/// filler line ("Thank you.") stranded at the end after a gap. A real one mid-meeting stays.
pub fn clean(segments: Vec<Seg>) -> Vec<Seg> {
    let mut kept: Vec<Seg> = segments.into_iter().filter(|s| s.end - s.start >= MIN_SECONDS).collect();
    while let Some(last) = kept.last() {
        let gap = if kept.len() > 1 { last.start - kept[kept.len() - 2].end } else { 0.0 };
        if is_filler(&last.text) && last.end - last.start <= FILLER_MAX_SECONDS && (gap >= FILLER_MIN_GAP || kept.len() == 1) {
            kept.pop();
            continue;
        }
        break;
    }
    kept
}

/// The cloud model when the account offers no choice.
pub fn asr_model(p: &Profile) -> String {
    p.cloud_transcribe_model.clone().filter(|m| !m.is_empty()).unwrap_or_else(|| match p.llm_provider.as_str() {
        "groq" => "whisper-large-v3-turbo".into(),
        _ => "whisper-1".into(),
    })
}

/// Where a whisper.cpp model lives, downloaded on first use from the whisper.cpp project.
pub fn model_path(models_dir: &Path, name: &str) -> PathBuf {
    models_dir.join("whisper-cpp").join(format!("ggml-{name}.bin"))
}

/// Sizes whisper.cpp publishes as 8-bit weights. The int8 file decodes ~25 % faster on a
/// laptop CPU than the 16-bit one, with WER within 0.3 points on the test meeting (R1.22),
/// and is half the download; faster-whisper ran int8 too. large-v3 has no 8-bit file.
const Q8: &[&str] = &["tiny", "base", "small", "medium", "large-v3-turbo"];

/// The file local transcription prefers for a model name: its 8-bit version when one exists.
pub fn preferred_name(name: &str) -> String {
    if Q8.contains(&name) { format!("{name}-q8_0") } else { name.to_string() }
}

/// Whether a model is ready to use without a download (either file).
pub fn downloaded(models_dir: &Path, name: &str) -> bool {
    model_path(models_dir, &preferred_name(name)).is_file() || model_path(models_dir, name).is_file()
}

/// The model file for `name`: the 8-bit one, downloaded when missing; the full one when that
/// download fails (offline) but the full file is here from before.
pub fn ensure_model(models_dir: &Path, name: &str) -> Result<PathBuf, String> {
    let fast = preferred_name(name);
    if fast == name {
        return fetch_model(models_dir, name);
    }
    match fetch_model(models_dir, &fast) {
        Ok(p) => Ok(p),
        Err(e) if model_path(models_dir, name).is_file() => {
            eprintln!("{e}; using ggml-{name}.bin");
            Ok(model_path(models_dir, name))
        }
        Err(e) => Err(e),
    }
}

fn fetch_model(models_dir: &Path, name: &str) -> Result<PathBuf, String> {
    if !crate::settings::is_model_name(name) {
        return Err(format!("{name} is not a Whisper model name."));
    }
    let url = format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{name}.bin");
    download(&model_path(models_dir, name), &url, &format!("the Whisper model {name}"))
}

/// Silero voice activity detection for whisper.cpp: Whisper then decodes only the speech, as
/// faster-whisper's vad_filter did. Under 1 MB, fetched on first use like the Whisper models.
pub fn ensure_vad_model(models_dir: &Path) -> Result<PathBuf, String> {
    let path = models_dir.join("whisper-cpp").join("ggml-silero-v5.1.2.bin");
    download(&path, "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin", "the voice activity model")
}

/// `path`, downloaded from `url` first when it is not there yet (a .part file, then a rename).
fn download(path: &Path, url: &str, what: &str) -> Result<PathBuf, String> {
    if path.is_file() {
        return Ok(path.to_path_buf());
    }
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    eprintln!("downloading {what} from {url}");
    let mut resp = reqwest::blocking::Client::builder()
        .user_agent(providers::USER_AGENT)
        .timeout(std::time::Duration::from_secs(3 * 3600))
        .build()
        .map_err(|e| e.to_string())?
        .get(url)
        .send()
        .map_err(|e| format!("Could not download {what}: {}", e.without_url()))?;
    if !resp.status().is_success() {
        return Err(format!("Could not download {what}: HTTP {}", resp.status().as_u16()));
    }
    let part = path.with_extension("bin.part");
    let mut file = std::fs::File::create(&part).map_err(|e| e.to_string())?;
    resp.copy_to(&mut file).map_err(|e| format!("Download of {what} broke off: {e}"))?;
    std::fs::rename(&part, path).map_err(|e| e.to_string())?;
    Ok(path.to_path_buf())
}

/// The speech of a recording glued together, and where each piece came from, so Whisper's
/// timestamps on the glued audio map back to the recording.
pub struct Speech {
    pub samples: Vec<f32>,
    /// (start in the glued audio, start in the recording, length), seconds
    pub pieces: Vec<(f64, f64, f64)>,
}

/// Padding kept around speech, and the silence put between glued pieces (as whisper.cpp does).
const SPEECH_PAD: f64 = 0.2;
const GAP: f64 = 0.1;
/// Pieces closer than this are joined: a short pause stays in, so no word is cut.
const JOIN_UNDER: f64 = 1.0;

impl Speech {
    /// Glue the regions [(start, end)] (seconds) of `all`, padded and joined.
    pub fn glue(all: &[f32], regions: &[(f64, f64)]) -> Self {
        let total = all.len() as f64 / 16000.0;
        let mut joined: Vec<(f64, f64)> = Vec::new();
        for &(a, b) in regions {
            let (a, b) = ((a - SPEECH_PAD).max(0.0), (b + SPEECH_PAD).min(total));
            match joined.last_mut() {
                Some(last) if a - last.1 < JOIN_UNDER => last.1 = last.1.max(b),
                _ if b > a => joined.push((a, b)),
                _ => {}
            }
        }
        let (mut samples, mut pieces) = (Vec::new(), Vec::new());
        for (i, (a, b)) in joined.into_iter().enumerate() {
            if i > 0 {
                samples.extend(std::iter::repeat_n(0.0f32, (GAP * 16000.0) as usize));
            }
            let (from, to) = ((a * 16000.0) as usize, ((b * 16000.0) as usize).min(all.len()));
            pieces.push((samples.len() as f64 / 16000.0, a, (to - from) as f64 / 16000.0));
            samples.extend_from_slice(&all[from..to]);
        }
        Speech { samples, pieces }
    }

    /// A time in the glued audio as a time in the recording.
    pub fn original(&self, t: f64) -> f64 {
        let i = self.pieces.iter().rposition(|p| p.0 <= t).unwrap_or(0);
        let Some(&(glued, orig, len)) = self.pieces.get(i) else { return t };
        orig + (t - glued).clamp(0.0, len)
    }
}

/// Speech regions by Silero VAD, glued: Whisper then decodes only the speech, as faster-whisper's
/// vad_filter did, and silence costs nothing (a 47 min silent demo took minutes). None when the
/// VAD model is missing (offline) or it found speech nearly everywhere (nothing to gain).
fn speech_only(all: &[f32], models_dir: &Path, threads: i64) -> Option<Speech> {
    let path = ensure_vad_model(models_dir).map_err(|e| eprintln!("{e}; transcribing silence too")).ok()?;
    let mut cp = whisper_rs::WhisperVadContextParams::new();
    cp.set_n_threads(threads.clamp(1, 64) as i32);
    let mut vad = whisper_rs::WhisperVadContext::new(path.to_str()?, cp).map_err(|e| eprintln!("VAD failed to load: {e}")).ok()?;
    let found = vad.segments_from_samples(whisper_rs::WhisperVadParams::new(), all).map_err(|e| eprintln!("VAD failed: {e}")).ok()?;
    // whisper.cpp keeps VAD times in centiseconds
    let regions: Vec<(f64, f64)> = found.map(|s| (s.start as f64 / 100.0, s.end as f64 / 100.0)).collect();
    let speech = Speech::glue(all, &regions);
    let share = speech.samples.len() as f64 / all.len().max(1) as f64;
    eprintln!("voice activity: {} pieces, {:.0} % of the audio is speech", speech.pieces.len(), 100.0 * share);
    (share < 0.9).then_some(speech)
}

/// Samples of the pipeline's 16 kHz mono 16-bit WAV as f32.
pub fn read_wav(path: &Path) -> Result<Vec<f32>, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("not a WAV file".into());
    }
    let u32_at = |i: usize| u32::from_le_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]);
    let mut pos = 12;
    while pos + 8 <= bytes.len() {
        let size = u32_at(pos + 4) as usize;
        let body = pos + 8;
        if &bytes[pos..pos + 4] == b"data" {
            let end = (body + size).min(bytes.len());
            return Ok(bytes[body..end].chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0).collect());
        }
        pos = body + size + (size & 1);
    }
    Err("WAV has no audio data".into())
}

/// whisper.cpp on this machine. The model is loaded for this call and freed when it returns,
/// so only one heavy model is ever in memory (the LLM runs after, in Ollama). `on_segment`
/// sees each segment as whisper.cpp finishes it, for progress.
/// Run `work` on this thread (so its memory lands in the arena malloc_trim returns after the
/// job) while a scoped thread passes `pct` (0-100, set by a library's progress callback, which
/// must be 'static) on to `on_progress` every half second when it changes.
pub fn with_progress<T, E: std::fmt::Display>(
    pct: &std::sync::atomic::AtomicI32,
    on_progress: &(dyn Fn(f64) + Sync),
    work: impl FnOnce() -> Result<T, E>,
) -> Result<T, String> {
    let done = std::sync::atomic::AtomicBool::new(false);
    std::thread::scope(|s| {
        s.spawn(|| {
            let mut last = -1;
            while !done.load(std::sync::atomic::Ordering::Relaxed) {
                let now = pct.load(std::sync::atomic::Ordering::Relaxed);
                if now != last {
                    on_progress(now as f64 / 100.0);
                    last = now;
                }
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
        });
        let out = work();
        done.store(true, std::sync::atomic::Ordering::Relaxed);
        out.map_err(|e| e.to_string())
    })
}

pub fn local(wav: &Path, p: &Profile, models_dir: &Path, prompt: &str, lang: Lang, on_progress: &(dyn Fn(f64) + Sync)) -> Result<(Vec<Seg>, Info), String> {
    let model = ensure_model(models_dir, &p.whisper_model)?;
    let all = read_wav(wav)?;
    let duration = all.len() as f64 / 16000.0;
    let speech = speech_only(&all, models_dir, p.cpu_threads);
    if speech.as_ref().is_some_and(|s| s.samples.is_empty()) {
        eprintln!("no speech found in {duration:.0} s of audio; Whisper not loaded");
        on_progress(1.0);
        return Ok((vec![], Info { duration, language: String::new() }));
    }
    let samples: &[f32] = speech.as_ref().map_or(&all, |s| &s.samples);
    // flash_attn was measured slower on a laptop CPU (48 s against 36 s), so it stays off
    let ctx = WhisperContext::new_with_params(&model, WhisperContextParameters::default())
        .map_err(|e| format!("Cannot load the Whisper model {}: {e}", p.whisper_model))?;
    let mut state = ctx.create_state().map_err(|e| e.to_string())?;
    let mut params = if p.beam_size > 1 {
        FullParams::new(SamplingStrategy::BeamSearch { beam_size: p.beam_size as i32, patience: -1.0 })
    } else {
        FullParams::new(SamplingStrategy::Greedy { best_of: 1 })
    };
    params.set_n_threads(p.cpu_threads as i32);
    params.set_language(Some(if lang.hint.is_empty() { "auto" } else { lang.hint }));
    params.set_translate(lang.translate);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_special(false);
    params.set_print_timestamps(false);
    if !prompt.is_empty() {
        params.set_initial_prompt(prompt);
    }
    // whisper.cpp reports percent from inside full(); the callback must be 'static, so it only
    // stores the number and this thread passes changes on while full() runs in a scoped thread.
    let pct = std::sync::Arc::new(std::sync::atomic::AtomicI32::new(0));
    let seen = pct.clone();
    params.set_progress_callback_safe(move |p: i32| seen.store(p, std::sync::atomic::Ordering::Relaxed));
    params.set_abort_callback_safe(crate::pipeline::cancelled); // POST .../cancel stops full() within a step
    with_progress(&pct, on_progress, || state.full(params, samples)).map_err(|e| format!("Transcription failed: {e}"))?;
    on_progress(1.0);
    let mut out = Vec::new();
    for i in 0..state.full_n_segments() {
        let Some(seg) = state.get_segment(i) else { continue };
        let text = seg.to_str_lossy().map(|t| t.trim().to_string()).unwrap_or_default();
        if !text.is_empty() {
            let (a, b) = (seg.start_timestamp() as f64 / 100.0, seg.end_timestamp() as f64 / 100.0);
            let (start, end) = speech.as_ref().map_or((a, b), |s| (s.original(a), s.original(b)));
            out.push(Seg { start, end: end.max(start), text });
        }
    }
    let language = get_lang_str_full(state.full_lang_id_from_state()).map(|l| {
        let mut c = l.chars();
        c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
    });
    Ok((clean(out), Info { duration, language: language.unwrap_or_default().chars().take(16).collect() }))
}

/// The provider's /audio/transcriptions: 16 kHz mono FLAC, in pieces when long, each piece's
/// timestamps shifted by where it started so the transcript reads as one recording.
pub fn cloud(wav: &Path, p: &Profile, prompt: &str, lang: Lang, on_progress: &(dyn Fn(f64) + Sync)) -> Result<(Vec<Seg>, Info), String> {
    let mut model = asr_model(p);
    if lang.translate && model == "whisper-large-v3-turbo" {
        model = "whisper-large-v3".into(); // Groq translates only with the full model
    }
    let pieces = audio::flac_chunks(wav, providers::CHUNK_SECONDS, providers::MAX_UPLOAD_BYTES)?;
    let (mut out, mut detected, mut end) = (Vec::new(), String::new(), 0.0f64);
    let n = pieces.len().max(1);
    for (k, (offset, blob)) in pieces.into_iter().enumerate() {
        if crate::pipeline::cancelled() {
            return Err(crate::meetings::CANCELLED.into());
        }
        let data = providers::transcribe_chunk(p, blob, &model, Some(lang.hint), lang.translate, prompt)?;
        if detected.is_empty() {
            detected = data["language"].as_str().unwrap_or("").to_string();
        }
        let mut segs = data["segments"].as_array().cloned().unwrap_or_default();
        if segs.is_empty() && data["text"].as_str().is_some_and(|t| !t.trim().is_empty()) {
            // a provider that ignored verbose_json still gives the words: keep them as one line
            segs = vec![serde_json::json!({"start": 0, "end": data["duration"].as_f64().unwrap_or(0.0), "text": data["text"]})];
        }
        for s in segs {
            let (Some(a), Some(b)) = (s["start"].as_f64(), s["end"].as_f64()) else { continue };
            let text = s["text"].as_str().unwrap_or("").trim().to_string();
            if !text.is_empty() {
                let (start, stop) = (offset + a, offset + b);
                out.push(Seg { start, end: stop.max(start), text });
                end = end.max(stop);
            }
        }
        on_progress((k + 1) as f64 / n as f64);
    }
    let out = clean(out);
    let end = out.iter().map(|s| s.end).fold(end, f64::max);
    let duration = if end > 0.0 { end } else { audio::probe(wav).unwrap_or(0.0) };
    let mut lang = detected.chars();
    let language = lang.next().map(|f| f.to_uppercase().collect::<String>() + lang.as_str()).unwrap_or_default();
    Ok((out, Info { duration, language: language.chars().take(16).collect() }))
}

/// Cloud when the user turned it on for a provider that can, else whisper.cpp here.
pub fn transcribe(wav: &Path, p: &Profile, models_dir: &Path, prompt: &str, lang: Lang, on_progress: &(dyn Fn(f64) + Sync)) -> Result<(Vec<Seg>, Info), String> {
    if hw::uses_cloud(p) {
        cloud(wav, p, prompt, lang, on_progress)
    } else {
        local(wav, p, models_dir, prompt, lang, on_progress)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(a: f64, b: f64, t: &str) -> Seg {
        Seg { start: a, end: b, text: t.into() }
    }

    #[test]
    fn glued_speech_maps_back() {
        let all = vec![0.5f32; 16000 * 60]; // 60 s
        let sp = Speech::glue(&all, &[(10.0, 12.0), (12.5, 14.0), (40.0, 41.0)]);
        // 9.8-14.2 (the 0.5 s pause is joined) and 39.8-41.2, with 0.1 s between
        assert_eq!(sp.pieces.len(), 2);
        assert!((sp.samples.len() as f64 / 16000.0 - (4.4 + 0.1 + 1.4)).abs() < 0.01);
        assert!((sp.original(0.0) - 9.8).abs() < 1e-6);
        assert!((sp.original(4.5 + 0.5) - 40.3).abs() < 0.01); // inside the second piece
        assert!((sp.original(4.45) - 14.2).abs() < 0.01); // in the gap: end of the first piece
        assert!(Speech::glue(&all, &[]).samples.is_empty());
    }

    #[test]
    fn drops_silence_lines() {
        let out = clean(vec![s(0.0, 5.0, "Real talk."), s(5.0, 5.1, "blip"), s(9.0, 10.0, "Thank you.")]);
        assert_eq!(out.len(), 1);
        let keep = clean(vec![s(0.0, 5.0, "Hello."), s(5.5, 6.5, "Thank you."), s(7.0, 9.0, "More talk.")]);
        assert_eq!(keep.len(), 3);
    }
}
