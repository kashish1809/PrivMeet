from django.conf import settings


def transcribe(wav, prof):
    """Return (lazy segment generator, info). The model is freed once the generator is dropped."""
    import soundfile as sf
    from faster_whisper import WhisperModel

    model = WhisperModel(
        prof["whisper_model"],
        device=prof["device"],
        compute_type=prof["compute_type"],
        cpu_threads=prof["cpu_threads"],
        download_root=str(settings.MODELS_DIR / "whisper"),
    )
    # to_wav already made 16 kHz mono; reading it here skips faster-whisper's PyAV
    # decoder, which breaks on PyAV >= 15 (removed the metadata_errors argument).
    samples, _ = sf.read(str(wav), dtype="float32")
    return model.transcribe(samples, beam_size=prof["beam_size"], vad_filter=True)
