from django.conf import settings


def transcribe(wav, prof):
    """Return (lazy segment generator, info). The model is freed once the generator is dropped."""
    from faster_whisper import WhisperModel

    model = WhisperModel(
        prof["whisper_model"],
        device=prof["device"],
        compute_type=prof["compute_type"],
        cpu_threads=prof["cpu_threads"],
        download_root=str(settings.MODELS_DIR / "whisper"),
    )
    return model.transcribe(str(wav), beam_size=prof["beam_size"], vad_filter=True)
