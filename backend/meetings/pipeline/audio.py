import json
import os
import re
import subprocess

# ffmpeg's progress lines, the last of which is the real end of the stream.
TIME_RE = re.compile(r"time=(\d+):(\d\d):(\d\d(?:\.\d+)?)")


def decoded_duration(path):
    """Duration in seconds by decoding the file and discarding the output.

    A browser MediaRecorder WebM carries no duration in its header, so ffprobe reports "N/A"
    and the meeting showed "0 min" for the whole run (bug B3). Decoding is the only way to
    learn the real length; audio-only at 16 kHz it costs a fraction of a second per minute.
    """
    out = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-stats", "-i", str(path),
         "-vn", "-ac", "1", "-ar", "16000", "-f", "null", "-"],
        capture_output=True, text=True, timeout=600,
    )
    stamps = TIME_RE.findall(out.stderr or "")
    if not stamps:
        return 0.0
    h, m, sec = stamps[-1]
    return int(h) * 3600 + int(m) * 60 + float(sec)


def probe(path):
    """Return the duration in seconds (0 if unknown) when the file has an audio stream, else None."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a",
         "-show_entries", "stream=codec_type:format=duration", "-of", "json", str(path)],
        capture_output=True, text=True, timeout=120,
    )
    if out.returncode != 0:
        return None
    data = json.loads(out.stdout or "{}")
    if not data.get("streams"):
        return None
    try:
        duration = float(data.get("format", {}).get("duration", 0))
    except ValueError:  # browser WebM recordings report "N/A"
        duration = 0.0
    if duration > 0:
        return duration
    try:
        return decoded_duration(path)
    except (OSError, ValueError, subprocess.SubprocessError):
        return 0.0  # the file has an audio stream; the pipeline fixes the duration later


def flac_chunks(wav, seconds, limit_bytes):
    """Yield (offset_seconds, flac_bytes) for `wav`, cut into pieces of `seconds`.

    FLAC is lossless and about half the size of the 16 kHz mono WAV the pipeline already
    made, which is what a provider's upload limit needs; the provider downsamples to 16 kHz
    anyway. Cutting on time keeps the arithmetic simple: a piece's segment timestamps are its
    own plus the offset.
    """
    import tempfile

    total = probe(wav) or 0.0
    offset = 0.0
    while offset < max(total, 0.1):
        fd, piece = tempfile.mkstemp(suffix=".flac")
        os.close(fd)
        try:
            subprocess.run(
                ["ffmpeg", "-nostdin", "-y", "-v", "error", "-ss", f"{offset:.3f}", "-t", str(seconds),
                 "-i", str(wav), "-ac", "1", "-ar", "16000", "-c:a", "flac", piece],
                check=True, capture_output=True, timeout=3600,
            )
            blob = open(piece, "rb").read()
        finally:
            os.unlink(piece)
        if not blob:
            break
        if len(blob) > limit_bytes:
            raise ValueError(
                f"A {int(seconds)} s piece of this recording is {len(blob) // 1024 // 1024} MB, "
                "over what the provider accepts. Transcribe on this machine instead."
            )
        yield offset, blob
        offset += seconds


def to_wav(src, dst):
    """Decode any audio/video file to 16 kHz mono PCM, the format Whisper and the diarizer expect."""
    subprocess.run(
        ["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", str(src),
         "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(dst)],
        check=True, capture_output=True, timeout=3 * 3600,
    )
