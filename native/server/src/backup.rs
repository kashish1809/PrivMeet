//! Backup and restore (R1.20): every meeting with its transcript and questions, the user's own
//! templates and the settings, as one zip, optionally with the recordings.
//!
//! The zip is written with export::zip (stored entries) and read back by the small reader
//! below, which accepts only what that writer makes. A restore never trusts the file: only
//! known member names are read, no path from the zip is ever used on disk, and every field
//! passes the same rules as the API.

use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;

use axum::{
    body::Body,
    extract::{Multipart, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use rusqlite::params;
use serde_json::{json, Map, Value};

use crate::meetings::{self as mt};
use crate::web::{error, App, AppState};
use crate::{db, export, settings, templates};

pub const FORMAT: &str = "privmeet-backup";
const MANIFEST: &str = "meetings.json";
/// Largest meetings.json read back; a real one is a few MB per hundred meetings.
const MAX_MANIFEST: u64 = 256 * 1024 * 1024;

fn audio_name_ok(name: &str) -> bool {
    // the server's own upload names: 32 hex digits and an allowed extension
    let Some((stem, ext)) = name.rsplit_once('.') else { return false };
    stem.len() == 32 && stem.chars().all(|c| c.is_ascii_hexdigit()) && mt::ALLOWED_EXT.contains(&format!(".{ext}").as_str())
}

/// Everything except the recordings, as the manifest stores it.
pub fn manifest(app: &App) -> Result<Value, String> {
    let db = app.db();
    let ids: Vec<String> = db
        .prepare("SELECT id FROM meetings ORDER BY created")
        .and_then(|mut st| st.query_map([], |r| r.get(0))?.collect())
        .map_err(|e| e.to_string())?;
    let mut meetings = Vec::new();
    for id in ids {
        let Some(m) = mt::get(&db, &id).map_err(|e| e.to_string())? else { continue };
        let segments: Vec<Value> = mt::segments(&db, &id)
            .map_err(|e| e.to_string())?
            .iter()
            .map(|s| json!({"start": s.start, "end": s.end, "speaker": s.speaker, "text": s.text}))
            .collect();
        let questions: Vec<Value> = db
            .prepare("SELECT question, answer, status, created FROM questions WHERE meeting_id = ?1 ORDER BY id")
            .and_then(|mut st| {
                st.query_map([&id], |r| {
                    Ok(json!({"question": r.get::<_, String>(0)?, "answer": r.get::<_, String>(1)?, "status": r.get::<_, String>(2)?, "created": r.get::<_, String>(3)?}))
                })?
                .collect()
            })
            .map_err(|e| e.to_string())?;
        let file = Path::new(&m.file).file_name().and_then(|f| f.to_str()).unwrap_or("").to_string();
        meetings.push(json!({
            "id": m.id, "title": m.title, "file": file, "duration": m.duration, "language": m.language,
            "status": m.status, "error": m.error, "summary": m.summary, "decisions": m.decisions,
            "action_items": m.action_items, "speaker_names": m.speaker_names, "notes": m.notes, "tags": m.tags,
            "template": m.template, "tier_used": m.tier_used, "device_used": m.device_used, "created": m.created,
            "language_hint": m.language_hint, "translate": m.translate, "auto_title": m.auto_title,
            "speaker_suggestions": m.speaker_suggestions, "segments": segments, "questions": questions,
        }));
    }
    let templates: Vec<Value> = db
        .prepare("SELECT id, name, description, instructions, created FROM note_templates ORDER BY id")
        .and_then(|mut st| {
            st.query_map([], |r| {
                Ok(json!({"id": format!("u{}", r.get::<_, i64>(0)?), "name": r.get::<_, String>(1)?, "description": r.get::<_, String>(2)?,
                          "instructions": r.get::<_, String>(3)?, "created": r.get::<_, String>(4)?}))
            })?
            .collect()
        })
        .map_err(|e| e.to_string())?;
    drop(db);
    // API keys never go into a file the user may hand around
    let saved: Map<String, Value> = app.settings().into_iter().filter(|(k, _)| !settings::SECRET.contains(&k.as_str())).collect();
    Ok(json!({"format": FORMAT, "version": 1, "created": db::now_iso(), "meetings": meetings, "templates": templates, "settings": saved}))
}

/// GET /api/backup.zip?audio=0|1
// shortcut: the zip is built in memory (and is zip32, < 4 GB); stream it to a temp file when
// backups with audio outgrow the RAM of a small machine.
pub async fn backup(State(app): State<AppState>, Query(q): Query<std::collections::HashMap<String, String>>) -> Response {
    let with_audio = q.get("audio").map(String::as_str) == Some("1");
    let made = tokio::task::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let man = manifest(&app)?;
        let body = serde_json::to_vec_pretty(&man).map_err(|e| e.to_string())?;
        let mut owned: Vec<(String, Vec<u8>)> = vec![(MANIFEST.into(), body)];
        if with_audio {
            for m in man["meetings"].as_array().into_iter().flatten() {
                let name = m["file"].as_str().unwrap_or("");
                if audio_name_ok(name) {
                    if let Ok(bytes) = std::fs::read(app.cfg.media_root.join("uploads").join(name)) {
                        owned.push((format!("audio/{name}"), bytes));
                    }
                }
            }
        }
        let refs: Vec<(&str, &[u8])> = owned.iter().map(|(n, b)| (n.as_str(), b.as_slice())).collect();
        Ok(export::zip(&refs))
    })
    .await
    .unwrap_or_else(|e| Err(e.to_string()));
    match made {
        Ok(zip) => {
            let name = format!("privmeet-backup-{}.zip", &db::now_iso()[..10]);
            ([(header::CONTENT_TYPE, "application/zip".to_string()), (header::CONTENT_DISPOSITION, format!("attachment; filename=\"{name}\""))], Body::from(zip))
                .into_response()
        }
        Err(e) => error(StatusCode::INTERNAL_SERVER_ERROR, format!("Could not make the backup: {e}")),
    }
}

