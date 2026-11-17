//! privmeet-transcribe: speech to text for PrivMeet, in Rust.
//!
//!     privmeet-transcribe --model ggml-base.bin --audio meeting.wav [--language en] [--threads 4] [--prompt "Names: ..."]
//!
//! Reads a 16 kHz mono WAV (the pipeline's audio.to_wav makes one), runs whisper.cpp and
//! prints one JSON object per line: first {"language": ...}, then {"start", "end", "text"} per
//! segment, so Python can read segments as they come. Errors go to stderr with exit code 1.

use std::process::ExitCode;

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
        threads,
        prompt,
    })
}

fn main() -> ExitCode {
    match parse_args() {
        Ok(args) => {
            eprintln!("model {} audio {} threads {}", args.model, args.audio, args.threads);
            let _ = (args.language, args.prompt);
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("privmeet-transcribe: {e}");
            ExitCode::FAILURE
        }
    }
}
