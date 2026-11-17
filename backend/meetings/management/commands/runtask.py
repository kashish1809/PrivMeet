"""Run one PrivMeet task in this process: `python manage.py runtask process_meeting <id>`.

tasks.enqueue() uses it with CELERY_EAGER, so a meeting runs in a child process whose
memory (LangChain, Whisper, the diarizer) is returned to the system when it exits, instead of
staying in the web process for good (R1.21).
"""

from django.core.management.base import BaseCommand, CommandError

from meetings import tasks

ALLOWED = {"process_meeting": str, "answer_question": int, "pull_model": str}


class Command(BaseCommand):
    help = "Run one task (process_meeting, answer_question or pull_model) here and exit."

    def add_arguments(self, parser):
        parser.add_argument("task", choices=sorted(ALLOWED))
        parser.add_argument("arg")

    def handle(self, task, arg, **opts):
        try:
            value = ALLOWED[task](arg)
        except ValueError:
            raise CommandError(f"Bad argument for {task}: {arg!r}") from None
        getattr(tasks, task)(value)  # the plain function, not .delay