// ---------------------------------------------------------------- reading a zip

/// One stored member: where its bytes start and how many there are.
pub struct Entry {
    pub name: String,
    pub offset: u64,
    pub size: u64,
    pub crc: u32,
}

fn u16_at(b: &[u8], i: usize) -> u64 {
    u16::from_le_bytes([b[i], b[i + 1]]) as u64
}
fn u32_at(b: &[u8], i: usize) -> u64 {
    u32::from_le_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]) as u64
}

const NOT_OURS: &str = "This is not a PrivMeet backup.";

/// The members of a zip made by export::zip. Refuses the whole file when any name is a path
/// that could leave a folder ("../", "/x", "C:", "\\") or when a member is compressed.
pub fn entries<F: Read + Seek>(f: &mut F) -> Result<Vec<Entry>, String> {
    let len = f.seek(SeekFrom::End(0)).map_err(|e| e.to_string())?;
    let tail = len.min(22 + 65_535);
    let mut buf = vec![0u8; tail as usize];
    f.seek(SeekFrom::Start(len - tail)).map_err(|e| e.to_string())?;
    f.read_exact(&mut buf).map_err(|e| e.to_string())?;
    let eocd = (0..buf.len().saturating_sub(21)).rev().find(|&i| buf[i..i + 4] == [0x50, 0x4b, 0x05, 0x06]).ok_or(NOT_OURS)?;
    let (count, cd_size, cd_off) = (u16_at(&buf, eocd + 10), u32_at(&buf, eocd + 12), u32_at(&buf, eocd + 16));
    if cd_off + cd_size > len || cd_size > 64 * 1024 * 1024 {
        return Err(NOT_OURS.into());
    }
    let mut cd = vec![0u8; cd_size as usize];
    f.seek(SeekFrom::Start(cd_off)).map_err(|e| e.to_string())?;
    f.read_exact(&mut cd).map_err(|e| e.to_string())?;
    let (mut out, mut i) = (Vec::new(), 0usize);
    for _ in 0..count {
        if i + 46 > cd.len() || cd[i..i + 4] != [0x50, 0x4b, 0x01, 0x02] {
            return Err(NOT_OURS.into());
        }
        let (method, crc, csize, usize_) = (u16_at(&cd, i + 10), u32_at(&cd, i + 16), u32_at(&cd, i + 20), u32_at(&cd, i + 24));
        let (nlen, elen, clen, local) = (u16_at(&cd, i + 28) as usize, u16_at(&cd, i + 30) as usize, u16_at(&cd, i + 32) as usize, u32_at(&cd, i + 42));
        let name = String::from_utf8(cd.get(i + 46..i + 46 + nlen).ok_or(NOT_OURS)?.to_vec()).map_err(|_| NOT_OURS)?;
        if name.split(['/', '\\']).any(|p| p == "..") || name.starts_with(['/', '\\']) || name.contains(['\\', ':', '\0']) {
            return Err(format!("The backup contains an unsafe path ({name}); nothing was restored."));
        }
        if method != 0 || csize != usize_ {
            return Err("Only backups made by PrivMeet can be restored (compressed member found).".into());
        }
        // the data starts after the local header, whose name and extra lengths can differ
        let mut lh = [0u8; 30];
        f.seek(SeekFrom::Start(local)).map_err(|e| e.to_string())?;
        f.read_exact(&mut lh).map_err(|_| NOT_OURS)?;
        if lh[..4] != [0x50, 0x4b, 0x03, 0x04] {
            return Err(NOT_OURS.into());
        }
        let offset = local + 30 + u16_at(&lh, 26) + u16_at(&lh, 28);
        if offset + csize > len {
            return Err(NOT_OURS.into());
        }
        out.push(Entry { name, offset, size: csize, crc: crc as u32 });
        i += 46 + nlen + elen + clen;
    }
    Ok(out)
}

