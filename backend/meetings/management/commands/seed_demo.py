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

from meetings.models import Meeting, Segment

DEMO = "demo"

# Title, minutes, status, progress, error. Content is filled in by the builders below.
MEETINGS = [
    ("Project Sync", 42, Meeting.Status.DONE, 100, ""),
    ("Design Review", 36, Meeting.Status.DONE, 100, ""),
    ("Team Sync", 51, Meeting.Status.DONE, 100, ""),  # done with no summary: "Processed"
    ("Client Onboarding", 18, Meeting.Status.FAILED, 80, "Ollama is not reachable at http://localhost:11434."),
    ("Sprint Planning", 47, Meeting.Status.TRANSCRIBING, 40, ""),
]

# Speakers are numbered in order of `speakers`; each line is (speaker, text).
CONTENT = {
    "Project Sync": dict(
        speakers=["Aryan", "Rohan", "Sneha", "Vinayak"],
        summary=(
            "The team discussed progress on the authentication module, planned improvements to "
            "error handling, and agreed on documentation updates. All major tasks are on track "
            "for the next release."
        ),
        decisions=[
            "Authentication module is nearly complete",
            "Need to improve error handling",
            "Documentation work will be updated",
            "Latest changes will be pushed by tomorrow",
        ],
        action_items=[
            {"task": "Push latest API changes", "owner": "Aryan", "due": "tomorrow", "done": False},
            {"task": "Improve error handling", "owner": "Rohan", "due": "Friday", "done": False},
            {"task": "Update documentation", "owner": "Sneha", "due": "next week", "done": False},
        ],
        lines=[
            (3, "Morning everyone, let's start with where we are on authentication."),
            (0, "The login and token refresh flows are done and merged on my branch."),
            (0, "Password reset still needs the email template, that's the last piece."),
            (3, "So the authentication module is nearly complete. Any blockers?"),
            (0, "Only the rate limiting review, Rohan said he'd look at it."),
            (1, "Yes, I looked yesterday. The limiter works but the errors are messy."),
            (1, "When a token expires we return a 500 instead of a clean 401."),
            (2, "That explains the support ticket we got about random logouts."),
            (3, "Okay, so error handling needs work. Rohan, can you own that?"),
            (1, "Sure. I'll map every auth failure to a proper status and message."),
            (1, "I can have it done by Friday if nothing else comes up."),
            (3, "Good. Sneha, how are the docs looking?"),
            (2, "The API reference is out of date since the token changes."),
            (2, "The refresh endpoint isn't documented at all right now."),
            (2, "I'd like to rewrite the auth section with examples for each flow."),
            (0, "I can send you the request and response samples from my tests."),
            (2, "That would help a lot, thanks Aryan."),
            (3, "So the documentation work gets updated too. When can it land?"),
            (2, "Next week, once Rohan's error messages are final."),
            (1, "Makes sense, otherwise we document messages that will change."),
            (3, "Aryan, when can the latest API changes be pushed?"),
            (0, "I'll push them by tomorrow, after one more test run."),
            (3, "Great. Anything about the release itself?"),
            (1, "We should tag a release candidate once error handling is in."),
            (2, "And I'll add a short changelog for the auth changes."),
            (0, "Should we demo the new login to the client this sprint?"),
            (3, "Let's wait until the error handling lands, then demo it."),
            (3, "To sum up: auth nearly done, errors by Friday, docs next week."),
            (3, "All major tasks are on track for the next release."),
            (3, "Thanks everyone, see you tomorrow."),
        ],
    ),
}


def lines_to_segments(m, lines):
    """Spread the lines evenly over the meeting, each a little shorter than its slot."""
    slot = m.duration / max(len(lines), 1)
    return [
        Segment(meeting=m, start=round(i * slot, 2), end=round((i + 1) * slot - 1, 2), speaker=who, text=text)
        for i, (who, text) in enumerate(lines)
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
                    c = CONTENT.get(title, {})
                    m.summary = c.get("summary", "")
                    m.decisions = c.get("decisions", [])
                    m.action_items = c.get("action_items", [])
                    m.speaker_names = {str(i): name for i, name in enumerate(c.get("speakers", []))}
                    m.language = "en"
                    m.file.save(clip.name, File(f), save=True)
                    Segment.objects.bulk_create(lines_to_segments(m, c.get("lines", [])))
            made += 1
        self.stdout.write(self.style.SUCCESS(f"Added {made} demo meeting(s)."))
