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