/// A member's bytes into `out`, checking its CRC. At most `limit` bytes.
pub fn copy_entry<F: Read + Seek, W: Write>(f: &mut F, e: &Entry, out: &mut W, limit: u64) -> Result<(), String> {
    if e.size > limit {
        return Err(format!("{} is too large.", e.name));
    }
    f.seek(SeekFrom::Start(e.offset)).map_err(|e| e.to_string())?;
    let (mut left, mut crc, mut buf) = (e.size, !0u32, vec![0u8; 64 * 1024]);
    while left > 0 {
        let n = (left as usize).min(buf.len());
        f.read_exact(&mut buf[..n]).map_err(|e| e.to_string())?;
        crc = export::crc32_update(crc, &buf[..n]);
        out.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        left -= n as u64;
    }
    if !crc != e.crc {
        return Err(format!("{} is damaged (checksum mismatch).", e.name));
    }
    Ok(())
}

// ---------------------------------------------------------------- restoring

fn s(v: &Value, k: &str, limit: usize) -> String {
    v.get(k).and_then(Value::as_str).unwrap_or("").chars().take(limit).collect()
}

fn names_map(v: Option<&Value>) -> Value {
    let Some(o) = v.and_then(Value::as_object) else { return json!({}) };
    Value::Object(
        o.iter()
            .filter(|(k, v)| k.len() <= 2 && k.chars().all(|c| c.is_ascii_digit()) && v.is_string())
            .map(|(k, v)| (k.clone(), Value::String(v.as_str().unwrap().chars().take(60).collect())))
            .collect(),
    )
}

/// Counts of what a restore did.
#[derive(Default, Debug, PartialEq)]
pub struct Restored {
    pub meetings: usize,
    pub skipped: usize,
    pub templates: usize,
    pub settings: usize,
}

