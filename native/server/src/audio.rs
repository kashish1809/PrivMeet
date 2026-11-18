//! ffmpeg and ffprobe, always as list arguments, never through a shell.

use std::path::Path;
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

/// Run a command, killing it when it takes longer than `limit` (std's Command has no timeout).
pub fn run(cmd: &mut Command, limit: Duration) -> Result<Output, String> {
    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("cannot run {:?}: {e}", cmd.get_program()))?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return child.wait_with_output().map_err(|e| e.to_string()),
            Ok(None) if start.elapsed() > limit => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("{:?} took longer than {} s", cmd.get_program(), limit.as_secs()));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(e) => return Err(e.to_string()),
        }
    }
}

/// Duration in seconds by decoding the file: a browser MediaRecorder WebM has no duration in
/// its header, so ffprobe says "N/A" (bug B3). The last ffmpeg "time=" stamp is the real end.
pub fn decoded_duration(path: &Path) -> Result<f64, String> {
    let out = run(
        Command::new("ffmpeg").args(["-nostdin", "-v", "error", "-stats", "-i"]).arg(path).args([
            "-vn", "-ac", "1", "-ar", "16000", "-f", "null", "-",
        ]),
        Duration::from_secs(600),
    )?;
    let err = String::from_utf8_lossy(&out.stderr);
    let last = err.rsplit("time=").next().filter(|_| err.contains("time=")).unwrap_or("");
    let stamp: String = last.chars().take_while(|c| c.is_ascii_digit() || *c == ':' || *c == '.').collect();
    let parts: Vec<f64> = stamp.split(':').filter_map(|p| p.parse().ok()).collect();
    Ok(match parts[..] {
        [h, m, s] => h * 3600.0 + m * 60.0 + s,
        _ => 0.0,
    })
}

/// The duration in seconds (0 if unknown) when the file has an audio stream, else None.
pub fn probe(path: &Path) -> Option<f64> {
    let out = run(
        Command::new("ffprobe")
            .args(["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type:format=duration", "-of", "json"])
            .arg(path),
        Duration::from_secs(120),
    )
    .ok()
    .filter(|o| o.status.success())?;
    let data: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap_or_default();
    if data["streams"].as_array().is_none_or(|s| s.is_empty()) {
        return None;
    }
    let duration = data["format"]["duration"].as_str().and_then(|d| d.parse::<f64>().ok()).unwrap_or(0.0);
    if duration > 0.0 {
        return Some(duration);
    }
    // the file has audio; the pipeline fixes the duration later if this fails too
    Some(decoded_duration(path).unwrap_or(0.0))
}

/// Any audio or video file to 16 kHz mono 16-bit PCM, what Whisper and the diarizer expect.
pub fn to_wav(src: &Path, dst: &Path) -> Result<(), String> {
    let out = run(
        Command::new("ffmpeg").args(["-nostdin", "-y", "-v", "error", "-i"]).arg(src).args([
            "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
        ]).arg(dst),
        Duration::from_secs(3 * 3600),
    )?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!("ffmpeg could not read the file: {}", String::from_utf8_lossy(&out.stderr).trim().chars().take(300).collect::<String>()))
    }
}

/// `wav` cut into FLAC pieces of `seconds` for a provider's upload limit: (offset, bytes).
/// FLAC is lossless and about half the size of the WAV; a piece's timestamps are its own
/// plus the offset.
pub fn flac_chunks(wav: &Path, seconds: f64, limit_bytes: usize) -> Result<Vec<(f64, Vec<u8>)>, String> {
    let total = probe(wav).unwrap_or(0.0);
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    let mut offset = 0.0;
    while offset < total.max(0.1) {
        let piece = dir.path().join(format!("{}.flac", out.len()));
        let res = run(
            Command::new("ffmpeg")
                .args(["-nostdin", "-y", "-v", "error", "-ss", &format!("{offset:.3}"), "-t", &seconds.to_string(), "-i"])
                .arg(wav)
                .args(["-ac", "1", "-ar", "16000", "-c:a", "flac"])
                .arg(&piece),
            Duration::from_secs(3600),
        )?;
        if !res.status.success() {
            return Err("ffmpeg could not cut the audio".into());
        }
        let blob = std::fs::read(&piece).unwrap_or_default();
        if blob.is_empty() {
            break;
        }
        if blob.len() > limit_bytes {
            return Err(format!(
                "A {} s piece of this recording is {} MB, over what the provider accepts. Transcribe on this machine instead.",
                seconds as i64,
                blob.len() / 1024 / 1024
            ));
        }
        out.push((offset, blob));
        offset += seconds;
    }
    Ok(out)
}

/// The media type a browser needs to play a stored upload.
pub fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/x-wav",
        Some("m4a") => "audio/mp4",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("ogg" | "opus") => "audio/ogg",
        Some("flac") => "audio/flac",
        Some("mkv") => "video/x-matroska",
        Some("mov") => "video/quicktime",
        _ => "application/octet-stream",
    }
}
