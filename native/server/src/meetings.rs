//! Meetings: the row, its JSON (views.meeting_json, the shape the React app reads), the field
//! rules of views.clean_tags / clean_notes, and the stale-run check (models.is_stale).

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::{json, Value};

use crate::db;

pub const ALLOWED_EXT: &[&str] = &[".flac", ".m4a", ".mkv", ".mov", ".mp3", ".mp4", ".ogg", ".opus", ".wav", ".webm"];
pub const PROCESSING: &[&str] = &["queued", "converting", "transcribing", "diarizing", "summarizing"];
pub const STATUSES: &[&str] = &["queued", "converting", "transcribing", "diarizing", "summarizing", "done", "failed"];
pub const MAX_TAGS: usize = 10;
pub const MAX_TAG_LEN: usize = 30;
pub const MAX_NOTES: usize = 20_000;
/// A processing row untouched for this long has lost its worker (models.STALE_AFTER).
pub const STALE_AFTER: f64 = 1200.0;
pub const CANCELLED: &str = "Cancelled.";
pub const STALE_ERROR: &str =
    "Processing stopped before it finished: the worker was killed or crashed. Press Retry to run it again.";

#[derive(Clone, Debug)]
pub struct Meeting {
    pub id: String,
    pub title: String,
    pub file: String,
    pub duration: f64,
    pub language: String,
    pub status: String,
    pub progress: i64,
    pub error: String,
    pub summary: String,
    pub decisions: Value,
    pub action_items: Value,
    pub speaker_names: Value,
    pub notes: String,
    pub tags: Value,
    pub template: String,
    pub tier_used: String,
    pub device_used: String,
    pub created: String,
    pub heartbeat: String,
    /// The language asked for at upload ("" = detect); `language` holds what Whisper found.
    pub language_hint: String,
    /// Transcribe into English (Whisper's translate task).
    pub translate: bool,
}

pub const COLUMNS: &str = "id, title, file, duration, language, status, progress, error, summary, decisions, \
    action_items, speaker_names, notes, tags, template, tier_used, device_used, created, heartbeat, language_hint, translate";

fn json_col(row: &Row, i: usize, empty: Value) -> rusqlite::Result<Value> {
    let s: String = row.get(i)?;
    Ok(serde_json::from_str(&s).unwrap_or(empty))
}

impl Meeting {
    pub fn from_row(r: &Row) -> rusqlite::Result<Self> {
        Ok(Meeting {
            id: r.get(0)?,
            title: r.get(1)?,
            file: r.get(2)?,
            duration: r.get(3)?,
            language: r.get(4)?,
            status: r.get(5)?,
            progress: r.get(6)?,
            error: r.get(7)?,
            summary: r.get(8)?,
            decisions: json_col(r, 9, json!([]))?,
            action_items: json_col(r, 10, json!([]))?,
            speaker_names: json_col(r, 11, json!({}))?,
            notes: r.get(12)?,
            tags: json_col(r, 13, json!([]))?,
            template: r.get(14)?,
            tier_used: r.get(15)?,
            device_used: r.get(16)?,
            created: r.get(17)?,
            heartbeat: r.get(18)?,
            language_hint: r.get(19)?,
            translate: r.get(20)?,
        })
    }

    /// A processing meeting whose worker has not reported for at least STALE_AFTER, and never
    /// less than the recording's length (a CPU run slower than real time is normal).
    pub fn is_stale(&self) -> bool {
        let after = STALE_AFTER.max(self.duration);
        PROCESSING.contains(&self.status.as_str())
            && db::unix_from_iso(&self.heartbeat).is_some_and(|hb| db::now_unix() - hb > after)
    }

    /// "Speaker 3", or the saved name for speaker 2 (numbers start at 0, labels at 1).
    pub fn speaker_label(&self, speaker: Option<i64>, guessed: Option<&std::collections::HashMap<i64, String>>) -> String {
        let Some(n) = speaker else { return String::new() };
        self.speaker_names
            .get(n.to_string())
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(String::from)
            .or_else(|| guessed.and_then(|g| g.get(&n).cloned()))
            .unwrap_or_else(|| format!("Speaker {}", n + 1))
    }
}

