"""Speaker diarization with sherpa-onnx (ONNX pyannote segmentation + speaker embeddings, no PyTorch)."""

from django.conf import settings


def model_paths():
    d = settings.DIARIZE_MODELS_DIR
    return d / "segmentation.onnx", d / "embedding.onnx"


def available():
    return all(p.is_file() for p in model_paths())


def diarize(wav, threads, num_speakers=-1):
    """Return [(start, end, speaker_index)] sorted by start time."""
    import sherpa_onnx
    import soundfile as sf

    seg_model, emb_model = model_paths()
    config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(model=str(seg_model)),
            num_threads=threads,
        ),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=str(emb_model), num_threads=threads),
        clustering=sherpa_onnx.FastClusteringConfig(num_clusters=num_speakers, threshold=0.5),
    )
    sd = sherpa_onnx.OfflineSpeakerDiarization(config)
    samples, rate = sf.read(str(wav), dtype="float32")
    if rate != sd.sample_rate:
        raise ValueError(f"diarizer wants {sd.sample_rate} Hz audio, got {rate}")
    return [(t.start, t.end, t.speaker) for t in sd.process(samples).sort_by_start_time()]


def assign_speakers(segments, turns):
    """Give each transcript segment the speaker whose turns overlap it the most."""
    for seg in segments:
        overlap = {}
        for start, end, spk in turns:
            if start >= seg.end:
                break
            o = min(seg.end, end) - max(seg.start, start)
            if o > 0:
                overlap[spk] = overlap.get(spk, 0) + o
        seg.speaker = max(overlap, key=overlap.get) if overlap else None
    return segments
