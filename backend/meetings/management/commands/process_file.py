"""Run the whole pipeline on one local file, without the web UI or a Celery worker.

    python manage.py process_file meeting.mp3 --title "Weekly sync"
"""

from pathlib import Path

from django.core.files import File
from django.core.management.base import BaseCommand, CommandError

from meetings.models import Meeting, mmss
from meetings.pipeline import audio
from meetings.tasks import process_meeting
from meetings.views import ALLOWED_EXT


class Command(BaseCommand):
    help = "Create a meeting from a local audio/video file and process it synchronously."

    def add_arguments(self, parser):
        parser.add_argument("path", type=Path)
        parser.add_argument("--title", help="defaults to the file name")

    def handle(self, path, title, **opts):
        if not path.is_file():
            raise CommandError(f"No such file: {path}")
        if path.suffix.lower() not in ALLOWED_EXT:
            raise CommandError(f"Unsupported file type. Allowed: {', '.join(sorted(ALLOWED_EXT))}")
        if audio.probe(path) is None:
            raise CommandError("No audio stream found")

        with path.open("rb") as f:
            m = Meeting(title=title or path.stem)
            m.file.save(path.name, File(f), save=True)
        self.stdout.write(f"Meeting {m.pk}: processing {path.name}...")

        process_meeting(m.pk)  # direct call, not .delay(): runs in this process
        m.refresh_from_db()
        self.print_meeting(m)
        if m.status != Meeting.Status.DONE:
            raise CommandError(f"Processing failed: {m.error}")

    def print_meeting(self, m):
        out = self.stdout.write
        segs = list(m.segments.all())
        speakers = sorted({s.speaker for s in segs if s.speaker is not None})
        out(f"\nStatus: {m.status}  tier: {m.tier_used}  duration: {mmss(m.duration)}  language: {m.language}")
        out(f"Speakers: {', '.join(m.speaker_label(s) for s in speakers) or 'none'}")
        out(f"\nTranscript ({len(segs)} segments):")
        out(m.transcript(timestamps=True, segments=segs))
        out(f"\nSummary:\n{m.summary}")
        out("\nDecisions:")
        for d in m.decisions:
            out(f"- {d}")
        out("\nAction items:")
        for a in m.action_items:
            out(f"- {a['task']} (owner: {a['owner'] or '?'}, due: {a['due'] or '?'})")
