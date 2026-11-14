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


def transcribe(wav, prof):
    """Return (lazy segment generator, info). The model is freed once the generator is dropped.

    On a CUDA profile, any error while loading the model or decoding the first segment (no
    driver, missing cuBLAS/cuDNN, out of GPU memory) is logged and the job retries once on the
    CPU with int8. `prof` is switched to the CPU in place, so the LLM stage that follows sees it.
    """
    import soundfile as sf

    from .. import hw

    # to_wav already made 16 kHz mono; reading it here skips faster-whisper's PyAV
    # decoder, which breaks on PyAV >= 15 (removed the metadata_errors argument).
    samples, _ = sf.read(str(wav), dtype="float32")
    try:
        first, rest, info = _start(prof, samples)
    except Exception as e:  # CTranslate2 raises RuntimeError/ValueError/OSError, varying by cause
        if prof["device"] != "cuda":
            raise
        log.warning("CUDA transcription failed (%s); retrying on the CPU with int8", e)
        first, rest, info = _start(hw.cpu_fallback(prof), samples)

    def segments():
        if first is not None:
            yield first
        yield from rest

    return segments(), info
