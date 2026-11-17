"""Fill an empty install with the mockup's meetings, without Whisper or Ollama.

    python manage.py seed_demo            # adds the demo meetings that are not there yet
    python manage.py seed_demo --reset    # deletes the demo meetings first, then adds them

Demo rows carry tier_used="demo"; --reset deletes only those, never a real meeting.
"""

from django.core.management.base import BaseCommand
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
            with transaction.atomic():
                Meeting.objects.create(
                    title=title, duration=minutes * 60, status=status, progress=progress,
                    error=error, tier_used=DEMO,
                )
            made += 1
        self.stdout.write(self.style.SUCCESS(f"Added {made} demo meeting(s)."))
