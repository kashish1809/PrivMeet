"""Celery tasks. The worker runs with concurrency 1 and one task per child process,
so only one heavy model is in RAM at a time and it is freed when the task ends."""

import json
import logging
import os
import tempfile

from celery import shared_task
from celery.signals import worker_ready
from django.conf import settings

from . import hw
from .models import Meeting, Question, Segment
from .pipeline import audio, diarize, llm
from .pipeline.transcribe import transcribe
from .search import excerpts

log = logging.getLogger(__name__)

WORKER_PROFILE = settings.DATA_DIR / "worker_profile.json"


@worker_ready.connect
def publish_profile(**kwargs):
    # The web container may not see the GPU, so the worker tells it what tier it runs.
    settings.DATA_DIR.mkdir(parents=True, exist_ok=True)
    WORKER_PROFILE.write_text(json.dumps(hw.profile()))


@shared_task
def process_meeting(meeting_id):
    m = Meeting.objects.get(pk=meeting_id)
    prof = hw.profile()
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
        m.duration, m.language = info.duration, info.language
        m.save(update_fields=["duration", "language"])
        batch = []
        for s in segments:
            batch.append(Segment(meeting=m, start=s.start, end=s.end, text=s.text.strip()))
            if len(batch) >= 20:
                Segment.objects.bulk_create(batch)
                batch = []
                m.set_status(Meeting.Status.TRANSCRIBING, 2 + int(68 * s.end / max(info.duration, 1)))
        Segment.objects.bulk_create(batch)
        del segments  # frees the Whisper model before the next stage loads

        if prof["diarize"] and diarize.available():
            m.set_status(Meeting.Status.DIARIZING, 70)
            turns = diarize.diarize(wav, prof["cpu_threads"])
            segs = diarize.assign_speakers(list(m.segments.all()), turns)
            Segment.objects.bulk_update(segs, ["speaker"], batch_size=500)
        elif prof["diarize"]:
            log.warning("diarization models missing in %s, skipping", settings.DIARIZE_MODELS_DIR)

        m.set_status(Meeting.Status.SUMMARIZING, 80)
        llm.ensure_model(prof)
        notes = llm.summarize(
            m.transcript(), prof,
            on_progress=lambda f: m.set_status(Meeting.Status.SUMMARIZING, 80 + int(15 * f)),
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