pub fn get(db: &Connection, id: &str) -> rusqlite::Result<Option<Meeting>> {
    db.query_row(&format!("SELECT {COLUMNS} FROM meetings WHERE id = ?1"), [id], Meeting::from_row).optional()
}

#[derive(Clone, Debug)]
pub struct Segment {
    pub id: i64,
    pub start: f64,
    pub end: f64,
    pub speaker: Option<i64>,
    pub text: String,
}

pub fn segments(db: &Connection, meeting: &str) -> rusqlite::Result<Vec<Segment>> {
    let mut st = db.prepare_cached("SELECT id, start, end, speaker, text FROM segments WHERE meeting_id = ?1 ORDER BY start, id")?;
    let rows = st.query_map([meeting], |r| {
        Ok(Segment { id: r.get(0)?, start: r.get(1)?, end: r.get(2)?, speaker: r.get(3)?, text: r.get(4)? })
    })?;
    rows.collect()
}

/// A transcript line as the API returns it; `id` is what PATCH /api/segments/<id>/ takes.
pub fn segment_json(s: &Segment) -> Value {
    json!({"id": s.id, "start": s.start, "end": s.end, "speaker": s.speaker, "text": s.text})
}

/// Speaker numbers a line of this meeting may be given: the ones in its transcript or its
/// saved names, plus one new number after them (to split a line off to a new person).
pub fn speaker_choices(db: &Connection, m: &Meeting) -> Vec<i64> {
    let mut nums: Vec<i64> = db
        .prepare_cached("SELECT DISTINCT speaker FROM segments WHERE meeting_id = ?1 AND speaker IS NOT NULL")
        .and_then(|mut st| st.query_map([&m.id], |r| r.get(0))?.collect())
        .unwrap_or_default();
    if let Some(names) = m.speaker_names.as_object() {
        nums.extend(names.keys().filter_map(|k| k.parse::<i64>().ok()));
    }
    nums.sort_unstable();
    nums.dedup();
    nums.push(nums.last().map_or(0, |n| n + 1));
    nums
}

/// Transcript text as an edit stores it: trimmed, not empty, at most 2000 characters.
pub fn clean_segment_text(v: &Value) -> Result<String, String> {
    let t = v.as_str().ok_or("text must be a string.")?.trim();
    if t.is_empty() {
        return Err("text cannot be empty.".into());
    }
    if t.chars().count() > 2000 {
        return Err("text can be at most 2000 characters.".into());
    }
    Ok(t.to_string())
}

pub fn speaker_count(db: &Connection, meeting: &str) -> i64 {
    db.query_row(
        "SELECT count(DISTINCT speaker) FROM segments WHERE meeting_id = ?1 AND speaker IS NOT NULL",
        [meeting],
        |r| r.get(0),
    )
    .unwrap_or(0)
}

/// The meeting as the API returns it (views.meeting_json); `full` adds the notes, the
/// transcript and the rest of the detail page.
pub fn to_json(db: &Connection, m: &Meeting, full: bool) -> Value {
    let mut d = json!({
        "id": m.id, "title": m.title, "status": m.status, "progress": m.progress,
        "duration": m.duration, "created": m.created, "error": m.error,
        "speakers": speaker_count(db, &m.id), "has_summary": !m.summary.trim().is_empty(), "tags": m.tags,
        "queue_position": if m.status == "queued" { crate::pipeline::queue_position(&m.id) } else { None },
    });
    if full {
        let segs: Vec<Value> = segments(db, &m.id)
            .unwrap_or_default()
            .into_iter()
            .map(|s| segment_json(&s))
            .collect();
        let extra = json!({
            "notes": m.notes, "language": m.language, "summary": m.summary, "decisions": m.decisions,
            "action_items": m.action_items, "speaker_names": m.speaker_names, "tier_used": m.tier_used,
            "template": m.template, "device_used": m.device_used, "segments": segs,
            "language_hint": m.language_hint, "translate": m.translate,
        });
        d.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
    }
    d
}

