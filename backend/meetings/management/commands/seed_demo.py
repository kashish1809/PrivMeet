"""Fill an empty install with the mockup's meetings, without Whisper or Ollama.

    python manage.py seed_demo            # adds the demo meetings that are not there yet
    python manage.py seed_demo --reset    # deletes the demo meetings first, then adds them

Demo rows carry tier_used="demo"; --reset deletes only those, never a real meeting.
"""

import subprocess
import tempfile
from datetime import datetime
from pathlib import Path

from django.core.files import File
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from meetings.models import Meeting, Segment

DEMO = "demo"

# Title, minutes, status, progress, error, date (the mockup's; None = now). Content is in
# CONTENT below.
MEETINGS = [
    ("Project Sync", 42, Meeting.Status.DONE, 100, "", (2026, 10, 28, 10, 30)),
    ("Design Review", 36, Meeting.Status.DONE, 100, "", (2026, 10, 27, 15, 0)),
    ("Team Sync", 51, Meeting.Status.DONE, 100, "", (2026, 10, 24, 11, 0)),  # no summary: "Processed"
    ("Client Onboarding", 18, Meeting.Status.FAILED, 80, "Ollama is not reachable at http://localhost:11434.",
     (2026, 10, 22, 16, 0)),
    ("Sprint Planning", 47, Meeting.Status.TRANSCRIBING, 40, "", None),  # processing now
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
    "Design Review": dict(
        speakers=["Meera", "Kabir", "Vinayak"],
        summary=(
            "The team reviewed the new onboarding screens. The layout was approved with two "
            "changes: a clearer empty state and larger touch targets on mobile. Dark mode "
            "colours need one more contrast pass before hand-off."
        ),
        decisions=[
            "Onboarding layout approved",
            "Empty state needs a clearer call to action",
            "Touch targets grow to 44 px on mobile",
            "One more contrast pass on dark mode",
        ],
        action_items=[
            {"task": "Redesign the empty state", "owner": "Meera", "due": "Oct 30", "done": False},
            {"task": "Bump mobile touch targets to 44 px", "owner": "Kabir", "due": "Friday", "done": True},
            {"task": "Run a contrast check on dark mode", "owner": "Vinayak", "due": "next week", "done": False},
        ],
        lines=[
            (2, "Let's go through the onboarding screens Meera shared."),
            (0, "Three screens: welcome, connect your calendar, and the empty meetings list."),
            (0, "I kept the layout close to the dashboard so it feels familiar."),
            (1, "The welcome screen reads well. The illustration is a nice touch."),
            (2, "Agreed. The connect step is clear too, one button and a skip link."),
            (1, "My worry is the empty list. It just says no meetings yet."),
            (0, "True, there's no next step. I can add a call to action there."),
            (2, "Maybe two buttons, start recording and upload a file."),
            (0, "That works. I'll redesign the empty state with both."),
            (1, "On mobile the buttons feel tiny. I missed the skip link twice."),
            (2, "What size are they now?"),
            (1, "Thirty-two pixels high. Guidelines say at least forty-four."),
            (0, "Let's make every touch target forty-four on mobile."),
            (1, "I'll take that one, it's mostly spacing tokens."),
            (2, "Kabir, can you have it by Friday?"),
            (1, "Yes, Friday is fine."),
            (2, "Now dark mode. Some grey text looks faint to me."),
            (0, "The hint text under the inputs is the lightest grey."),
            (2, "We should measure it, not eyeball it."),
            (1, "There are contrast checkers built into the browser tools now."),
            (2, "I'll run a contrast check on every dark screen next week."),
            (0, "If anything fails I'll adjust the palette, not single screens."),
            (2, "Good, fix it once in the tokens."),
            (1, "Do we need another review after these changes?"),
            (2, "A quick async one is enough. Post screenshots in the channel."),
            (0, "I'll post them by Thursday."),
            (2, "Then the layout is approved with those changes."),
            (1, "Nice work Meera, it looks much cleaner than the old flow."),
            (0, "Thanks, the feedback helped."),
            (2, "Okay, that's it for the design review. Thanks both."),
        ],
    ),
    # Done, but the model wrote nothing: the list shows "Processed" (has_summary is false).
    "Team Sync": dict(
        speakers=["Aryan", "Rohan", "Sneha", "Meera", "Vinayak"],
        lines=[
            (4, "Quick round today, everyone share what you're on."),
            (0, "Still on the API, mostly reviewing pull requests."),
            (1, "Error handling, I started mapping auth failures."),
            (2, "Docs. I'm collecting examples for the auth section."),
            (3, "Design fixes from the review, the empty state first."),
            (4, "Any blockers for anyone?"),
            (1, "I need the staging database refreshed, it's a week old."),
            (0, "I can do that after this call."),
            (2, "I'm waiting on the final error messages before I write them up."),
            (1, "They should be stable by Friday."),
            (3, "I need someone to test the new screens on a real phone."),
            (4, "I have an Android phone here, I'll try them today."),
            (0, "I can test on iOS tomorrow morning."),
            (4, "Let's talk about the release date."),
            (1, "If errors land Friday, a candidate on Monday is realistic."),
            (2, "Docs would follow the same week."),
            (3, "Design changes are small, they'll be in before Monday."),
            (4, "So Monday for the release candidate, if nothing slips."),
            (0, "Should we freeze new features until then?"),
            (4, "Yes, bug fixes only until the candidate is tagged."),
            (1, "Fine by me."),
            (2, "Same."),
            (3, "Works for me."),
            (4, "Also, the office is closed next Thursday for the holiday."),
            (0, "Good to know, I'll move my review session."),
            (2, "Can we keep this sync on Fridays after the release?"),
            (4, "Let's keep Fridays, it's been working."),
            (1, "One more thing, the CI runs got slow this week."),
            (0, "I'll look at the cache settings, probably the dependency step."),
            (4, "Thanks all, that's the sync."),
        ],
    ),
    "Client Onboarding": dict(
        speakers=["Vinayak", "Client"],
        lines=[
            (0, "Thanks for joining, let's walk through the setup."),
            (1, "Sure, we installed it on a laptop last week."),
            (0, "Great. Did the first meeting process without errors?"),
            (1, "The transcript came through, the summary did not."),
            (0, "That usually means the language model was not running."),
            (1, "We may have closed Ollama after the install."),
        ],
    ),
    # Stuck mid-transcription, so it carries only the part that was transcribed.
    "Sprint Planning": dict(
        speakers=["Aryan", "Rohan", "Vinayak"],
        lines=[
            (2, "Let's plan the next sprint, starting with carry-over."),
            (0, "Two API tickets carry over, both nearly done."),
            (1, "Error handling carries over too, it's half finished."),
            (2, "Then new work: the export formats and the share page."),
            (0, "I can take exports, I know that code."),
            (1, "I'll pair on the share page once errors are merged."),
        ],
    ),
}


def lines_to_segments(m, lines):
    """Spread the lines evenly over the transcribed part (all of it unless the meeting is
    still transcribing), each a little shorter than its slot."""
    done = m.duration if m.status != Meeting.Status.TRANSCRIBING else m.duration * m.progress / 100
    slot = done / max(len(lines), 1)
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
        for title, minutes, status, progress, error, when in MEETINGS:
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
                    if when:  # created is auto_now_add, so the date is set after the insert
                        Meeting.objects.filter(pk=m.pk).update(
                            created=timezone.make_aware(datetime(*when))
                        )
            made += 1
        self.stdout.write(self.style.SUCCESS(f"Added {made} demo meeting(s)."))
