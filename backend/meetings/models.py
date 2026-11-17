import uuid
from pathlib import Path

from django.db import models


def upload_path(instance, filename):
    return f"uploads/{uuid.uuid4().hex}{Path(filename).suffix.lower()}"


# A processing row untouched for this long has lost its worker (bug B4).
# Generous on purpose. Progress is written every few seconds *once segments flow*, but the
# stretch before the first one is unbounded: the model is loaded (large-v3 is 2.9 GB), VAD
# runs over the whole file, and the first segment is decoded. large-v3 on this CPU took 308 s
# to get that far and a 300 s limit declared the healthy run dead, wiping its row. The check
# exists to recover a worker that is gone, which nothing else will ever do, so waiting longer
# costs nothing; a false positive destroys a run that was working.
STALE_AFTER = 1200


def mmss(seconds):
    s = int(seconds)
    return f"{s // 3600}:{s // 60 % 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60:02d}:{s % 60:02d}"


class Meeting(models.Model):
    class Status(models.TextChoices):
        QUEUED = "queued"
        CONVERTING = "converting"
        TRANSCRIBING = "transcribing"
        DIARIZING = "diarizing"
        SUMMARIZING = "summarizing"
        DONE = "done"
        FAILED = "failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=200)
    file = models.FileField(upload_to=upload_path)
    duration = models.FloatField(default=0)
    language = models.CharField(max_length=16, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.QUEUED)
    progress = models.PositiveSmallIntegerField(default=0)
    error = models.TextField(blank=True)
    summary = models.TextField(blank=True)
    decisions = models.JSONField(default=list)
    action_items = models.JSONField(default=list)
    speaker_names = models.JSONField(default=dict)  # {"0": "Alice"}
    notes = models.TextField(blank=True, default="")  # the user's own notes, not the AI summary
    tags = models.JSONField(default=list, blank=True)  # ["Development", "API"]: max 10, 30 chars each
    # The note template it was summarized with: a built-in slug or "u<pk>" (note_templates.py).
    template = models.CharField(max_length=40, blank=True, default="")
    tier_used = models.CharField(max_length=8, blank=True)
    # The device transcription really ran on ("cuda" or "cpu"), which is not always the one
    # hw.profile() planned: a CUDA run can fall back to the CPU mid-job (bug B1).
    device_used = models.CharField(max_length=8, blank=True)
    created = models.DateTimeField(auto_now_add=True)
    # Touched by every set_status(), so a run whose worker died can be told from a live one.
    heartbeat = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created"]

    def set_status(self, status, progress=None):
        self.status = status
        if progress is not None:
            self.progress = progress
        # heartbeat is auto_now, so it only moves when it is in update_fields.
        self.save(update_fields=["status", "progress", "heartbeat"])

    def is_stale(self, after=None):
        """A processing meeting whose worker has not reported for long enough that it can only
        be gone. The allowance is at least STALE_AFTER and never less than the recording's own
        length, since a CPU run slower than real time is normal on a low-end machine."""
        from django.utils import timezone

        if after is None:
            after = max(STALE_AFTER, self.duration or 0)
        return self.status in PROCESSING and (timezone.now() - self.heartbeat).total_seconds() > after

    def speaker_label(self, speaker):
        if speaker is None:
            return ""
        return self.speaker_names.get(str(speaker)) or f"Speaker {speaker + 1}"

    def transcript(self, timestamps=False, segments=None):
        lines = []
        for s in self.segments.all() if segments is None else segments:
            prefix = f"[{mmss(s.start)}] " if timestamps else ""
            who = self.speaker_label(s.speaker)
            lines.append(f"{prefix}{who + ': ' if who else ''}{s.text}")
        return "\n".join(lines)


# The statuses that mean "a worker is working on it".
PROCESSING = [
    Meeting.Status.QUEUED, Meeting.Status.CONVERTING, Meeting.Status.TRANSCRIBING,
    Meeting.Status.DIARIZING, Meeting.Status.SUMMARIZING,
]


class Segment(models.Model):
    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name="segments")
    start = models.FloatField()
    end = models.FloatField()
    speaker = models.SmallIntegerField(null=True)
    text = models.TextField()

    class Meta:
        ordering = ["start"]


class Question(models.Model):
    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name="questions")
    question = models.TextField()
    answer = models.TextField(blank=True)
    status = models.CharField(max_length=8, default="pending")  # pending | done | failed
    created = models.DateTimeField(auto_now_add=True)


class NoteTemplate(models.Model):
    """A user's own note template; the built-ins live in note_templates.py."""

    name = models.CharField(max_length=60)
    description = models.CharField(max_length=200, blank=True, default="")
    instructions = models.TextField(max_length=2000)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    @property
    def key(self):
        return f"u{self.pk}"
