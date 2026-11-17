"""Celery tasks. The worker runs with concurrency 1 and one task per child process,
so only one heavy model is in RAM at a time and it is freed when the task ends."""

import json
import logging
import os
import re
import tempfile
import time

from celery import shared_task
from celery.signals import worker_ready
from django.conf import settings

from . import hw, note_templates
from .models import Meeting, Question, Segment
from .pipeline import audio
from .pipeline.names import corrector, infer_speakers

# The heavy pipeline (LangChain, faster-whisper, the diarizer) is imported inside the tasks
# that use it, not here: views import this module, and a module-level import loaded LangChain
# into the idle web process before any meeting ran (R1.21).

log = logging.getLogger(__name__)

# Progress is written after this many segments or this many seconds, whichever comes first.
# Count alone left the meeting at 2 % for the first 20 segments, over 10 minutes on a slow
# CPU run, which looks exactly like a hung worker (bug B2).
PROGRESS_SEGMENTS = 20
PROGRESS_SECONDS = 5

WORKER_PROFILE = settings.DATA_DIR / "worker_profile.json"


@worker_ready.connect
def publish_profile(**kwargs):
    # The web container may not see the GPU, so the worker tells it what tier it runs.
    # Without the saved settings: the web side applies the current ones on every request.
    settings.DATA_DIR.mkdir(parents=True, exist_ok=True)
    WORKER_PROFILE.write_text(json.dumps(hw.base_profile()))


def known_names():
    """Names and terms to spell right: the user's own name, the speaker names saved on recent
    meetings and the Settings vocabulary, first spelling wins."""
    from . import settings_store

    saved = settings_store.load()
    names = []

    def add(word):
        word = str(word or "").strip()
        if word and not word.lower().startswith("speaker") and word.lower() not in (n.lower() for n in names):
            names.append(word)

    add(saved.get("display_name"))
    for m in Meeting.objects.exclude(speaker_names={}).only("speaker_names")[:30]:
        for name in m.speaker_names.values():
            add(name)
    for word in re.split(r"[,;\n]+", saved.get("vocabulary", "")):
        add(word)
    return names


def asr_prompt(names):
    """A hint for Whisper with those names: it copies the spelling of words in its prompt (it
    helped whisper-large-v3-turbo on Groq; names.py fixes what is still wrong afterwards)."""
    # shortcut: a flat comma list capped at 400 characters (Whisper reads ~224 tokens of prompt);
    # upgrade to a ranked list if users keep long glossaries.
    text = ", ".join(names)[:400].rsplit(",", 1)[0] if len(", ".join(names)) > 400 else ", ".join(names)
    return f"Names and terms: {text}." if text else ""


@shared_task
def process_meeting(meeting_id):
    from .pipeline import diarize, llm
    from .pipeline.transcribe import transcribe

    m = Meeting.objects.get(pk=meeting_id)
    prof = hw.profile()
    names = known_names()
    prof["asr_prompt"] = asr_prompt(names)
    fix_names = corrector(names) or (lambda t: t)
    m.tier_used, m.error = prof["tier"], ""
    m.save(update_fields=["tier_used", "error"])
    m.segments.all().delete()
    fd, wav = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        m.set_status(Meeting.Status.CONVERTING, 0)
        audio.to_wav(m.file.path, wav)

        m.set_status(Meeting.Status.TRANSCRIBING, 2)
        segments, info = transcribe(wav, prof)
        # transcribe() switches prof to the CPU when CUDA failed, so this is the real device.
        from .pipeline.transcribe import uses_cloud

        device = prof["llm_provider"][:8] if uses_cloud(prof) else prof["device"]
        m.duration, m.language, m.device_used = info.duration, info.language, device
        m.save(update_fields=["duration", "language", "device_used"])
        batch, flushed = [], time.monotonic()
        for s in segments:
            batch.append(Segment(meeting=m, start=s.start, end=s.end, text=fix_names(s.text.strip())))
            if len(batch) >= PROGRESS_SEGMENTS or time.monotonic() - flushed >= PROGRESS_SECONDS:
                Segment.objects.bulk_create(batch)
                batch, flushed = [], time.monotonic()
                m.set_status(Meeting.Status.TRANSCRIBING, 2 + int(68 * s.end / max(info.duration, 1)))
        Segment.objects.bulk_create(batch)
        del segments  # the model was freed when the generator finished; drop the last ref anyway

        if prof["diarize"] and diarize.available():
            m.set_status(Meeting.Status.DIARIZING, 70)
            turns = diarize.diarize(wav, prof["cpu_threads"])
            segs = diarize.assign_speakers(list(m.segments.all()), turns)
            Segment.objects.bulk_update(segs, ["speaker"], batch_size=500)
        elif prof["diarize"]:
            log.warning("diarization models missing in %s, skipping", settings.DIARIZE_MODELS_DIR)

        m.set_status(Meeting.Status.SUMMARIZING, 80)
        llm.ensure_model(prof)
        # who is which speaker, from the conversation, so "I'll do it" gets the right owner
        guessed = infer_speakers(list(m.segments.all()), names)
        if guessed:
            log.info("meeting %s: speakers guessed for the summary: %s", meeting_id, guessed)
        notes = llm.summarize(
            m.transcript(guessed=guessed), prof,
            on_progress=lambda f: m.set_status(Meeting.Status.SUMMARIZING, 80 + int(15 * f)),
            language=m.language,
            focus=note_templates.instructions(m.template),
        )
        for k, v in notes.items():
            setattr(m, k, v)
        m.status, m.progress = Meeting.Status.DONE, 100
        m.save()
    except Exception as e:
        log.exception("meeting %s failed", meeting_id)
        m.error = str(e)[:2000] or e.__class__.__name__
        m.status = Meeting.Status.FAILED
        m.save(update_fields=["error", "status"])
    finally:
        os.unlink(wav)


