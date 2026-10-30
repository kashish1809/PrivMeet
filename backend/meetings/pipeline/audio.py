import json
import subprocess


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
        return float(data.get("format", {}).get("duration", 0))
    except ValueError:  # browser WebM recordings report "N/A"
        return 0.0


def to_wav(src, dst):
    """Decode any audio/video file to 16 kHz mono PCM, the format Whisper and the diarizer expect."""
    subprocess.run(
        ["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", str(src),
         "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(dst)],
        check=True, capture_output=True, timeout=3 * 3600,
    )
