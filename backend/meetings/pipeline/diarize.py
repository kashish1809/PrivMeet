"""Speaker diarization with sherpa-onnx (ONNX pyannote segmentation + speaker embeddings, no PyTorch)."""

import os

from django.conf import settings

# Higher = fewer speakers. 0.5 split one narrator into ~13 voices on an 8 min test reading;
# 0.8 gave 7, matching its cast (sweep 0.5/0.7/0.8/0.9 -> 13/10/7/6 speakers).
# DIARIZE_THRESHOLD overrides it for a recording the default gets wrong.
CLUSTER_THRESHOLD = float(os.environ.get("DIARIZE_THRESHOLD") or 0.8)

# DIARIZE_SPEAKERS forces the number of speakers when the user knows it; 0 means detect.
# shortcut: an env var, not a per-meeting field, because the API has no place for one yet;
# upgrade to an upload field (and the R2.3 "Merge into..." card) when that lands.
# It is the only reliable answer for a recording of one person: the segmentation model cuts
# a single voice in two often enough, and no clustering threshold repairs it (a 75 s solo
# narration stayed two speakers at 0.8, 0.85, 0.9 and 0.95).
FORCED_SPEAKERS = int(os.environ.get("DIARIZE_SPEAKERS") or 0)


def model_paths():
    d = settings.DIARIZE_MODELS_DIR
    return d / "segmentation.onnx", d / "embedding.onnx"


def available():
    return all(p.is_file() for p in model_paths())


def diarize(wav, threads, num_speakers=None):
    """Return [(start, end, speaker_index)] sorted by start time.

    `num_speakers` fixes how many speakers to find; -1 detects it. The default follows
    DIARIZE_SPEAKERS, so a solo recording can be told to come back as one speaker.
    """
    if num_speakers is None:
        num_speakers = FORCED_SPEAKERS or -1
    import sherpa_onnx
    import soundfile as sf

    seg_model, emb_model = model_paths()
    config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(model=str(seg_model)),
            num_threads=threads,
        ),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=str(emb_model), num_threads=threads),
        clustering=sherpa_onnx.FastClusteringConfig(num_clusters=num_speakers, threshold=CLUSTER_THRESHOLD),
    )
    sd = sherpa_onnx.OfflineSpeakerDiarization(config)
    samples, rate = sf.read(str(wav), dtype="float32")
    if rate != sd.sample_rate:
        raise ValueError(f"diarizer wants {sd.sample_rate} Hz audio, got {rate}")
    return [(t.start, t.end, t.speaker) for t in sd.process(samples).sort_by_start_time()]


# A cluster this small is a fragment of a real speaker, not a person of its own: the news
# report in bug B7 got a third "speaker" from two mid-sentence pieces of the reporter.
# Both tests have to pass, so a genuine short interjection ("Yes, agreed.") survives when it
# is the only thing that voice ever says and the voice is not wrapped inside another one.
STRAY_MAX_SECONDS = 20
STRAY_MAX_SHARE = 0.1


def _talk_time(segments):
    totals = {}
    for seg in segments:
        if seg.speaker is not None:
            totals[seg.speaker] = totals.get(seg.speaker, 0.0) + max(0.0, seg.end - seg.start)
    return totals


def _neighbours(segments, speaker):
    """The speakers heard immediately before and after each run of `speaker`."""
    labelled = [s for s in segments if s.speaker is not None]
    around = set()
    for i, seg in enumerate(labelled):
        if seg.speaker != speaker:
            continue
        for j in (i - 1, i + 1):
            if 0 <= j < len(labelled) and labelled[j].speaker != speaker:
                around.add(labelled[j].speaker)
    return around


def merge_strays(segments):
    """Fold a tiny speaker surrounded by one other speaker back into it.

    The clusterer cuts a long turn when a voice changes level, over music or at a bad splice,
    and the pieces become an extra "speaker" (bug B7). A cluster is a fragment when it holds
    little talk, a small share of the meeting, and every piece of it is flanked by the same
    single other speaker, which is what a piece torn out of one person's turn looks like.
    """
    totals = _talk_time(segments)
    if len(totals) < 2:
        return segments
    overall = sum(totals.values()) or 1.0
    # Smallest first, so a fragment of a fragment lands on the real speaker in the end.
    for speaker in sorted(totals, key=lambda k: totals[k]):
        if speaker not in totals or len(totals) < 2:
            continue
        if totals[speaker] > STRAY_MAX_SECONDS or totals[speaker] / overall > STRAY_MAX_SHARE:
            continue
        around = _neighbours(segments, speaker)
        if len(around) != 1:
            continue
        host = around.pop()
        for seg in segments:
            if seg.speaker == speaker:
                seg.speaker = host
        totals[host] += totals.pop(speaker)
    return segments


def renumber(segments):
    """Cluster ids have gaps (clusters that won no segment, or were merged away); renumber
    0..n-1 by first appearance so the UI shows "Speaker 1, 2, 3" and not "Speaker 1, 4, 12"."""
    order = {}
    for seg in segments:
        if seg.speaker is not None:
            seg.speaker = order.setdefault(seg.speaker, len(order))
    return segments


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
    return renumber(merge_strays(segments))