/// Mark a stale processing meeting failed, so the page offers Retry (views.reap).
pub fn reap(db: &Connection, m: &mut Meeting) {
    if m.is_stale() {
        eprintln!("meeting {} stale in {} since {}, marking failed", m.id, m.status, m.heartbeat);
        m.error = STALE_ERROR.into();
        m.status = "failed".into();
        m.progress = 0;
        m.heartbeat = db::now_iso();
        let _ = db.execute(
            "UPDATE meetings SET error = ?2, status = 'failed', progress = 0, heartbeat = ?3 WHERE id = ?1",
            params![m.id, m.error, m.heartbeat],
        );
    }
}

/// Whether the user asked to stop this meeting's run (POST .../cancel).
pub fn cancel_requested(db: &Connection, id: &str) -> bool {
    db.query_row("SELECT cancel_requested FROM meetings WHERE id = ?1", [id], |r| r.get::<_, bool>(0)).unwrap_or(false)
}

/// Status and progress, with the heartbeat touched (models.set_status).
pub fn set_status(db: &Connection, id: &str, status: &str, progress: Option<i64>) {
    let _ = match progress {
        Some(p) => db.execute(
            "UPDATE meetings SET status = ?2, progress = ?3, heartbeat = ?4 WHERE id = ?1",
            params![id, status, p, db::now_iso()],
        ),
        None => db.execute("UPDATE meetings SET status = ?2, heartbeat = ?3 WHERE id = ?1", params![id, status, db::now_iso()]),
    };
}

/// Tags from a JSON list, a JSON string of a list (multipart upload) or "a, b". Trimmed,
/// empty ones and case-insensitive repeats dropped, at most 10 of 30 characters.
pub fn clean_tags(value: &Value) -> Result<Vec<String>, String> {
    let bad = || "tags must be a list of strings.".to_string();
    let list: Vec<Value> = match value {
        Value::String(s) => {
            let t = s.trim();
            if t.starts_with('[') {
                match serde_json::from_str::<Value>(t) {
                    Ok(Value::Array(a)) => a,
                    _ => return Err(bad()),
                }
            } else if t.is_empty() {
                vec![]
            } else {
                t.split(',').map(|x| Value::String(x.into())).collect()
            }
        }
        Value::Array(a) => a.clone(),
        _ => return Err(bad()),
    };
    let mut tags: Vec<String> = Vec::new();
    for v in list {
        let t = v.as_str().ok_or_else(bad)?.trim().to_string();
        if t.is_empty() || tags.iter().any(|x| x.to_lowercase() == t.to_lowercase()) {
            continue;
        }
        if t.chars().count() > MAX_TAG_LEN {
            return Err(format!("A tag can be at most {MAX_TAG_LEN} characters."));
        }
        tags.push(t);
    }
    if tags.len() > MAX_TAGS {
        return Err(format!("A meeting can have at most {MAX_TAGS} tags."));
    }
    Ok(tags)
}

/// The upload's `language`: "" or "auto" is detection, else an ISO code whisper.cpp knows.
pub fn clean_language(v: &str) -> Result<String, String> {
    let code = v.trim().to_lowercase();
    if code.is_empty() || code == "auto" {
        return Ok(String::new());
    }
    // get_lang_id also takes full names ("english"); the API takes codes only
    if code.len() <= 3 && whisper_rs::get_lang_id(&code).is_some() {
        Ok(code)
    } else {
        Err(format!("Unknown language '{code}'. Use an ISO code such as en or hi, or leave it empty."))
    }
}

/// The upload's `translate`: "1" or "true" on, "", "0" or "false" off.
pub fn clean_flag(v: &str, name: &str) -> Result<bool, String> {
    match v.trim().to_lowercase().as_str() {
        "1" | "true" | "on" => Ok(true),
        "" | "0" | "false" | "off" => Ok(false),
        _ => Err(format!("{name} must be 1 or 0.")),
    }
}

pub fn clean_notes(value: &Value) -> Result<String, String> {
    let s = value.as_str().ok_or("notes must be a string.")?;
    if s.chars().count() > MAX_NOTES {
        return Err(format!("Notes can be at most {MAX_NOTES} characters."));
    }
    Ok(s.to_string())
}

