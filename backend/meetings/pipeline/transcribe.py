import logging

from django.conf import settings

log = logging.getLogger(__name__)


def _load(prof):
    from faster_whisper import WhisperModel

    return WhisperModel(
        prof["whisper_model"],
        device=prof["device"],
        compute_type=prof["compute_type"],
        cpu_threads=prof["cpu_threads"],
        download_root=str(settings.MODELS_DIR / "whisper"),
    )


def _start(prof, samples):
    """Load the model and decode the first segment. Returns (first, rest, info); `first` is
    None for silence. Decoding one segment here makes a CUDA failure happen now, inside the
    retry below, and not later halfway through the meeting."""
    model = _load(prof)
    segments, info = model.transcribe(
        samples, beam_size=prof["beam_size"], vad_filter=True,
        initial_prompt=prof.get("asr_prompt") or None,  # names to spell right (tasks.asr_prompt)
    )
    it = iter(segments)
    return next(it, None), it, info


# A segment shorter than this holds no speech. Whisper emits them on trailing silence with a
# filler line attached: the news recording ended with a 0.00 s "Thank you." at 05:15, twelve
# seconds after the last real words, which then showed in the transcript as something said.
MIN_SECONDS = 0.2
# What those invented lines say. Only ever dropped when the segment is also tiny and stands
# alone after a silence, so a real "Thank you" inside a meeting is kept.
FILLER = {
    "thank you", "thanks", "thank you.", "thanks.", "thank you very much", "thanks for watching",
    "thank you for watching", "bye", "bye.", "you", "okay", "ok", "subtitles by the amara.org community",
}
FILLER_MAX_SECONDS = 2.0
FILLER_MIN_GAP = 3.0


def _is_filler(text):
    import re as _re

    return _re.sub(r"[^\w ]", "", (text or "").strip().lower()).strip() in {
        _re.sub(r"[^\w ]", "", f) for f in FILLER
    }


def clean_middle(segments):
    """Only the length rule: a segment in the middle of a transcript is never a trailing filler."""
    return [s for s in segments if s.end - s.start >= MIN_SECONDS]


def clean(segments):
    """Drop what Whisper writes into silence: a segment too short to hold speech, and a lone
    filler line left stranded after a gap. Everything else is passed through untouched."""
    kept, dropped = [], 0
    for seg in segments:
        if seg.end - seg.start < MIN_SECONDS:
            dropped += 1
            continue
        kept.append(seg)
    while kept:
        last = kept[-1]
        gap = last.start - kept[-2].end if len(kept) > 1 else 0.0
        if (
            _is_filler(last.text)
            and last.end - last.start <= FILLER_MAX_SECONDS
            and (gap >= FILLER_MIN_GAP or len(kept) == 1)
        ):
            kept.pop()
            dropped += 1
            continue
        break
    if dropped:
        log.info("dropped %d segment(s) Whisper wrote into silence", dropped)
    return kept


# Picked when the account offers no choice; both providers host these names.
DEFAULT_ASR = {"groq": "whisper-large-v3-turbo", "openai": "whisper-1"}


def uses_cloud(prof):
    """Whether this run sends audio to the provider instead of running Whisper here."""
    from . import providers

    return bool(prof.get("cloud_transcribe")) and prof.get("llm_provider") in providers.AUDIO_PROVIDERS


def asr_model(prof):
    return prof.get("cloud_transcribe_model") or DEFAULT_ASR.get(prof.get("llm_provider"), "whisper-1")


def _cloud(wav, prof):
    """Transcribe through the provider's /audio/transcriptions route.

    The audio goes up as 16 kHz mono FLAC, in pieces when it is long, and each piece's
    timestamps are shifted by where it started so the transcript reads as one recording.
    """
    from types import SimpleNamespace

    from . import audio, providers

    model, language = asr_model(prof), prof.get("language_hint") or None
    out, detected, end = [], "", 0.0
    for offset, blob in audio.flac_chunks(wav, providers.CHUNK_SECONDS, providers.MAX_UPLOAD_BYTES):
        data = providers.transcribe_chunk(prof, blob, "audio.flac", model, language, prompt=prof.get("asr_prompt", ""))
        detected = detected or (data.get("language") or "")
        pieces = data.get("segments") or []
        if not pieces and (data.get("text") or "").strip():
            # A provider that ignored verbose_json still gives the words; keep them as one line.
            pieces = [{"start": 0, "end": data.get("duration") or 0, "text": data["text"]}]
        for seg in pieces:
            try:
                start, stop = offset + float(seg.get("start", 0)), offset + float(seg.get("end", 0))
            except (TypeError, ValueError):
                continue
            text = str(seg.get("text") or "").strip()
            if text:
                out.append(SimpleNamespace(start=start, end=max(stop, start), text=text))
                end = max(end, stop)
    out = clean(out)
    log.info("transcribed %d segments through %s with %s", len(out), prof.get("llm_provider"), model)
    end = max((s.end for s in out), default=end)
    return iter(out), SimpleNamespace(duration=end or audio.probe(wav) or 0.0, language=detected[:16])


def transcribe(wav, prof):
    """Return (lazy segment generator, info). The model is freed once the generator is dropped.

    On a CUDA profile, any error while loading the model or decoding the first segment (no
    driver, missing cuBLAS/cuDNN, out of GPU memory) is logged and the job retries once on the
    CPU with int8. `prof` is switched to the CPU in place, so the LLM stage that follows sees it,
    and the failure is recorded so later runs stop planning for the GPU (bug B1). Read the
    device the run really used from `prof["device"]` after this returns.
    """
    import soundfile as sf

    from .. import hw

    if uses_cloud(prof):
        return _cloud(wav, prof)

    # to_wav already made 16 kHz mono; reading it here skips faster-whisper's PyAV
    # decoder, which breaks on PyAV >= 15 (removed the metadata_errors argument).
    samples, _ = sf.read(str(wav), dtype="float32")
    try:
        first, rest, info = _start(prof, samples)
    except Exception as e:  # CTranslate2 raises RuntimeError/ValueError/OSError, varying by cause
        if prof["device"] != "cuda":
            raise
        log.warning("CUDA transcription failed (%s); retrying on the CPU with int8", e)
        hw.mark_cuda_broken(e)
        first, rest, info = _start(hw.cpu_fallback(prof), samples)

    def segments():
        # Buffered in a small window so clean() can see a trailing filler line, while the
        # caller still receives segments as they are decoded.
        window = []
        for seg in ([first] if first is not None else []) + list(rest):
            window.append(seg)
            if len(window) > 2:
                head, window = window[:-2], window[-2:]
                yield from clean_middle(head)
        yield from clean(window)

    return segments(), info