/// Restore from an open backup zip. Meetings already here (same id) are skipped, never changed.
pub fn restore<F: Read + Seek>(app: &App, f: &mut F) -> Result<Restored, String> {
    let list = entries(f)?;
    let man = list.iter().find(|e| e.name == MANIFEST).ok_or(NOT_OURS)?;
    let mut raw = Vec::new();
    copy_entry(f, man, &mut raw, MAX_MANIFEST)?;
    let data: Value = serde_json::from_slice(&raw).map_err(|_| NOT_OURS)?;
    if data["format"] != FORMAT || data["version"].as_i64() != Some(1) {
        return Err(NOT_OURS.into());
    }
    let mut done = Restored::default();

    // own templates: matched by name and instructions, so restoring twice adds nothing
    let mut template_ids: std::collections::HashMap<String, String> = Default::default();
    for t in data["templates"].as_array().into_iter().flatten() {
        let Ok(clean) = templates::clean_value(t, false) else { continue };
        let get = |k: &str| clean.get(k).and_then(Value::as_str).unwrap_or("").to_string();
        let db = app.db();
        let found: Option<i64> = db
            .query_row("SELECT id FROM note_templates WHERE name = ?1 AND instructions = ?2", params![get("name"), get("instructions")], |r| r.get(0))
            .ok();
        let pk = match found {
            Some(pk) => pk,
            None => {
                db.execute(
                    "INSERT INTO note_templates (name, description, instructions, created) VALUES (?1, ?2, ?3, ?4)",
                    params![get("name"), get("description"), get("instructions"), db::now_iso()],
                )
                .map_err(|e| e.to_string())?;
                done.templates += 1;
                db.last_insert_rowid()
            }
        };
        template_ids.insert(s(t, "id", 20), format!("u{pk}"));
    }

    let uploads = app.cfg.media_root.join("uploads");
    let default_template = app.default_template();
    for m in data["meetings"].as_array().into_iter().flatten() {
        let Some(id) = m["id"].as_str().and_then(|i| uuid::Uuid::parse_str(i).ok()).map(|u| u.to_string()) else { continue };
        if mt::get(&app.db(), &id).map_err(|e| e.to_string())?.is_some() {
            done.skipped += 1;
            continue;
        }
        let title = Some(s(m, "title", 200)).map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).unwrap_or_else(|| "Restored meeting".into());
        let duration = m["duration"].as_f64().filter(|d| d.is_finite() && *d >= 0.0).unwrap_or(0.0);
        let (status, err) = match m["status"].as_str() {
            Some(st @ ("done" | "failed")) => (st, s(m, "error", 2000)),
            _ => ("failed", "Restored from a backup made while this was processing. Press Retry to run it again.".to_string()),
        };
        let notes = mt::clean_notes(&m["notes"]).unwrap_or_default();
        let tags = mt::clean_tags(m.get("tags").unwrap_or(&json!([]))).unwrap_or_default();
        let items = mt::clean_action_items(m["action_items"].as_array().map(Vec::as_slice).unwrap_or(&[]));
        let decisions: Vec<String> = m["decisions"].as_array().into_iter().flatten().filter_map(Value::as_str).map(|d| d.chars().take(500).collect()).take(50).collect();
        let template = s(m, "template", 40);
        let template = template_ids.get(&template).cloned().unwrap_or(template);
        let template = if app.template_exists(&template) { template } else { default_template.clone() };
        let created = Some(s(m, "created", 40)).filter(|c| db::unix_from_iso(c).is_some()).unwrap_or_else(db::now_iso);
        let language_hint = mt::clean_language(&s(m, "language_hint", 8)).unwrap_or_default();

        // the recording, under a fresh name; the zip's name is only used to find the member
        let file = s(m, "file", 64);
        let mut stored = String::new();
        if audio_name_ok(&file) {
            if let Some(e) = list.iter().find(|e| e.name == format!("audio/{file}")) {
                std::fs::create_dir_all(&uploads).map_err(|e| e.to_string())?;
                let ext = file.rsplit_once('.').map(|(_, x)| x).unwrap_or("bin");
                let name = format!("{}.{ext}", uuid::Uuid::new_v4().simple());
                let path = uploads.join(&name);
                let written = std::fs::File::create(&path).map_err(|e| e.to_string()).and_then(|mut out| copy_entry(f, e, &mut out, u64::MAX));
                match written {
                    Ok(()) => stored = format!("uploads/{name}"),
                    Err(e) => {
                        let _ = std::fs::remove_file(&path);
                        return Err(e);
                    }
                }
            }
        }

        let db = app.db();
        let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO meetings (id, title, file, duration, language, status, progress, error, summary, decisions, action_items, \
             speaker_names, notes, tags, template, tier_used, device_used, created, heartbeat, language_hint, translate, auto_title, speaker_suggestions) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)",
            params![
                id, title, stored, duration, s(m, "language", 16), status, if status == "done" { 100 } else { 0 }, err,
                s(m, "summary", 20_000), Value::from(decisions).to_string(), items.to_string(), names_map(m.get("speaker_names")).to_string(),
                notes, Value::from(tags).to_string(), template, s(m, "tier_used", 20), s(m, "device_used", 20), created, db::now_iso(),
                language_hint, m["translate"].as_bool().unwrap_or(false), m["auto_title"].as_bool().unwrap_or(false),
                names_map(m.get("speaker_suggestions")).to_string()
            ],
        )
        .map_err(|e| e.to_string())?;
        for seg in m["segments"].as_array().into_iter().flatten().take(200_000) {
            let (Some(a), Some(b)) = (seg["start"].as_f64(), seg["end"].as_f64()) else { continue };
            let Ok(text) = mt::clean_segment_text(&seg["text"]) else { continue };
            if !(a.is_finite() && b.is_finite() && a >= 0.0) {
                continue;
            }
            let speaker = seg["speaker"].as_i64().filter(|n| (0..100).contains(n));
            tx.execute("INSERT INTO segments (meeting_id, start, end, speaker, text) VALUES (?1, ?2, ?3, ?4, ?5)", params![id, a, b.max(a), speaker, text])
                .map_err(|e| e.to_string())?;
        }
        for q in m["questions"].as_array().into_iter().flatten().take(10_000) {
            let question = s(q, "question", 1000);
            if question.trim().is_empty() {
                continue;
            }
            let status = if q["status"] == "done" { "done" } else { "failed" };
            let created = Some(s(q, "created", 40)).filter(|c| db::unix_from_iso(c).is_some()).unwrap_or_else(db::now_iso);
            tx.execute(
                "INSERT INTO questions (meeting_id, question, answer, status, created) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, question, s(q, "answer", 5000), status, created],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        done.meetings += 1;
    }

    // settings the user has not set here; each key checked as PATCH /api/settings/ does
    let current = app.settings();
    for (k, v) in data["settings"].as_object().into_iter().flatten() {
        if current.contains_key(k) || settings::SECRET.contains(&k.as_str()) {
            continue;
        }
        if settings::save(&app.cfg.data_dir, &json!({ k: v }), &|id| app.template_exists(id)).is_ok() {
            done.settings += 1;
        }
    }
    Ok(done)
}

