"""Fill an empty install with the mockup's meetings, without Whisper or Ollama.

    python manage.py seed_demo            # adds the demo meetings that are not there yet
    python manage.py seed_demo --reset    # deletes the demo meetings first, then adds them

Demo rows carry tier_used="demo"; --reset deletes only those, never a real meeting.
"""

import subprocess
import tempfile
from pathlib import Path

from django.core.files import File
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from meetings.models import Meeting

DEMO = "demo"

# Title, minutes, status, progress, error. Content is filled in by the builders below.
MEETINGS = [
    ("Project Sync", 42, Meeting.Status.DONE, 100, ""),
    ("Design Review", 36, Meeting.Status.DONE, 100, ""),
    ("Team Sync", 51, Meeting.Status.DONE, 100, ""),  # done with no summary: "Processed"
    ("Client Onboarding", 18, Meeting.Status.FAILED, 80, "Ollama is not reachable at http://localhost:11434."),
    ("Sprint Planning", 47, Meeting.Status.TRANSCRIBING, 40, ""),
]


def silence(seconds, dst):
    """Silent mono Opus of the given length (8 kb/s; silence compresses further: 51 min is about 1.2 MB), so the
    player and seeking work. List args, never a shell; same timeout as the pipeline."""
    try:
        subprocess.run(
            ["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-f", "lavfi",
             "-i", "anullsrc=r=16000:cl=mono", "-t", str(seconds), "-c:a", "libopus", "-b:a", "8k", str(dst)],
            check=True, capture_output=True, timeout=3 * 3600,
        )
    except FileNotFoundError:
        raise CommandError("ffmpeg is not installed; it makes the demo audio.") from None
    except subprocess.CalledProcessError as e:
        raise CommandError(f"ffmpeg failed: {e.stderr.decode(errors='replace')[-300:]}") from None


class Command(BaseCommand):
    help = "Create the mockup's demo meetings (no Whisper or Ollama needed). Safe to run twice."

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true", help="delete the demo meetings first")

    def handle(self, reset=False, **opts):
        demo = Meeting.objects.filter(tier_used=DEMO)
        if reset:
            gone = 0
            for m in demo:
                m.file.delete(save=False)
                m.delete()
                gone += 1
            self.stdout.write(f"Deleted {gone} demo meeting(s).")
        have = set(demo.values_list("title", flat=True))
        made = 0
        for title, minutes, status, progress, error in MEETINGS:
            if title in have:
                continue  # running twice adds nothing
            with tempfile.TemporaryDirectory() as tmp:
                clip = Path(tmp) / "demo.opus"
                silence(minutes * 60, clip)
                with transaction.atomic(), clip.open("rb") as f:
                    m = Meeting(
                        title=title, duration=minutes * 60, status=status, progress=progress,
                        error=error, tier_used=DEMO,
                    )
                    m.file.save(clip.name, File(f), save=True)
            made += 1
        self.stdout.write(self.style.SUCCESS(f"Added {made} demo meeting(s)."))