/// Action items as the PATCH stores them: owner, task and due as strings (max 500), done a bool.
pub fn clean_action_items(items: &[Value]) -> Value {
    Value::Array(
        items
            .iter()
            .filter_map(Value::as_object)
            .map(|i| {
                let s = |k: &str| -> String {
                    let v = i.get(k).cloned().unwrap_or(Value::Null);
                    let t = match v {
                        Value::Null => String::new(),
                        Value::String(s) => s,
                        Value::Bool(false) => String::new(),
                        other => other.to_string(),
                    };
                    t.chars().take(500).collect()
                };
                let done = match i.get("done") {
                    Some(Value::Bool(b)) => *b,
                    Some(Value::Null) | None => false,
                    Some(Value::String(s)) => !s.is_empty(),
                    Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0) != 0.0,
                    Some(_) => true,
                };
                json!({"owner": s("owner"), "task": s("task"), "due": s("due"), "done": done})
            })
            .collect(),
    )
}

/// Search words of a query (search.words): lower case, longer than 2 letters, no repeats,
/// at most 12. `question` also drops question filler, for Q&A only.
pub fn search_words(text: &str, question: bool) -> Vec<String> {
    const STOP: &str = "the and for are but not you all any can had her was one our out has have him his how its \
        who did what when where why which will with this that they them then there these those \
        from about into over said say says tell told does done been were would could should \
        your yours mine meeting talk talked discuss discussed mention mentioned anyone someone \
        anything something please give list";
    let mut seen: Vec<String> = Vec::new();
    for w in text.to_lowercase().split(|c: char| !(c.is_alphanumeric() || c == '_')) {
        if w.chars().count() > 2 && !(question && STOP.split_whitespace().any(|s| s == w)) && !seen.iter().any(|x| x == w) {
            seen.push(w.to_string());
        }
    }
    seen.truncate(12);
    seen
}

/// An FTS5 query matching any of the words, each quoted so no word is read as syntax.
pub fn fts_query(words: &[String]) -> String {
    words.iter().map(|w| format!("\"{}\"", w.replace('"', ""))).collect::<Vec<_>>().join(" OR ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tags_like_django() {
        assert_eq!(clean_tags(&json!("API, design , api,")).unwrap(), vec!["API", "design"]);
        assert_eq!(clean_tags(&json!("[\"a\",\"b\"]")).unwrap(), vec!["a", "b"]);
        assert_eq!(clean_tags(&json!(["x"; 11].iter().enumerate().map(|(i, _)| format!("t{i}")).collect::<Vec<_>>())).unwrap_err(), "A meeting can have at most 10 tags.");
        assert_eq!(clean_tags(&json!(["x".repeat(31)])).unwrap_err(), "A tag can be at most 30 characters.");
        assert_eq!(clean_tags(&json!([1])).unwrap_err(), "tags must be a list of strings.");
        assert_eq!(clean_tags(&json!("[oops")).unwrap_err(), "tags must be a list of strings.");
    }

    #[test]
    fn languages_and_flags() {
        assert_eq!(clean_language(" HI ").unwrap(), "hi");
        assert_eq!(clean_language("auto").unwrap(), "");
        assert_eq!(clean_language("").unwrap(), "");
        assert!(clean_language("english").is_err() && clean_language("xx").is_err());
        assert_eq!((clean_flag("1", "translate"), clean_flag("", "translate")), (Ok(true), Ok(false)));
        assert_eq!(clean_flag("yes", "translate").unwrap_err(), "translate must be 1 or 0.");
    }

    #[test]
    fn notes_items_and_words() {
        assert_eq!(clean_notes(&json!(5)).unwrap_err(), "notes must be a string.");
        assert_eq!(clean_action_items(&[json!({"task": "Fix", "owner": null, "done": 1}), json!("junk")]),
                   json!([{"owner": "", "task": "Fix", "due": "", "done": true}]));
        assert_eq!(search_words("What did they say about the budget? Budget!", true), vec!["budget"]);
        assert_eq!(search_words("What did they say about the budget", false)[0], "what");
        assert_eq!(fts_query(&["a\"b".into(), "c".into()]), "\"ab\" OR \"c\"");
    }
}
