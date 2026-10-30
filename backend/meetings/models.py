import uuid
from pathlib import Path

from django.db import models


def upload_path(instance, filename):
    return f"uploads/{uuid.uuid4().hex}{Path(filename).suffix.lower()}"


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
    tier_used = models.CharField(max_length=8, blank=True)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created"]

    def set_status(self, status, progress=None):
        self.status = status
        if progress is not None:
            self.progress = progress
        self.save(update_fields=["status", "progress"])

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
