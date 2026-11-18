//! Note templates: what a meeting's summary should focus on.
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

// ---- the API (views.templates, views.template_detail)

use axum::{
    body::Bytes,
    extract::{Path as UrlPath, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Map, Value};

use crate::web::{error, AppState};

const LIMITS: [(&str, usize); 3] = [("name", 60), ("description", 200), ("instructions", 2000)];

struct Own {
    pk: i64,
    name: String,
    description: String,
    instructions: String,
}

fn builtin_json(b: &Builtin, default: &str) -> Value {
    json!({"id": b.id, "name": b.name, "description": b.description, "instructions": b.instructions,
           "builtin": true, "is_default": b.id == default})
}

fn own_json(t: &Own, default: &str) -> Value {
    let key = format!("u{}", t.pk);
    json!({"id": key, "name": t.name, "description": t.description, "instructions": t.instructions,
           "builtin": false, "is_default": key == default})
}

fn own(db: &Connection, pk: i64) -> Option<Own> {
    db.query_row("SELECT id, name, description, instructions FROM note_templates WHERE id = ?1", [pk], |r| {
        Ok(Own { pk: r.get(0)?, name: r.get(1)?, description: r.get(2)?, instructions: r.get(3)? })
    })
    .optional()
    .ok()
    .flatten()
}

/// Validated {name, description, instructions} (views.clean_template); `partial` for PATCH.
fn clean(body: &Bytes, partial: bool) -> Result<Map<String, Value>, String> {
    let data: Value = if body.is_empty() { json!({}) } else { serde_json::from_slice(body).map_err(|_| "Invalid JSON.".to_string())? };
    clean_value(&data, partial)
}

/// The same rules on a parsed value (a template read back from a backup).
pub fn clean_value(data: &Value, partial: bool) -> Result<Map<String, Value>, String> {
    let Value::Object(data) = data else { return Err("Expected a JSON object.".into()) };
    let mut out = Map::new();
    for (key, limit) in LIMITS {
        let Some(v) = data.get(key) else {
            if !partial && key != "description" {
                return Err(format!("{key} is required."));
            }
            continue;
        };
        let Some(v) = v.as_str() else { return Err(format!("{key} must be a string.")) };
        let v = v.trim();
        if v.chars().count() > limit {
            return Err(format!("{key} can be at most {limit} characters."));
        }
        if v.is_empty() && key != "description" {
            return Err(format!("{key} cannot be empty."));
        }
        out.insert(key.into(), Value::String(v.into()));
    }
    Ok(out)
}

fn text(m: &Map<String, Value>, k: &str) -> Option<String> {
    m.get(k).and_then(Value::as_str).map(String::from)
}

/// GET /api/templates/: the built-ins, then the user's own by name. POST makes one.
pub async fn list(State(app): State<AppState>) -> Response {
    let default = app.default_template();
    let db = app.db();
    let mut out: Vec<Value> = BUILTINS.iter().map(|b| builtin_json(b, &default)).collect();
    let rows: Vec<Own> = db
        .prepare("SELECT id, name, description, instructions FROM note_templates ORDER BY name, id")
        .and_then(|mut st| {
            st.query_map([], |r| Ok(Own { pk: r.get(0)?, name: r.get(1)?, description: r.get(2)?, instructions: r.get(3)? }))?.collect()
        })
        .unwrap_or_default();
    out.extend(rows.iter().map(|t| own_json(t, &default)));
    Json(json!({"templates": out})).into_response()
}

pub async fn create(State(app): State<AppState>, body: Bytes) -> Response {
    let data = match clean(&body, false) {
        Ok(d) => d,
        Err(e) => return error(StatusCode::BAD_REQUEST, e),
    };
    let t = {
        let db = app.db();
        let done = db.execute(
            "INSERT INTO note_templates (name, description, instructions, created) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![text(&data, "name"), text(&data, "description").unwrap_or_default(), text(&data, "instructions"), crate::db::now_iso()],
        );
        if done.is_err() {
            return error(StatusCode::INTERNAL_SERVER_ERROR, "Could not save the template.");
        }
        own(&db, db.last_insert_rowid())
    };
    let Some(t) = t else { return error(StatusCode::INTERNAL_SERVER_ERROR, "Could not save the template.") };
    (StatusCode::CREATED, Json(own_json(&t, &app.default_template()))).into_response()
}

enum Found {
    Builtin(&'static Builtin),
    Own(Own),
}

fn find(app: &AppState, id: &str) -> Option<Found> {
    if let Some(b) = BUILTINS.iter().find(|b| b.id == id) {
        return Some(Found::Builtin(b));
    }
    let pk: i64 = id.strip_prefix('u').filter(|n| n.chars().all(|c| c.is_ascii_digit())).and_then(|n| n.parse().ok())?;
    own(&app.db(), pk).map(Found::Own)
}

const READ_ONLY: &str = "Built-in templates cannot be changed. Make your own instead.";

pub async fn detail(State(app): State<AppState>, UrlPath(id): UrlPath<String>) -> Response {
    match find(&app, &id) {
        Some(Found::Builtin(b)) => Json(builtin_json(b, &app.default_template())).into_response(),
        Some(Found::Own(t)) => Json(own_json(&t, &app.default_template())).into_response(),
        None => error(StatusCode::NOT_FOUND, "Not found."),
    }
}

pub async fn patch(State(app): State<AppState>, UrlPath(id): UrlPath<String>, body: Bytes) -> Response {
    let mut t = match find(&app, &id) {
        Some(Found::Own(t)) => t,
        Some(Found::Builtin(_)) => return error(StatusCode::FORBIDDEN, READ_ONLY),
        None => return error(StatusCode::NOT_FOUND, "Not found."),
    };
    let data = match clean(&body, true) {
        Ok(d) => d,
        Err(e) => return error(StatusCode::BAD_REQUEST, e),
    };
    t.name = text(&data, "name").unwrap_or(t.name);
    t.description = text(&data, "description").unwrap_or(t.description);
    t.instructions = text(&data, "instructions").unwrap_or(t.instructions);
    let _ = app.db().execute(
        "UPDATE note_templates SET name = ?2, description = ?3, instructions = ?4 WHERE id = ?1",
        rusqlite::params![t.pk, t.name, t.description, t.instructions],
    );
    Json(own_json(&t, &app.default_template())).into_response()
}

pub async fn delete(State(app): State<AppState>, UrlPath(id): UrlPath<String>) -> Response {
    let t = match find(&app, &id) {
        Some(Found::Own(t)) => t,
        Some(Found::Builtin(_)) => return error(StatusCode::FORBIDDEN, READ_ONLY),
        None => return error(StatusCode::NOT_FOUND, "Not found."),
    };
    if app.default_template() == format!("u{}", t.pk) {
        // back to General
        let _ = crate::settings::save(&app.cfg.data_dir, &json!({"default_template": null}), &|i| app.template_exists(i));
    }
    let _ = app.db().execute("DELETE FROM note_templates WHERE id = ?1", [t.pk]);
    StatusCode::NO_CONTENT.into_response()
}
