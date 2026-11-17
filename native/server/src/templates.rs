//! Note templates: what a meeting's summary should focus on (backend/meetings/note_templates.py).
//! The six built-ins live here, read-only; own templates are rows of note_templates, id "u<pk>".

use rusqlite::{Connection, OptionalExtension};

pub struct Builtin {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub instructions: &'static str,
}

pub const BUILTINS: &[Builtin] = &[
    Builtin {
        id: "general",
        name: "General",
        description: "Balanced notes for any meeting.",
        instructions: "Summarize what was discussed and what was decided. Keep it neutral and short.",
    },
    Builtin {
        id: "standup",
        name: "Stand-up",
        description: "Yesterday, today and blockers, per person.",
        instructions: "This is a daily stand-up. For each person, say what they finished, what they will do next and any blocker. Put blockers first in the summary. Skip small talk.",
    },
    Builtin {
        id: "one-on-one",
        name: "One-on-one",
        description: "Feedback, growth and follow-ups between two people.",
        instructions: "This is a one-on-one. Focus on feedback given, concerns raised, career or growth topics, and what each person agreed to follow up on. Keep a supportive tone.",
    },
    Builtin {
        id: "client-call",
        name: "Client call",
        description: "Client needs, commitments, pricing and next steps.",
        instructions: "This is a call with a client. Focus on the client's needs and pain points, what we committed to, any prices, dates or scope mentioned, risks, and the agreed next steps.",
    },
    Builtin {
        id: "interview",
        name: "Interview",
        description: "The candidate's answers, strengths and concerns.",
        instructions: "This is a job interview. Summarize the candidate's background and answers, the strengths and concerns that came up, and any follow-up the interviewers agreed on. Do not invent a hiring decision.",
    },
    Builtin {
        id: "lecture",
        name: "Lecture",
        description: "Key concepts, definitions and examples, as study notes.",
        instructions: "This is a lecture or talk. Write study notes: the main concepts in order, definitions, examples and anything the speaker said would be important. Action items are homework or readings, if any.",
    },
];

pub const DEFAULT_ID: &str = "general";

/// The instructions for a template id, or for `default` when the id is empty or gone.
pub fn instructions(db: &Connection, id: &str, default: &str) -> String {
    let lookup = |id: &str| -> Option<String> {
        if let Some(b) = BUILTINS.iter().find(|b| b.id == id) {
            return Some(b.instructions.to_string());
        }
        let pk: i64 = id.strip_prefix('u')?.parse().ok()?;
        db.query_row("SELECT instructions FROM note_templates WHERE id = ?1", [pk], |r| r.get(0)).optional().ok().flatten()
    };
    lookup(id).or_else(|| lookup(default)).or_else(|| lookup(DEFAULT_ID)).unwrap_or_default()
}