/// POST /api/restore (multipart, `file`): a backup zip, streamed to a temp file first.
pub async fn restore_upload(State(app): State<AppState>, mut form: Multipart) -> Response {
    let limit = app.cfg.max_upload_mb.saturating_mul(4) * 1024 * 1024;
    let mut tmp = match tempfile::tempfile_in(&app.cfg.data_dir) {
        Ok(t) => t,
        Err(e) => return error(StatusCode::INTERNAL_SERVER_ERROR, format!("Cannot store the backup: {e}")),
    };
    let mut got = false;
    loop {
        let mut field = match form.next_field().await {
            Ok(Some(f)) => f,
            Ok(None) => break,
            Err(e) => return error(e.status(), format!("Bad upload: {}", e.body_text())),
        };
        if field.name() != Some("file") || got {
            continue;
        }
        got = true;
        let mut size = 0u64;
        loop {
            match field.chunk().await {
                Ok(Some(c)) => {
                    size += c.len() as u64;
                    if size > limit {
                        return error(StatusCode::PAYLOAD_TOO_LARGE, format!("A backup can be at most {} MB.", limit / 1024 / 1024));
                    }
                    if tmp.write_all(&c).is_err() {
                        return error(StatusCode::INTERNAL_SERVER_ERROR, "Cannot store the backup.");
                    }
                }
                Ok(None) => break,
                Err(e) => return error(e.status(), format!("Bad upload: {}", e.body_text())),
            }
        }
    }
    if !got {
        return error(StatusCode::BAD_REQUEST, "No file uploaded.");
    }
    let out = tokio::task::spawn_blocking(move || restore(&app, &mut tmp)).await.unwrap_or_else(|e| Err(e.to_string()));
    match out {
        Ok(r) => Json(json!({"restored": r.meetings, "skipped": r.skipped, "templates": r.templates, "settings": r.settings})).into_response(),
        Err(e) => error(StatusCode::BAD_REQUEST, e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::web::{test_app, test_meeting};
    use std::io::Cursor;

    #[test]
    fn round_trip_into_an_empty_database() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let src = test_app(a.path());
        let id = "6f1e2d3c-4b5a-4978-8a1b-2c3d4e5f6a7b";
        test_meeting(&src, id);
        let file = "0123456789abcdef0123456789abcdef.wav";
        std::fs::create_dir_all(a.path().join("media/uploads")).unwrap();
        std::fs::write(a.path().join("media/uploads").join(file), b"RIFF-audio").unwrap();
        {
            let db = src.db();
            db.execute("UPDATE meetings SET file = ?2, notes = 'n', tags = '[\"Sprint\"]', speaker_names = '{\"0\": \"Asha\"}' WHERE id = ?1", params![id, format!("uploads/{file}")]).unwrap();
            db.execute("INSERT INTO questions (meeting_id, question, answer, status, created) VALUES (?1, 'Who?', 'Rohan [00:04]', 'done', ?2)", params![id, db::now_iso()]).unwrap();
            db.execute("INSERT INTO note_templates (name, description, instructions, created) VALUES ('Retro', '', 'What went well', 'x')", []).unwrap();
            db.execute("UPDATE meetings SET template = 'u1' WHERE id = ?1", [id]).unwrap();
        }
        settings::save(a.path(), &json!({"display_name": "V", "groq_api_key": "secret"}), &|_| true).unwrap();
        let man = manifest(&src).unwrap();
        assert!(!man.to_string().contains("secret"));
        let body = serde_json::to_vec(&man).unwrap();
        let audio = b"RIFF-audio".to_vec();
        let zip = export::zip(&[(MANIFEST, &body), (&format!("audio/{file}"), &audio)]);

        let dst = test_app(b.path());
        let r = restore(&dst, &mut Cursor::new(&zip)).unwrap();
        assert_eq!(r, Restored { meetings: 1, skipped: 0, templates: 1, settings: 1 });
        let m = mt::get(&dst.db(), id).unwrap().unwrap();
        let orig = {
            let db = src.db();
            mt::to_json(&db, &mt::get(&db, id).unwrap().unwrap(), true)
        };
        let back = mt::to_json(&dst.db(), &m, true);
        for k in ["title", "summary", "notes", "tags", "speaker_names", "decisions", "action_items", "status", "created"] {
            assert_eq!(orig[k], back[k], "{k}");
        }
        let texts = |j: &Value| j["segments"].as_array().unwrap().iter().map(|s| (s["text"].clone(), s["speaker"].clone())).collect::<Vec<_>>();
        assert_eq!(texts(&orig), texts(&back));
        assert_eq!(m.template, "u1");
        assert_ne!(m.file, format!("uploads/{file}")); // a fresh name, never the zip's
        assert_eq!(std::fs::read(b.path().join("media").join(&m.file)).unwrap(), b"RIFF-audio");
        let q: i64 = dst.db().query_row("SELECT count(*) FROM questions", [], |r| r.get(0)).unwrap();
        assert_eq!(q, 1);
        assert!(!dst.settings().contains_key("groq_api_key"));
        // again: nothing new, nothing overwritten
        let r = restore(&dst, &mut Cursor::new(&zip)).unwrap();
        assert_eq!(r, Restored { meetings: 0, skipped: 1, templates: 0, settings: 0 });
    }

    #[test]
    fn refuses_unsafe_and_foreign_zips() {
        let dir = tempfile::tempdir().unwrap();
        let app = test_app(dir.path());
        let man = br#"{"format": "privmeet-backup", "version": 1, "meetings": []}"#;
        for bad in ["../evil.wav", "audio/../../x", "/etc/passwd", "C:\\x", "audio\\..\\x"] {
            let zip = export::zip(&[(MANIFEST, man), (bad, b"x")]);
            let e = restore(&app, &mut Cursor::new(&zip)).unwrap_err();
            assert!(e.contains("unsafe path"), "{bad}: {e}");
        }
        assert_eq!(restore(&app, &mut Cursor::new(b"not a zip at all")).unwrap_err(), NOT_OURS);
        let other = export::zip(&[(MANIFEST, br#"{"format": "something"}"#)]);
        assert_eq!(restore(&app, &mut Cursor::new(&other)).unwrap_err(), NOT_OURS);
        // a member whose bytes were changed fails its checksum
        let mut zip = export::zip(&[(MANIFEST, man)]);
        zip[31 + MANIFEST.len()] ^= 1;
        assert!(restore(&app, &mut Cursor::new(&zip)).unwrap_err().contains("damaged"));
        // junk fields are cleaned, not trusted
        let junk = json!({"format": "privmeet-backup", "version": 1, "meetings": [
            {"id": "not-a-uuid"},
            {"id": "7f1e2d3c-4b5a-4978-8a1b-2c3d4e5f6a7b", "title": 5, "status": "transcribing", "tags": "a,b", "file": "../../x.wav",
             "segments": [{"start": -1, "end": 2, "text": "x"}, {"start": 1, "end": 2, "speaker": 999, "text": "ok"}]}]});
        let zip = export::zip(&[(MANIFEST, &serde_json::to_vec(&junk).unwrap())]);
        assert_eq!(restore(&app, &mut Cursor::new(&zip)).unwrap().meetings, 1);
        let m = mt::get(&app.db(), "7f1e2d3c-4b5a-4978-8a1b-2c3d4e5f6a7b").unwrap().unwrap();
        assert_eq!((m.title.as_str(), m.status.as_str(), m.file.as_str()), ("Restored meeting", "failed", ""));
        let segs = mt::segments(&app.db(), &m.id).unwrap();
        assert_eq!((segs.len(), segs[0].speaker), (1, None));
    }
}
