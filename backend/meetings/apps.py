from django.apps import AppConfig
from django.conf import settings
from django.db.utils import DatabaseError, OperationalError, ProgrammingError


class MeetingsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "meetings"

    def ready(self):
        if settings.CELERY_TASK_ALWAYS_EAGER:
            reap_interrupted()


def reap_interrupted():
    """Fail the meetings that were processing when this process last stopped.

    With CELERY_EAGER the pipeline runs inside the web process, so a restart, a crash or a
    Ctrl-C takes the transcription with it and nothing will ever move that row again. The
    heartbeat check in views.reap only frees it after STALE_AFTER, which left a dead meeting
    unretryable for twenty minutes. At startup the answer is certain: no run can have
    survived, so every processing row is finished and offers Retry at once.

    Not done with a real worker (CELERY_EAGER unset): there the web process restarts on its
    own while the worker keeps transcribing.
    """
    import logging

    from .models import PROCESSING, Meeting

    log = logging.getLogger(__name__)
    try:
        rows = list(Meeting.objects.filter(status__in=PROCESSING))
        for m in rows:
            m.error = "The server stopped while this was processing. Press Retry to run it again."
            m.status, m.progress = Meeting.Status.FAILED, 0
            m.save(update_fields=["error", "status", "progress", "heartbeat"])
        if rows:
            log.warning("freed %d meeting(s) left processing by the previous run", len(rows))
    except (DatabaseError, OperationalError, ProgrammingError):
        pass  # no database yet (first migrate, or a manage.py command that does not need one)
