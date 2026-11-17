"""Note templates: what the summary should focus on.

The built-ins below are read-only and live in code; the user's own templates are
NoteTemplate rows (models.py). Both are served by /api/templates/ with the same shape:
{id, name, description, instructions, builtin, is_default}. A meeting stores the id it was
summarized with (Meeting.template); built-in ids are slugs, own ones are "u<pk>".
"""

BUILTINS = [
    {
        "id": "general",
        "name": "General",
        "description": "Balanced notes for any meeting.",
        "instructions": "Summarize what was discussed and what was decided. Keep it neutral and short.",
    },
    {
        "id": "standup",
        "name": "Stand-up",
        "description": "Yesterday, today and blockers, per person.",
        "instructions": (
            "This is a daily stand-up. For each person, say what they finished, what they will do "
            "next and any blocker. Put blockers first in the summary. Skip small talk."
        ),
    },
    {
        "id": "one-on-one",
        "name": "One-on-one",
        "description": "Feedback, growth and follow-ups between two people.",
        "instructions": (
            "This is a one-on-one. Focus on feedback given, concerns raised, career or growth "
            "topics, and what each person agreed to follow up on. Keep a supportive tone."
        ),
    },
    {
        "id": "client-call",
        "name": "Client call",
        "description": "Client needs, commitments, pricing and next steps.",
        "instructions": (
            "This is a call with a client. Focus on the client's needs and pain points, what we "
            "committed to, any prices, dates or scope mentioned, risks, and the agreed next steps."
        ),
    },
    {
        "id": "interview",
        "name": "Interview",
        "description": "The candidate's answers, strengths and concerns.",
        "instructions": (
            "This is a job interview. Summarize the candidate's background and answers, the "
            "strengths and concerns that came up, and any follow-up the interviewers agreed on. "
            "Do not invent a hiring decision."
        ),
    },
    {
        "id": "lecture",
        "name": "Lecture",
        "description": "Key concepts, definitions and examples, as study notes.",
        "instructions": (
            "This is a lecture or talk. Write study notes: the main concepts in order, definitions, "
            "examples and anything the speaker said would be important. Action items are homework "
            "or readings, if any."
        ),
    },
]
BUILTIN_IDS = {t["id"] for t in BUILTINS}
DEFAULT_ID = "general"


def default_id():
    """The template used when an upload names none: the saved default if it still exists."""
    from . import settings_store

    saved = settings_store.load().get("default_template", "")
    return saved if saved and get(saved) else DEFAULT_ID


def as_json(t, default):
    """A built-in dict or a NoteTemplate row, in the API's shape."""
    if isinstance(t, dict):
        return {**t, "builtin": True, "is_default": t["id"] == default}
    return {
        "id": t.key, "name": t.name, "description": t.description, "instructions": t.instructions,
        "builtin": False, "is_default": t.key == default,
    }


def get(tid):
    """The built-in dict or NoteTemplate row for an id, or None."""
    from .models import NoteTemplate

    tid = str(tid or "")
    for t in BUILTINS:
        if t["id"] == tid:
            return t
    if tid.startswith("u") and tid[1:].isdigit():
        return NoteTemplate.objects.filter(pk=int(tid[1:])).first()
    return None


def instructions(tid):
    """What the summary should focus on for a meeting's template id ("" = the default)."""
    t = get(tid or default_id()) or get(DEFAULT_ID)
    return t["instructions"] if isinstance(t, dict) else t.instructions
