//! privmeet-transcribe: speech to text for PrivMeet, in Rust.
//!
//!     privmeet-transcribe --model ggml-base.bin --audio meeting.wav [--language en] [--threads 4] [--prompt "Names: ..."]
//!
//! Reads a 16 kHz mono 16-bit WAV (the pipeline's audio.to_wav makes exactly that), runs
//! whisper.cpp and prints one JSON object per line: first {"language": ...}, then
//! {"start", "end", "text"} per segment, times in seconds. Errors go to stderr, exit code 1.

use std::fs;
use std::io::{self, Write};
use std::process::ExitCode;

use whisper_rs::{get_lang_str, FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

struct Args {
    model: String,
    audio: String,
    language: Option<String>,
    threads: i32,
    prompt: Option<String>,
}

fn parse_args() -> Result<Args, String> {
    let mut it = std::env::args().skip(1);
    let (mut model, mut audio, mut language, mut threads, mut prompt) = (None, None, None, 4, None);
    while let Some(flag) = it.next() {
        let mut value = || it.next().ok_or(format!("{flag} needs a value"));
        match flag.as_str() {
            "--model" => model = Some(value()?),
            "--audio" => audio = Some(value()?),
            "--language" => language = Some(value()?).filter(|l| !l.is_empty() && l != "auto"),
            "--threads" => threads = value()?.parse().map_err(|_| "--threads must be a number".to_string())?,
            "--prompt" => prompt = Some(value()?).filter(|p| !p.is_empty()),
            other => return Err(format!("unknown argument {other}")),
        }
    }
    Ok(Args {
        model: model.ok_or("--model is required")?,
        audio: audio.ok_or("--audio is required")?,
        language,
        threads: threads.max(1),
        prompt,
    })
}

/// Samples of a 16 kHz mono 16-bit PCM WAV as f32 in -1..1. Walks the RIFF chunks instead of
/// assuming a 44-byte header, since ffmpeg may write a LIST chunk before "data".
fn read_wav(path: &str) -> Result<Vec<f32>, String> {
    let bytes = fs::read(path).map_err(|e| format!("cannot read {path}: {e}"))?;
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err(format!("{path} is not a WAV file"));
    }
    let u16_at = |i: usize| u16::from_le_bytes([bytes[i], bytes[i + 1]]);
    let u32_at = |i: usize| u32::from_le_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]);
    let (mut pos, mut format) = (12, None);
    while pos + 8 <= bytes.len() {
        let (id, size) = (&bytes[pos..pos + 4], u32_at(pos + 4) as usize);
        let body = pos + 8;
        let end = (body + size).min(bytes.len());
        if id == b"fmt " && size >= 16 {
            format = Some((u16_at(body), u16_at(body + 2), u32_at(body + 4), u16_at(body + 14)));
        } else if id == b"data" {
            match format {
                Some((1, 1, 16000, 16)) => {}
                Some((fmt, ch, rate, bits)) => {
                    return Err(format!("need 16 kHz mono 16-bit PCM, got format {fmt}, {ch} ch, {rate} Hz, {bits} bit"))
                }
                None => return Err("WAV has no fmt chunk before its data".into()),
            }
            return Ok(bytes[body..end]
                .chunks_exact(2)
                .map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0)
                .collect());
        }
        pos = body + size + (size & 1); // chunks are padded to an even length
    }
    Err(format!("{path} has no audio data"))
}

/// A JSON string literal: quotes, backslashes and control characters escaped.
fn json_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn run(args: Args) -> Result<(), String> {
    let samples = read_wav(&args.audio)?;
    let ctx = WhisperContext::new_with_params(&args.model, WhisperContextParameters::default())
        .map_err(|e| format!("cannot load model {}: {e}", args.model))?;
    let mut state = ctx.create_state().map_err(|e| format!("cannot create state: {e}"))?;

    // greedy decoding, as the low tier runs faster-whisper (beam_size 1)
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_n_threads(args.threads);
    params.set_language(args.language.as_deref().or(Some("auto")));
    params.set_translate(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_special(false);
    params.set_print_timestamps(false);
    if let Some(p) = &args.prompt {
        params.set_initial_prompt(p); // names to spell right (tasks.asr_prompt)
    }
    state.full(params, &samples).map_err(|e| format!("transcription failed: {e}"))?;

    let out = io::stdout();
    let mut out = out.lock();
    let lang = get_lang_str(state.full_lang_id_from_state()).unwrap_or("");
    writeln!(out, "{{\"language\":{}}}", json_str(lang)).map_err(|e| e.to_string())?;
    for i in 0..state.full_n_segments() {
        let Some(seg) = state.get_segment(i) else { continue };
        let text = seg.to_str_lossy().map_err(|e| format!("segment {i}: {e}"))?;
        // whisper.cpp times are centiseconds
        let (t0, t1) = (seg.start_timestamp() as f64 / 100.0, seg.end_timestamp() as f64 / 100.0);
        writeln!(out, "{{\"start\":{t0:.2},\"end\":{t1:.2},\"text\":{}}}", json_str(text.trim()))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn main() -> ExitCode {
    match parse_args().and_then(run) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("privmeet-transcribe: {e}");
            ExitCode::FAILURE
        }
    }
}
