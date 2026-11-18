//! The meetings API (backend/meetings/views.py): list and search, upload, detail, edit,
//! delete, audio with Range, retry, tags, action items and questions.

use std::path::{Path, PathBuf};

use axum::{
    body::{Body, Bytes},
    extract::{Multipart, Path as UrlPath, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use rusqlite::{params, params_from_iter};
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

use crate::meetings::{self as mt, Meeting};
use crate::web::{error, AppState};
use crate::{audio, db, export, pipeline};

type Params = std::collections::HashMap<String, String>;

fn not_found() -> Response {
    error(StatusCode::NOT_FOUND, "Not found.")
}

/// A meeting by id from the URL, reaped if its run is stale (views.reap on every read).
fn load(app: &AppState, id: &str) -> Option<Meeting> {
    let db = app.db();
    let mut m = mt::get(&db, id).ok().flatten()?;
    mt::reap(&db, &mut m);
    Some(m)
}

fn json_body(body: &Bytes) -> Result<Value, Response> {
    if body.is_empty() {
        return Ok(json!({}));
    }
    serde_json::from_slice(body).map_err(|_| error(StatusCode::BAD_REQUEST, "Invalid JSON."))
}

/// A real calendar date "YYYY-MM-DD" (Python's date.fromisoformat): 2026-13-01 and 2026-02-30
/// are refused, by checking that the date survives a round trip through day numbers.
fn day(v: &str, name: &str) -> Result<String, String> {
    let bad = || format!("{name} must be a date like 2026-10-28.");
    let parts: Vec<&str> = v.split('-').collect();
    let [y, m, d] = parts[..] else { return Err(bad()) };
    if v.len() != 10 || y.len() != 4 || m.len() != 2 || d.len() != 2 {
        return Err(bad());
    }
    let (Ok(y), Ok(m), Ok(d)) = (y.parse::<i64>(), m.parse::<u32>(), d.parse::<u32>()) else { return Err(bad()) };
    if !(1..=12).contains(&m) || d == 0 || db::civil_from_days(db::days_from_civil(y, m, d)) != (y, m, d) {
        return Err(bad());
    }
    Ok(v.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::web::{test_app, test_meeting};

    fn status_of(r: Response) -> StatusCode {
        r.status()
    }

    #[tokio::test]
    async fn summarize_checks_state_and_queues() {
        let dir = tempfile::tempdir().unwrap();
        let app = test_app(dir.path());
        test_meeting(&app, "m1");
        let call = |id: &str, body: &str| summarize(State(app.clone()), UrlPath(id.to_string()), Bytes::from(body.to_string()));
        assert_eq!(status_of(call("nope", "").await), StatusCode::NOT_FOUND);
        assert_eq!(status_of(call("m1", r#"{"template": "zzz"}"#).await), StatusCode::BAD_REQUEST);
        assert_eq!(status_of(call("m1", r#"{"template": "standup"}"#).await), StatusCode::OK);
        assert_eq!(mt::get(&app.db(), "m1").unwrap().unwrap().status, "summarizing");
        assert_eq!(status_of(call("m1", "").await), StatusCode::CONFLICT); // already running
        app.db().execute("UPDATE meetings SET status = 'done'", []).unwrap();
        app.db().execute("DELETE FROM segments", []).unwrap();
        assert_eq!(status_of(call("m1", "").await), StatusCode::CONFLICT); // no transcript
    }

    #[test]
    fn failed_summary_keeps_the_old_notes() {
        let dir = tempfile::tempdir().unwrap();
        let app = test_app(dir.path());
        test_meeting(&app, "m1");
        app.db().execute("UPDATE meetings SET status = 'summarizing'", []).unwrap();
        pipeline::summarize_meeting(&app, "m1", None, "done"); // Ollama at :9 refuses
        let m = mt::get(&app.db(), "m1").unwrap().unwrap();
        assert_eq!((m.status.as_str(), m.summary.as_str()), ("done", "Old summary"));
        assert!(m.error.starts_with("Could not regenerate the summary"), "{}", m.error);
    }

    async fn body_json(r: Response) -> Value {
        let bytes = axum::body::to_bytes(r.into_body(), 1 << 20).await.unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn edited_line_reaches_search_and_exports() {
        let dir = tempfile::tempdir().unwrap();
        let app = test_app(dir.path());
        test_meeting(&app, "m1");
        let first = mt::segments(&app.db(), "m1").unwrap()[0].id;
        let edit = |id: i64, body: &str| patch_segment(State(app.clone()), UrlPath(id), Bytes::from(body.to_string()));
        assert_eq!(edit(9999, "{}").await.status(), StatusCode::NOT_FOUND);
        assert_eq!(edit(first, r#"{"text": "  "}"#).await.status(), StatusCode::BAD_REQUEST);
        assert_eq!(edit(first, &format!(r#"{{"text": "{}"}}"#, "x".repeat(2001))).await.status(), StatusCode::BAD_REQUEST);
        assert_eq!(edit(first, r#"{"speaker": 7}"#).await.status(), StatusCode::BAD_REQUEST);
        let r = edit(first, r#"{"text": "Hello Rohan, can you book the marquee?", "speaker": 2}"#).await;
        assert_eq!(r.status(), StatusCode::OK);
        let j = body_json(r).await;
        assert_eq!((j["id"].as_i64(), j["speaker"].as_i64()), (Some(first), Some(2))); // 2 = a new speaker
        let found = body_json(list(State(app.clone()), Query([("q".to_string(), "marquee".to_string())].into())).await).await;
        assert_eq!(found["meetings"][0]["hits"][0]["text"], "Hello Rohan, can you book the marquee?");
        let m = mt::get(&app.db(), "m1").unwrap().unwrap();
        let md = String::from_utf8(export::markdown(&m, &mt::segments(&app.db(), "m1").unwrap()).body.to_vec()).unwrap();
        assert!(md.contains("marquee"));
        app.db().execute("UPDATE meetings SET status = 'transcribing'", []).unwrap();
        assert_eq!(edit(first, r#"{"text": "x"}"#).await.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn merge_leaves_one_name() {
        let dir = tempfile::tempdir().unwrap();
        let app = test_app(dir.path());
        test_meeting(&app, "m1");
        app.db().execute(r#"UPDATE meetings SET speaker_names = '{"0": "Asha", "1": "Rohan"}'"#, []).unwrap();
        let merge = |body: &str| merge_speakers(State(app.clone()), UrlPath("m1".to_string()), Bytes::from(body.to_string()));
        assert_eq!(merge(r#"{"from": 1, "to": 1}"#).await.status(), StatusCode::BAD_REQUEST);
        assert_eq!(merge(r#"{"from": 1, "to": 5}"#).await.status(), StatusCode::BAD_REQUEST);
        assert_eq!(merge(r#"{"from": "1"}"#).await.status(), StatusCode::BAD_REQUEST);
        let j = body_json(merge(r#"{"from": 1, "to": 0}"#).await).await;
        assert_eq!(j["speaker_names"], json!({"0": "Asha"}));
        assert!(j["segments"].as_array().unwrap().iter().all(|s| s["speaker"] == 0));
        assert_eq!(j["speakers"], 1);
    }

    #[tokio::test]
    async fn cancel_waiting_meeting_and_retry() {
        let dir = tempfile::tempdir().unwrap();
        let app = test_app(dir.path());
        test_meeting(&app, "c1");
        let stop = || cancel(State(app.clone()), UrlPath("c1".to_string()));
        assert_eq!(stop().await.status(), StatusCode::CONFLICT); // done: nothing to stop
        app.db().execute("UPDATE meetings SET status = 'queued'", []).unwrap();
        let j = body_json(stop().await).await;
        assert_eq!((j["status"].as_str(), j["error"].as_str(), &j["queue_position"]), (Some("failed"), Some("Cancelled."), &Value::Null));
        assert!(mt::cancel_requested(&app.db(), "c1"));
        assert_eq!(retry(State(app.clone()), UrlPath("c1".to_string())).await.status(), StatusCode::OK);
        assert!(!mt::cancel_requested(&app.db(), "c1"));
    }

    #[tokio::test]
    async fn suggestions_hide_named_speakers_and_title_sticks() {
        let dir = tempfile::tempdir().unwrap();
        let app = test_app(dir.path());
        test_meeting(&app, "s1");
        app.db().execute(r#"UPDATE meetings SET auto_title = 1, speaker_suggestions = '{"0": "Asha", "1": "Rohan"}'"#, []).unwrap();
        let d = body_json(detail(State(app.clone()), UrlPath("s1".to_string())).await).await;
        assert_eq!(d["speaker_suggestions"], json!({"0": "Asha", "1": "Rohan"}));
        let p = |body: &str| patch(State(app.clone()), UrlPath("s1".to_string()), Bytes::from(body.to_string()));
        let d = body_json(p(r#"{"speaker_names": {"1": "Rohan"}}"#).await).await;
        assert_eq!(d["speaker_suggestions"], json!({"0": "Asha"})); // accepted: no longer offered
        assert!(mt::get(&app.db(), "s1").unwrap().unwrap().auto_title);
        p(r#"{"title": "My name"}"#).await;
        assert!(!mt::get(&app.db(), "s1").unwrap().unwrap().auto_title);
        let d = body_json(merge_speakers(State(app.clone()), UrlPath("s1".to_string()), Bytes::from(r#"{"from": 0, "to": 1}"#)).await).await;
        assert_eq!(d["speaker_suggestions"], json!({}));
    }

    #[test]
    fn dates_like_fromisoformat() {
        assert!(super::day("2026-10-28", "from").is_ok());
        assert!(super::day("2024-02-29", "from").is_ok());
        for bad in ["2026-13-01", "2026-02-30", "2025-02-29", "2026-1-01", "26-01-01", "yesterday", ""] {
            assert_eq!(super::day(bad, "from").unwrap_err(), "from must be a date like 2026-10-28.");
        }
    }
}

/// GET /api/meetings/: newest first, at most 200. ?status= (a status, "processing" or
/// "ready", comma list), ?from= / ?to= (inclusive dates), ?tag=, and ?q= which matches the
/// title, notes, summary and transcript and returns the matching lines as `hits`.
pub async fn list(State(app): State<AppState>, Query(p): Query<Params>) -> Response {
    let mut wheres: Vec<String> = Vec::new();
    let mut args: Vec<String> = Vec::new();
    let statuses: Vec<String> = p.get("status").map(|s| s.split(',').map(|x| x.trim().to_lowercase()).filter(|x| !x.is_empty()).collect()).unwrap_or_default();
    if !statuses.is_empty() {
        let mut wanted: Vec<&str> = Vec::new();
        for s in &statuses {
            match s.as_str() {
                "processing" => wanted.extend(mt::PROCESSING),
                "ready" => wanted.push("done"),
                x if mt::STATUSES.contains(&x) => wanted.push(mt::STATUSES.iter().find(|y| **y == x).unwrap()),
                x => return error(StatusCode::BAD_REQUEST, format!("Unknown status '{x}'.")),
            }
        }
        wheres.push(format!("status IN ({})", vec!["?"; wanted.len()].join(",")));
        args.extend(wanted.iter().map(|s| s.to_string()));
    }
    for (key, op) in [("from", ">="), ("to", "<=")] {
        if let Some(v) = p.get(key).filter(|v| !v.is_empty()) {
            match day(v, key) {
                Ok(d) => {
                    wheres.push(format!("substr(created, 1, 10) {op} ?"));
                    args.push(d);
                }
                Err(e) => return error(StatusCode::BAD_REQUEST, e),
            }
        }
    }
    let tag = p.get("tag").map(|t| t.trim().to_lowercase()).unwrap_or_default();
    let has_tag = |m: &Meeting| tag.is_empty() || m.tags.as_array().is_some_and(|a| a.iter().any(|t| t.as_str().is_some_and(|t| t.to_lowercase() == tag)));
    let q = p.get("q").map(|q| q.trim().to_string()).unwrap_or_default();
    let filter = if wheres.is_empty() { String::new() } else { format!("WHERE {}", wheres.join(" AND ")) };

    let db = app.db();
    let rows = |extra: &str, limit: i64, args: &[String]| -> Vec<Meeting> {
        let sql = format!("SELECT {} FROM meetings {filter} {extra} ORDER BY created DESC LIMIT {limit}", mt::COLUMNS);
        db.prepare(&sql)
            .and_then(|mut st| st.query_map(params_from_iter(args.iter()), Meeting::from_row)?.collect())
            .unwrap_or_default()
    };
    if q.is_empty() {
        let out: Vec<Value> = rows("", 200, &args)
            .into_iter()
            .filter(|m| has_tag(m))
            .map(|mut m| {
                mt::reap(&db, &mut m);
                mt::to_json(&db, &m, false)
            })
            .collect();
        return Json(json!({ "meetings": out })).into_response();
    }
    // meetings whose title, notes or summary contain the text (Django's icontains)
    let mut results: Vec<(String, Value)> = Vec::new();
    let joiner = if filter.is_empty() { "WHERE" } else { "AND" };
    let mut a2 = args.clone();
    a2.extend([q.clone(), q.clone(), q.clone()]);
    for m in rows(&format!("{joiner} (title LIKE '%' || ? || '%' OR notes LIKE '%' || ? || '%' OR summary LIKE '%' || ? || '%')"), 50, &a2) {
        let mut j = mt::to_json(&db, &m, false);
        j["hits"] = json!([]);
        results.push((m.id.clone(), j));
    }
    // and transcript lines that match any of its words, best first (FTS5 bm25)
    let words = mt::search_words(&q, false);
    if !words.is_empty() {
        let ids: Vec<String> = rows("", 100_000, &args).into_iter().map(|m| m.id).collect();
        let sql = "SELECT s.meeting_id, s.start, s.text FROM segments_fts f JOIN segments s ON s.id = f.rowid \
                   WHERE segments_fts MATCH ?1 ORDER BY bm25(segments_fts) LIMIT 400";
        let hits: Vec<(String, f64, String)> = db
            .prepare(sql)
            .and_then(|mut st| st.query_map([mt::fts_query(&words)], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect())
            .unwrap_or_default();
        for (mid, start, text) in hits.into_iter().filter(|(mid, ..)| ids.contains(mid)).take(100) {
            if !results.iter().any(|(id, _)| *id == mid) {
                if let Ok(Some(m)) = mt::get(&db, &mid) {
                    let mut j = mt::to_json(&db, &m, false);
                    j["hits"] = json!([]);
                    results.push((mid.clone(), j));
                }
            }
            if let Some((_, j)) = results.iter_mut().find(|(id, _)| *id == mid) {
                j["hits"].as_array_mut().unwrap().push(json!({"start": start, "text": text}));
            }
        }
    }
    let out: Vec<Value> = results
        .into_iter()
        .map(|(_, j)| j)
        .filter(|j| tag.is_empty() || j["tags"].as_array().is_some_and(|a| a.iter().any(|t| t.as_str().is_some_and(|t| t.to_lowercase() == tag))))
        .collect();
    Json(json!({ "meetings": out })).into_response()
}

/// POST /api/meetings/ (multipart): file, and optional title, notes, tags and template.
/// The file streams to disk with the size limit enforced as it arrives.
pub async fn create(State(app): State<AppState>, headers: HeaderMap, mut form: Multipart) -> Response {
    let limit = app.cfg.max_upload_mb * 1024 * 1024;
    let too_big = || error(StatusCode::PAYLOAD_TOO_LARGE, format!("File is larger than {} MB.", app.cfg.max_upload_mb));
    // refuse on the header alone when it is clearly over (1 MB covers the multipart overhead)
    let length: u64 = headers.get(header::CONTENT_LENGTH).and_then(|v| v.to_str().ok()).and_then(|v| v.parse().ok()).unwrap_or(0);
    if length > limit + 1024 * 1024 {
        return too_big();
    }
    let uploads = app.cfg.media_root.join("uploads");
    if let Err(e) = tokio::fs::create_dir_all(&uploads).await {
        return error(StatusCode::INTERNAL_SERVER_ERROR, format!("Cannot store the file: {e}"));
    }
    let (mut stored, mut name): (Option<PathBuf>, String) = (None, String::new());
    let mut fields: std::collections::HashMap<String, String> = Default::default();
    // a file that fails later must not stay on disk
    struct Cleanup(Option<PathBuf>);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            if let Some(p) = self.0.take() {
                let _ = std::fs::remove_file(p);
            }
        }
    }
    let mut cleanup = Cleanup(None);
    loop {
        let field = match form.next_field().await {
            Ok(Some(f)) => f,
            Ok(None) => break,
            Err(e) if e.status() == StatusCode::PAYLOAD_TOO_LARGE => return too_big(),
            Err(e) => return error(StatusCode::BAD_REQUEST, format!("Bad upload: {}", e.body_text())),
        };
        let key = field.name().unwrap_or("").to_string();
        if key == "file" && stored.is_none() {
            name = field.file_name().unwrap_or("").to_string();
            let ext = Path::new(&name).extension().and_then(|e| e.to_str()).map(|e| format!(".{}", e.to_lowercase())).unwrap_or_default();
            if !mt::ALLOWED_EXT.contains(&ext.as_str()) {
                return error(StatusCode::BAD_REQUEST, format!("Unsupported file type. Allowed: {}", mt::ALLOWED_EXT.join(", ")));
            }
            let path = uploads.join(format!("{}{ext}", uuid::Uuid::new_v4().simple()));
            cleanup.0 = Some(path.clone());
            let mut out = match tokio::fs::File::create(&path).await {
                Ok(f) => f,
                Err(e) => return error(StatusCode::INTERNAL_SERVER_ERROR, format!("Cannot store the file: {e}")),
            };
            let (mut field, mut size) = (field, 0u64);
            loop {
                match field.chunk().await {
                    Ok(Some(chunk)) => {
                        size += chunk.len() as u64;
                        if size > limit {
                            return too_big();
                        }
                        if out.write_all(&chunk).await.is_err() {
                            return error(StatusCode::INTERNAL_SERVER_ERROR, "Cannot store the file.");
                        }
                    }
                    Ok(None) => break,
                    Err(e) if e.status() == StatusCode::PAYLOAD_TOO_LARGE => return too_big(),
                    Err(e) => return error(StatusCode::BAD_REQUEST, format!("Bad upload: {}", e.body_text())),
                }
            }
            let _ = out.flush().await;
            stored = Some(path);
        } else if let Ok(text) = field.text().await {
            fields.insert(key, text);
        }
    }
    let Some(path) = stored else { return error(StatusCode::BAD_REQUEST, "No file uploaded.") };
    let stem = Path::new(&name).file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
    let auto_title = fields.get("title").is_none_or(|t| t.trim().is_empty());
    let title: String = fields.get("title").filter(|t| !t.trim().is_empty()).cloned().unwrap_or(stem).chars().take(200).collect();
    let notes = match mt::clean_notes(&json!(fields.get("notes").cloned().unwrap_or_default())) {
        Ok(n) => n,
        Err(e) => return error(StatusCode::BAD_REQUEST, e),
    };
    let tags = match mt::clean_tags(&json!(fields.get("tags").cloned().unwrap_or_default())) {
        Ok(t) => t,
        Err(e) => return error(StatusCode::BAD_REQUEST, e),
    };
    let field = |k: &str| fields.get(k).map(String::as_str).unwrap_or("");
    let (language, translate) = match (mt::clean_language(field("language")), mt::clean_flag(field("translate"), "translate")) {
        (Ok(l), Ok(t)) => (l, t),
        (Err(e), _) | (_, Err(e)) => return error(StatusCode::BAD_REQUEST, e),
    };
    let template = fields.get("template").map(|t| t.trim().to_string()).unwrap_or_default();
    if !template.is_empty() && !app.template_exists(&template) {
        return error(StatusCode::BAD_REQUEST, format!("No template with id '{template}'."));
    }
    // the template is fixed at upload: changing the default later does not rewrite old notes
    let template = if template.is_empty() { app.default_template() } else { template };
    let probe_path = path.clone();
    let Some(duration) = tokio::task::spawn_blocking(move || audio::probe(&probe_path)).await.ok().flatten() else {
        return error(StatusCode::BAD_REQUEST, "No audio stream found in this file.");
    };
    let id = uuid::Uuid::new_v4().to_string();
    let rel = format!("uploads/{}", path.file_name().unwrap().to_string_lossy());
    let now = db::now_iso();
    let m = {
        let db = app.db();
        let ok = db.execute(
            "INSERT INTO meetings (id, title, file, duration, notes, tags, template, created, heartbeat, language_hint, translate, auto_title) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?9, ?10, ?11)",
            params![id, title, rel, duration, notes, Value::from(tags).to_string(), template, now, language, translate, auto_title],
        );
        if let Err(e) = ok {
            return error(StatusCode::INTERNAL_SERVER_ERROR, format!("Cannot save the meeting: {e}"));
        }
        cleanup.0 = None; // the meeting owns the file now
        let m = mt::get(&db, &id).ok().flatten().unwrap();
        mt::to_json(&db, &m, false)
    };
    pipeline::enqueue(&app, &id);
    (StatusCode::CREATED, Json(m)).into_response()
}

pub async fn detail(State(app): State<AppState>, UrlPath(id): UrlPath<String>) -> Response {
    let Some(m) = load(&app, &id) else { return not_found() };
    let db = app.db();
    Json(mt::to_json(&db, &m, true)).into_response()
}

/// PATCH /api/meetings/<id>/: title, notes, tags, speaker_names and action_items.
pub async fn patch(State(app): State<AppState>, UrlPath(id): UrlPath<String>, body: Bytes) -> Response {
    let Some(mut m) = load(&app, &id) else { return not_found() };
    let data = match json_body(&body) {
        Ok(Value::Object(o)) => o,
        Ok(_) => return error(StatusCode::BAD_REQUEST, "Expected a JSON object."),
        Err(r) => return r,
    };
    if let Some(t) = data.get("title").and_then(Value::as_str).map(str::trim).filter(|t| !t.is_empty()) {
        m.title = t.chars().take(200).collect();
        m.auto_title = false; // the user named it: a new summary never renames it again
    }
    if let Some(v) = data.get("notes") {
        match mt::clean_notes(v) {
            Ok(n) => m.notes = n,
            Err(e) => return error(StatusCode::BAD_REQUEST, e),
        }
    }
    if let Some(v) = data.get("tags") {
        match mt::clean_tags(v) {
            Ok(t) => m.tags = json!(t),
            Err(e) => return error(StatusCode::BAD_REQUEST, e),
        }
    }
    if let Some(names) = data.get("speaker_names").and_then(Value::as_object) {
        m.speaker_names = Value::Object(
            names
                .iter()
                .filter(|(k, _)| !k.is_empty() && k.chars().all(|c| c.is_ascii_digit()))
                .map(|(k, v)| {
                    let s = v.as_str().map(String::from).unwrap_or_else(|| v.to_string());
                    (k.clone(), Value::String(s.chars().take(60).collect()))
                })
                .collect(),
        );
    }
    if let Some(items) = data.get("action_items").and_then(Value::as_array) {
        m.action_items = mt::clean_action_items(items);
    }
    let db = app.db();
    let r = db.execute(
        "UPDATE meetings SET title = ?2, notes = ?3, tags = ?4, speaker_names = ?5, action_items = ?6, heartbeat = ?7, auto_title = ?8 WHERE id = ?1",
        params![m.id, m.title, m.notes, m.tags.to_string(), m.speaker_names.to_string(), m.action_items.to_string(), db::now_iso(), m.auto_title],
    );
    if let Err(e) = r {
        return error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string());
    }
    Json(mt::to_json(&db, &m, true)).into_response()
}

/// DELETE /api/meetings/<id>/: the row, its transcript and the file with its shared copies.
pub async fn delete(State(app): State<AppState>, UrlPath(id): UrlPath<String>) -> Response {
    let Some(m) = load(&app, &id) else { return not_found() };
    if !m.file.is_empty() {
        let src = app.cfg.media_root.join(&m.file);
        if let (Some(dir), Some(stem)) = (src.parent(), src.file_stem().and_then(|s| s.to_str())) {
            if let Ok(entries) = std::fs::read_dir(dir) {
                for e in entries.flatten() {
                    if e.file_name().to_string_lossy().starts_with(&format!("{stem}.share.")) {
                        let _ = std::fs::remove_file(e.path());
                    }
                }
            }
        }
        let _ = std::fs::remove_file(src);
    }
    let _ = app.db().execute("DELETE FROM meetings WHERE id = ?1", [&m.id]);
    StatusCode::NO_CONTENT.into_response()
}

/// GET /api/meetings/<id>/audio: the original file, with Range support so the player seeks.
pub async fn audio(State(app): State<AppState>, UrlPath(id): UrlPath<String>, headers: HeaderMap) -> Response {
    let Some(m) = load(&app, &id) else { return not_found() };
    let path = app.cfg.media_root.join(&m.file);
    let Ok(mut file) = tokio::fs::File::open(&path).await else { return not_found() };
    let size = file.metadata().await.map(|md| md.len()).unwrap_or(0);
    let ctype = audio::content_type(&path);
    let range = headers.get(header::RANGE).and_then(|v| v.to_str().ok()).map(str::trim).and_then(|r| r.strip_prefix("bytes=")).and_then(|r| {
        let (a, b) = r.split_once('-')?;
        let ok = |s: &str| s.chars().all(|c| c.is_ascii_digit());
        (ok(a) && ok(b) && !(a.is_empty() && b.is_empty())).then(|| (a.to_string(), b.to_string()))
    });
    let Some((a, b)) = range else {
        let body = Body::from_stream(tokio_util::io::ReaderStream::new(file));
        return ([(header::CONTENT_TYPE, ctype), (header::ACCEPT_RANGES, "bytes")], body).into_response();
    };
    let (start, end) = if !a.is_empty() {
        let s: u64 = a.parse().unwrap_or(u64::MAX);
        (s, b.parse::<u64>().map(|e| e.min(size.saturating_sub(1))).unwrap_or(size.saturating_sub(1)))
    } else {
        (size.saturating_sub(b.parse().unwrap_or(0)), size.saturating_sub(1)) // the last N bytes
    };
    if size == 0 || start > end || start >= size {
        return (StatusCode::RANGE_NOT_SATISFIABLE, [(header::CONTENT_RANGE, format!("bytes */{size}"))]).into_response();
    }
    let len = (end - start + 1).min(4 * 1024 * 1024); // cap a chunk; the browser asks for the rest
    let mut buf = vec![0u8; len as usize];
    if file.seek(std::io::SeekFrom::Start(start)).await.is_err() || file.read_exact(&mut buf).await.is_err() {
        return error(StatusCode::INTERNAL_SERVER_ERROR, "Cannot read the audio.");
    }
    (
        StatusCode::PARTIAL_CONTENT,
        [
            (header::CONTENT_TYPE, ctype.to_string()),
            (header::CONTENT_RANGE, format!("bytes {start}-{}/{size}", start + len - 1)),
            (header::ACCEPT_RANGES, "bytes".to_string()),
        ],
        buf,
    )
        .into_response()
}

/// POST /api/meetings/<id>/retry: run the pipeline again. A meeting whose run died (stale)
/// is taken over instead of refused (bug B4).
pub async fn retry(State(app): State<AppState>, UrlPath(id): UrlPath<String>) -> Response {
    let Some(m) = ({ let db = app.db(); mt::get(&db, &id).ok().flatten() }) else { return not_found() };
    if !matches!(m.status.as_str(), "failed" | "done") && !m.is_stale() {
        return error(StatusCode::CONFLICT, "Meeting is still processing.");
    }
    let db = app.db();
    let _ = db.execute("UPDATE meetings SET cancel_requested = 0 WHERE id = ?1", [&m.id]);
    mt::set_status(&db, &m.id, "queued", Some(0));
    drop(db);
    pipeline::enqueue(&app, &m.id);
    let db = app.db();
    let m = mt::get(&db, &id).ok().flatten().unwrap();
    Json(mt::to_json(&db, &m, false)).into_response()
}

/// POST /api/meetings/<id>/summarize: {"template"?}. A new summary from the stored
/// transcript only; 409 while processing or when there is no transcript.
pub async fn summarize(State(app): State<AppState>, UrlPath(id): UrlPath<String>, body: Bytes) -> Response {
    let Some(m) = load(&app, &id) else { return not_found() };
    if mt::PROCESSING.contains(&m.status.as_str()) {
        return error(StatusCode::CONFLICT, "Meeting is still processing.");
    }
    let template = match json_body(&body) {
        Ok(v) => match v.get("template") {
            None | Some(Value::Null) => None,
            Some(Value::String(t)) if t.trim().is_empty() => None,
            Some(Value::String(t)) => Some(t.trim().to_string()),
            Some(_) => return error(StatusCode::BAD_REQUEST, "template must be a string."),
        },
        Err(r) => return r,
    };
    if let Some(t) = template.as_deref().filter(|t| !app.template_exists(t)) {
        return error(StatusCode::BAD_REQUEST, format!("No template with id '{t}'."));
    }
    let db = app.db();
    if db.query_row("SELECT 1 FROM segments WHERE meeting_id = ?1 LIMIT 1", [&m.id], |_| Ok(())).is_err() {
        return error(StatusCode::CONFLICT, "This meeting has no transcript to summarize.");
    }
    let _ = db.execute("UPDATE meetings SET cancel_requested = 0 WHERE id = ?1", [&m.id]);
    mt::set_status(&db, &m.id, "summarizing", Some(80));
    pipeline::enqueue_summary(&m.id, template, &m.status);
    let m = mt::get(&db, &id).ok().flatten().unwrap();
    Json(mt::to_json(&db, &m, false)).into_response()
}

/// PATCH /api/segments/<id>/: {"text"?, "speaker"?}. `speaker` is one of the meeting's
/// speaker numbers (or the next new one) or null. 409 while the meeting is processing.
pub async fn patch_segment(State(app): State<AppState>, UrlPath(id): UrlPath<i64>, body: Bytes) -> Response {
    let data = match json_body(&body) {
        Ok(Value::Object(o)) => o,
        Ok(_) => return error(StatusCode::BAD_REQUEST, "Expected a JSON object."),
        Err(r) => return r,
    };
    let db = app.db();
    let row = db.query_row("SELECT meeting_id, speaker, text FROM segments WHERE id = ?1", [id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, Option<i64>>(1)?, r.get::<_, String>(2)?))
    });
    let Ok((mid, mut speaker, mut text)) = row else { return not_found() };
    let Some(mut m) = mt::get(&db, &mid).ok().flatten() else { return not_found() };
    mt::reap(&db, &mut m);
    if mt::PROCESSING.contains(&m.status.as_str()) {
        return error(StatusCode::CONFLICT, "Meeting is still processing.");
    }
    if let Some(v) = data.get("text") {
        match mt::clean_segment_text(v) {
            Ok(t) => text = t,
            Err(e) => return error(StatusCode::BAD_REQUEST, e),
        }
    }
    if let Some(v) = data.get("speaker") {
        speaker = match v.as_i64().filter(|_| !v.is_boolean()) {
            _ if v.is_null() => None,
            Some(n) if mt::speaker_choices(&db, &m).contains(&n) => Some(n),
            _ => return error(StatusCode::BAD_REQUEST, "speaker must be a speaker number of this meeting or null."),
        };
    }
    if let Err(e) = db.execute("UPDATE segments SET text = ?2, speaker = ?3 WHERE id = ?1", params![id, text, speaker]) {
        return error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string());
    }
    let seg = db.query_row("SELECT id, start, end, speaker, text FROM segments WHERE id = ?1", [id], |r| {
        Ok(mt::Segment { id: r.get(0)?, start: r.get(1)?, end: r.get(2)?, speaker: r.get(3)?, text: r.get(4)? })
    });
    match seg {
        Ok(s) => Json(mt::segment_json(&s)).into_response(),
        Err(e) => error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

/// POST /api/meetings/<id>/speakers/merge: {"from", "to"}. Every line of `from` goes to `to`
/// and the name saved for `from` is dropped. Returns the full meeting.
pub async fn merge_speakers(State(app): State<AppState>, UrlPath(id): UrlPath<String>, body: Bytes) -> Response {
    let data = match json_body(&body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let num = |k: &str| data.get(k).filter(|v| !v.is_boolean()).and_then(Value::as_i64);
    let (Some(from), Some(to)) = (num("from"), num("to")) else {
        return error(StatusCode::BAD_REQUEST, "from and to must be speaker numbers.");
    };
    let Some(mut m) = load(&app, &id) else { return not_found() };
    if mt::PROCESSING.contains(&m.status.as_str()) {
        return error(StatusCode::CONFLICT, "Meeting is still processing.");
    }
    let db = app.db();
    let choices = mt::speaker_choices(&db, &m);
    let known = &choices[..choices.len() - 1]; // not the "new speaker" slot
    if from == to || !known.contains(&from) || !known.contains(&to) {
        return error(StatusCode::BAD_REQUEST, "from and to must be two different speakers of this meeting.");
    }
    if let Some(names) = m.speaker_names.as_object_mut() {
        names.remove(&from.to_string());
    }
    if let Some(s) = m.speaker_suggestions.as_object_mut() {
        s.remove(&from.to_string());
    }
    let tx = match db.unchecked_transaction() {
        Ok(t) => t,
        Err(e) => return error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    };
    let done = tx
        .execute("UPDATE segments SET speaker = ?3 WHERE meeting_id = ?1 AND speaker = ?2", params![m.id, from, to])
        .and_then(|_| {
            tx.execute(
                "UPDATE meetings SET speaker_names = ?2, speaker_suggestions = ?3 WHERE id = ?1",
                params![m.id, m.speaker_names.to_string(), m.speaker_suggestions.to_string()],
            )
        })
        .and_then(|_| tx.commit());
    if let Err(e) = done {
        return error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string());
    }
    Json(mt::to_json(&db, &m, true)).into_response()
}

/// POST /api/meetings/<id>/cancel: stop processing. A waiting meeting fails with "Cancelled."
/// at once; the running one stops at its next check (within seconds during transcription).
pub async fn cancel(State(app): State<AppState>, UrlPath(id): UrlPath<String>) -> Response {
    let Some(m) = load(&app, &id) else { return not_found() };
    if !mt::PROCESSING.contains(&m.status.as_str()) {
        return error(StatusCode::CONFLICT, "Meeting is not processing.");
    }
    let db = app.db();
    let _ = db.execute("UPDATE meetings SET cancel_requested = 1 WHERE id = ?1", [&m.id]);
    // a summary-only job is not in the queue's order; it reads the flag itself
    if m.status != "summarizing" && !pipeline::cancel(&m.id) {
        let _ = db.execute(
            "UPDATE meetings SET status = 'failed', progress = 0, error = ?2, heartbeat = ?3 WHERE id = ?1",
            params![m.id, mt::CANCELLED, db::now_iso()],
        );
    }
    let m = mt::get(&db, &id).ok().flatten().unwrap();
    Json(mt::to_json(&db, &m, false)).into_response()
}

/// GET /api/tags/: every tag in use with its meeting count, most used first.
pub async fn tags(State(app): State<AppState>) -> Response {
    let db = app.db();
    let lists: Vec<String> = db
        .prepare("SELECT tags FROM meetings WHERE tags != '[]'")
        .and_then(|mut st| st.query_map([], |r| r.get(0))?.collect())
        .unwrap_or_default();
    let mut counts: Vec<(String, String, i64)> = Vec::new(); // (lower, shown, count)
    for l in lists {
        for t in serde_json::from_str::<Vec<String>>(&l).unwrap_or_default() {
            match counts.iter_mut().find(|(k, ..)| *k == t.to_lowercase()) {
                Some(c) => c.2 += 1,
                None => counts.push((t.to_lowercase(), t, 1)),
            }
        }
    }
    counts.sort_by(|a, b| b.2.cmp(&a.2).then(a.0.cmp(&b.0)));
    Json(json!({"tags": counts.into_iter().map(|(_, n, c)| json!({"name": n, "count": c})).collect::<Vec<_>>()})).into_response()
}

/// GET /api/action-items/: every meeting's action items, newest meeting first. ?open=1 leaves
/// out done ones; `index` is the item's place in its meeting, for a PATCH of that list.
pub async fn action_items(State(app): State<AppState>, Query(p): Query<Params>) -> Response {
    let only_open = p.get("open").map(String::as_str) == Some("1");
    let db = app.db();
    let rows: Vec<(String, String, String, String)> = db
        .prepare("SELECT id, title, created, action_items FROM meetings WHERE action_items != '[]' ORDER BY created DESC")
        .and_then(|mut st| st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect())
        .unwrap_or_default();
    let mut out = Vec::new();
    for (id, title, created, items) in rows {
        for (i, item) in serde_json::from_str::<Vec<Value>>(&items).unwrap_or_default().iter().enumerate() {
            let done = item["done"].as_bool().unwrap_or(false);
            if only_open && done {
                continue;
            }
            let s = |k: &str| item[k].as_str().unwrap_or("").to_string();
            out.push(json!({
                "meeting": id, "meeting_title": title, "meeting_created": created, "index": i,
                "task": s("task"), "owner": s("owner"), "due": s("due"), "done": done,
            }));
        }
    }
    Json(json!({"action_items": out})).into_response()
}

fn question_json(r: &rusqlite::Row) -> rusqlite::Result<Value> {
    Ok(json!({"id": r.get::<_, i64>(0)?, "question": r.get::<_, String>(1)?, "answer": r.get::<_, String>(2)?, "status": r.get::<_, String>(3)?}))
}

/// GET /api/questions/<id>/
pub async fn question(State(app): State<AppState>, UrlPath(id): UrlPath<i64>) -> Response {
    let db = app.db();
    match db.query_row("SELECT id, question, answer, status FROM questions WHERE id = ?1", [id], question_json) {
        Ok(q) => Json(q).into_response(),
        Err(_) => not_found(),
    }
}

/// POST /api/meetings/<id>/ask: {"question"}, answered in the background; poll the question.
pub async fn ask(State(app): State<AppState>, UrlPath(id): UrlPath<String>, body: Bytes) -> Response {
    let Some(m) = load(&app, &id) else { return not_found() };
    if m.status != "done" {
        return error(StatusCode::CONFLICT, "Meeting is not processed yet.");
    }
    let question = match json_body(&body) {
        Ok(v) => match v.get("question") {
            Some(Value::String(s)) => s.trim().to_string(),
            Some(Value::Null) | None => String::new(),
            Some(other) => other.to_string(),
        },
        Err(r) => return r,
    };
    if question.is_empty() {
        return error(StatusCode::BAD_REQUEST, "Question is empty.");
    }
    let q: String = question.chars().take(1000).collect();
    let (qid, out) = {
        let db = app.db();
        if db.execute("INSERT INTO questions (meeting_id, question, created) VALUES (?1, ?2, ?3)", params![m.id, q, db::now_iso()]).is_err() {
            return error(StatusCode::INTERNAL_SERVER_ERROR, "Cannot save the question.");
        }
        let qid = db.last_insert_rowid();
        (qid, db.query_row("SELECT id, question, answer, status FROM questions WHERE id = ?1", [qid], question_json).unwrap())
    };
    pipeline::enqueue_question(&app, qid);
    (StatusCode::CREATED, Json(out)).into_response()
}

fn attachment(name: &str) -> String {
    format!("attachment; filename=\"{name}\"")
}

/// GET /api/meetings/<id>/export.<fmt> and /audio.<fmt>: the meeting or its recording as a
/// download named after the title (views.meeting_export, views.meeting_audio_export).
pub async fn download(State(app): State<AppState>, UrlPath((id, file)): UrlPath<(String, String)>) -> Response {
    let Some((kind, fmt)) = file.split_once('.') else { return not_found() };
    let Some(m) = load(&app, &id) else { return not_found() };
    if kind == "audio" {
        let Some((_, ctype)) = export::audio_format(fmt) else { return not_found() };
        let src = app.cfg.media_root.join(&m.file);
        let fmt2 = fmt.to_string();
        let made = tokio::task::spawn_blocking(move || export::audio_copy(&src, &fmt2)).await.unwrap_or_else(|e| Err(e.to_string()));
        return match made {
            Ok(Some(path)) => match tokio::fs::File::open(&path).await {
                Ok(f) => (
                    [(header::CONTENT_TYPE, ctype.to_string()), (header::CONTENT_DISPOSITION, attachment(&export::filename(&m, fmt)))],
                    Body::from_stream(tokio_util::io::ReaderStream::new(f)),
                )
                    .into_response(),
                Err(_) => error(StatusCode::INTERNAL_SERVER_ERROR, "Could not convert the audio."),
            },
            Ok(None) => error(StatusCode::NOT_FOUND, "This meeting's audio was deleted."),
            Err(e) => {
                eprintln!("audio export of {id} failed: {e}");
                error(StatusCode::INTERNAL_SERVER_ERROR, "Could not convert the audio.")
            }
        };
    }
    if kind != "export" {
        return not_found();
    }
    let (segs, full) = {
        let db = app.db();
        (mt::segments(&db, &m.id).unwrap_or_default(), if fmt == "json" { mt::to_json(&db, &m, true) } else { Value::Null })
    };
    let out = match fmt {
        "md" => export::markdown(&m, &segs),
        "txt" => export::plain_text(&m, &segs),
        "json" => export::as_json(&full),
        "srt" => export::srt(&m, &segs),
        "vtt" => export::vtt(&m, &segs),
        "html" => export::share_html(&m, &segs),
        "docx" => export::docx(&m, &segs),
        "odt" => export::odt(&m, &segs),
        "ics" => match export::ics(&m) {
            Ok(e) => e,
            Err(export::NoDates) => return error(StatusCode::NOT_FOUND, "No action item has a date."),
        },
        _ => return not_found(),
    };
    let mut resp = ([(header::CONTENT_TYPE, out.ctype.to_string()), (header::CONTENT_DISPOSITION, attachment(&export::filename(&m, fmt)))], out.body).into_response();
    for (k, v) in out.headers {
        if let Ok(v) = v.parse() {
            resp.headers_mut().insert(k, v);
        }
    }
    resp
}