@shared_task
def answer_question(question_id):
    from .pipeline import llm
    from .search import excerpts

    q = Question.objects.select_related("meeting").get(pk=question_id)
    prof = hw.profile()
    try:
        llm.ensure_model(prof)
        q.answer = llm.answer(excerpts(q.meeting, q.question, llm.chunk_chars(prof)), q.question, prof)
        q.status = "done"
    except Exception as e:
        log.exception("question %s failed", question_id)
        q.answer, q.status = f"Error: {e}", "failed"
    q.save(update_fields=["answer", "status"])


# ---- Model downloads (R1.11). One pull at a time, through the worker queue, so a download
# never runs beside a transcription (concurrency 1). Progress goes to a small JSON file the
# web side reads for GET /api/models/.
PULL_STATE = settings.DATA_DIR / "model_pull.json"
PULL_STALE_AFTER = 120  # seconds without an update: the worker running the pull is gone


def _write_pull(state):
    settings.DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = PULL_STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps({**state, "updated": time.time()}))
    os.replace(tmp, PULL_STATE)  # atomic: a reader never sees half a file


def pull_state():
    """The last pull, or None. `running` is false once it finished, failed or went stale."""
    try:
        s = json.loads(PULL_STATE.read_text())
    except (OSError, ValueError):
        return None
    s["running"] = s.get("status") not in ("success", "error") and time.time() - s.get("updated", 0) < PULL_STALE_AFTER
    return s


@shared_task
def pull_model(name):
    """Stream Ollama's /api/pull for `name`, writing {model, percent, status} as it goes."""
    import urllib.request

    url = hw.ollama_url(hw.profile()).rstrip("/")
    _write_pull({"model": name, "percent": 0, "status": "starting"})
    percent, last = 0, 0.0
    layers = {}  # digest -> (completed, total): Ollama reports each layer from 0 again
    try:
        req = urllib.request.Request(
            f"{url}/api/pull", data=json.dumps({"model": name, "stream": True}).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=3600) as r:
            for line in r:
                d = json.loads(line or b"{}")
                if d.get("error"):
                    raise RuntimeError(d["error"])
                if d.get("total") and d.get("digest"):
                    layers[d["digest"]] = (d.get("completed", 0), d["total"])
                    # one bar for the whole model: bytes done over bytes known, never backwards
                    done = sum(c for c, _ in layers.values())
                    total = sum(t for _, t in layers.values())
                    percent = max(percent, min(99, round(100 * done / total)))
                if time.monotonic() - last >= 1:  # at most one write a second
                    _write_pull({"model": name, "percent": percent, "status": d.get("status", "pulling")})
                    last = time.monotonic()
        _write_pull({"model": name, "percent": 100, "status": "success"})
    except Exception as e:  # noqa: BLE001 - every failure is reported the same way
        log.warning("pull of %s failed: %s", name, e)
        _write_pull({"model": name, "percent": percent, "status": "error", "error": str(e)[:300]})
