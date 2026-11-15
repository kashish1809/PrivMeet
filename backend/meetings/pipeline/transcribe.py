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
    segments, info = model.transcribe(samples, beam_size=prof["beam_size"], vad_filter=True)
    it = iter(segments)
    return next(it, None), it, info


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
        data = providers.transcribe_chunk(prof, blob, "audio.flac", model, language)
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
    log.info("transcribed %d segments through %s with %s", len(out), prof.get("llm_provider"), model)
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
        if first is not None:
            yield first
        yield from rest

    return segments(), info
