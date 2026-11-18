//! Commands besides serving:
//!   privmeet-server seed-demo [--reset]       the mockup's demo meetings (seed_demo.py)
//!   privmeet-server import-django <db.sqlite3> meetings, transcripts, questions and templates
//!                                              from a Django install's SQLite database
//!   privmeet-server process-file <file> [--title T]  one recording through the whole pipeline,
//!                                              no web UI (process_file.py)

use std::path::Path;
use std::process::Command;
use std::time::Duration;

use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde_json::Value;

use crate::config::Config;
use crate::{audio, db};

const DEMO: &str = "demo";
/// The demo meetings, exported once from backend/meetings/management/commands/seed_demo.py.
const DEMO_JSON: &str = include_str!("demo.json");

/// Run a command named on the command line; None when the arguments name none (serve).
pub fn run(args: &[String], cfg: &Config) -> Option<Result<String, String>> {
    let out = match args.first().map(String::as_str)? {
        "seed-demo" => seed_demo(cfg, args.iter().any(|a| a == "--reset")),
        "import-django" => match args.get(1) {
            Some(p) => import_django(cfg, Path::new(p)),
            None => Err("usage: privmeet-server import-django <path to Django's db.sqlite3>".into()),
        },
        "process-file" => match args.get(1) {
            Some(p) => process_file(cfg, Path::new(p), args.iter().position(|a| a == "--title").and_then(|i| args.get(i + 1)).map(String::as_str)),
            None => Err("usage: privmeet-server process-file <audio or video file> [--title T]".into()),
        },
        "help" | "--help" | "-h" => Ok("usage: privmeet-server [seed-demo [--reset] | import-django <db.sqlite3> | process-file <file> [--title T]]".into()),
        other => Err(format!("unknown command {other:?}; try --help")),
    };
    Some(out)
}

fn open(cfg: &Config) -> Result<Connection, String> {
    std::fs::create_dir_all(&cfg.data_dir).map_err(|e| e.to_string())?;
    db::open(&cfg.data_dir.join("privmeet.sqlite3")).map_err(|e| format!("database: {e}"))
}

/// Silent mono Opus of the given length (8 kb/s), so the player and seeking work.
fn silence(seconds: i64, dst: &Path) -> Result<(), String> {
    let mut cmd = Command::new("ffmpeg");
    cmd.args(["-nostdin", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", &seconds.to_string(), "-c:a", "libopus", "-b:a", "8k"]).arg(dst);
    audio::run(&mut cmd, Duration::from_secs(3 * 3600)).map(|_| ()).map_err(|e| format!("ffmpeg failed: {e}"))
}

/// The mockup's meetings without Whisper or Ollama. Demo rows have tier_used "demo"; --reset
/// deletes only those. Running twice adds nothing.
fn seed_demo(cfg: &Config, reset: bool) -> Result<String, String> {
    let conn = open(cfg)?;
    let mut said = Vec::new();
    if reset {
        let files: Vec<String> = conn
            .prepare("SELECT file FROM meetings WHERE tier_used = ?1")
            .and_then(|mut st| st.query_map([DEMO], |r| r.get(0))?.collect())
            .map_err(|e| e.to_string())?;
        for f in &files {
            if !f.is_empty() {
                let _ = std::fs::remove_file(cfg.media_root.join(f));
            }
        }
        conn.execute("DELETE FROM meetings WHERE tier_used = ?1", [DEMO]).map_err(|e| e.to_string())?;
        said.push(format!("Deleted {} demo meeting(s).", files.len()));
    }
    let demos: Vec<Value> = serde_json::from_str(DEMO_JSON).map_err(|e| e.to_string())?;
    let uploads = cfg.media_root.join("uploads");
    std::fs::create_dir_all(&uploads).map_err(|e| e.to_string())?;
    let mut made = 0;
    for d in &demos {
        let title = d["title"].as_str().unwrap_or("");
        let have = conn.query_row("SELECT 1 FROM meetings WHERE tier_used = ?1 AND title = ?2", [DEMO, title], |_| Ok(())).optional().map_err(|e| e.to_string())?;
        if have.is_some() {
            continue;
        }
        let duration = d["minutes"].as_i64().unwrap_or(0) * 60;
        let name = format!("{}.opus", uuid::Uuid::new_v4().simple());
        silence(duration, &uploads.join(&name))?;
        let (id, now) = (uuid::Uuid::new_v4().to_string(), db::now_iso());
        let status = d["status"].as_str().unwrap_or("done");
        let progress = d["progress"].as_i64().unwrap_or(0);
        let speakers: serde_json::Map<String, Value> =
            d["speakers"].as_array().into_iter().flatten().enumerate().map(|(i, n)| (i.to_string(), n.clone())).collect();
        conn.execute(
            "INSERT INTO meetings (id, title, file, duration, language, status, progress, error, summary, decisions, \
             action_items, speaker_names, tier_used, created, heartbeat) VALUES (?1, ?2, ?3, ?4, 'en', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                id, title, format!("uploads/{name}"), duration as f64, status, progress, d["error"].as_str().unwrap_or(""),
                d["summary"].as_str().unwrap_or(""), d["decisions"].to_string(), d["action_items"].to_string(),
                Value::Object(speakers).to_string(), DEMO, d["when"].as_str().unwrap_or(&now), now
            ],
        )
        .map_err(|e| e.to_string())?;
        // lines spread evenly over the transcribed part, each a little shorter than its slot
        let lines = d["lines"].as_array().cloned().unwrap_or_default();
        let done = if status == "transcribing" { duration as f64 * progress as f64 / 100.0 } else { duration as f64 };
        let slot = done / lines.len().max(1) as f64;
        let r2 = |v: f64| (v * 100.0).round() / 100.0;
        for (i, l) in lines.iter().enumerate() {
            conn.execute(
                "INSERT INTO segments (meeting_id, start, end, speaker, text) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, r2(i as f64 * slot), r2((i + 1) as f64 * slot - 1.0), l[0].as_i64(), l[1].as_str().unwrap_or("")],
            )
            .map_err(|e| e.to_string())?;
        }
        made += 1;
    }
    said.push(format!("Added {made} demo meeting(s)."));
    Ok(said.join("\n"))
}

/// Create a meeting from a local file and run the pipeline in this process, then print the
/// notes. Fails (exit 1) when processing does not end in "done".
fn process_file(cfg: &Config, path: &Path, title: Option<&str>) -> Result<String, String> {
    if !path.is_file() {
        return Err(format!("No such file: {}", path.display()));
    }
    let ext = path.extension().and_then(|e| e.to_str()).map(|e| format!(".{}", e.to_lowercase())).unwrap_or_default();
    if !crate::meetings::ALLOWED_EXT.contains(&ext.as_str()) {
        return Err(format!("Unsupported file type. Allowed: {}", crate::meetings::ALLOWED_EXT.join(", ")));
    }
    let Some(duration) = audio::probe(path) else { return Err("No audio stream found".into()) };
    let app = crate::web::App::new(cfg.clone())?;
    let name = format!("{}{ext}", uuid::Uuid::new_v4().simple());
    let uploads = cfg.media_root.join("uploads");
    std::fs::create_dir_all(&uploads).map_err(|e| e.to_string())?;
    std::fs::copy(path, uploads.join(&name)).map_err(|e| e.to_string())?;
    let (id, now) = (uuid::Uuid::new_v4().to_string(), db::now_iso());
    let title = title.map(String::from).unwrap_or_else(|| path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default());
    app.db()
        .execute(
            "INSERT INTO meetings (id, title, file, duration, template, created, heartbeat) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            params![id, title, format!("uploads/{name}"), duration, app.default_template(), now],
        )
        .map_err(|e| e.to_string())?;
    eprintln!("Meeting {id}: processing {}...", path.display());
    crate::pipeline::process_meeting(&app, &id);
    let db = app.db();
    let m = crate::meetings::get(&db, &id).map_err(|e| e.to_string())?.ok_or("The meeting vanished.")?;
    if m.status != "done" {
        return Err(format!("Processing failed: {}", m.error));
    }
    let segs = crate::meetings::segments(&db, &id).map_err(|e| e.to_string())?;
    let notes = crate::export::plain_text(&m, &segs);
    Ok(format!("Status: {}  tier: {}  language: {}\n\n{}", m.status, m.tier_used, m.language, String::from_utf8_lossy(&notes.body)))
}

/// Django's SQLite datetime "2026-11-04 05:56:12.746947" (UTC) as ISO 8601 with +00:00.
fn django_time(v: &str) -> String {
    let v = v.trim().replace(' ', "T");
    let v = v.trim_end_matches("+00:00").trim_end_matches('Z');
    let (main, frac) = v.split_once('.').unwrap_or((v, ""));
    let frac = &frac[..frac.len().min(6)];
    if frac.trim_matches('0').is_empty() { format!("{main}+00:00") } else { format!("{main}.{frac:0<6}+00:00") }
}

/// Django's SQLite UUID "c7f646ce22174ca0ade5955cab024d1d" in the dashed form the API uses.
fn django_uuid(v: &str) -> String {
    uuid::Uuid::parse_str(v).map(|u| u.to_string()).unwrap_or_else(|_| v.to_string())
}

/// Copy a Django install into this one: meetings (matched by id; existing ones are skipped,
/// never overwritten), their segments and questions, own templates, and the audio files.
// shortcut: SQLite only; a Postgres install exports with `manage.py dumpdata` first, add that if anyone needs it.
fn import_django(cfg: &Config, src: &Path) -> Result<String, String> {
    let old = Connection::open_with_flags(src, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| format!("{}: {e}", src.display()))?;
    let old_media = src.parent().unwrap_or(Path::new(".")).join("media");
    let mut conn = open(cfg)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let (mut meetings, mut skipped, mut segs, mut qs, mut files, mut tpls) = (0, 0, 0, 0, 0, 0);
    {
        let mut st = old
            .prepare(
                "SELECT id, title, file, duration, language, status, progress, error, summary, decisions, action_items, \
                 speaker_names, tier_used, created, notes, tags, device_used, heartbeat, template FROM meetings_meeting",
            )
            .map_err(|e| format!("not a PrivMeet Django database: {e}"))?;
        let rows: Vec<Vec<rusqlite::types::Value>> = st
            .query_map([], |r| (0..19).map(|i| r.get::<_, rusqlite::types::Value>(i)).collect())
            .and_then(|it| it.collect())
            .map_err(|e| e.to_string())?;
        use rusqlite::types::Value as V;
        let text = |v: &V| match v {
            V::Text(s) => s.clone(),
            V::Integer(n) => n.to_string(),
            V::Real(f) => f.to_string(),
            _ => String::new(),
        };
        for r in rows {
            let old_id = text(&r[0]);
            let id = django_uuid(&old_id);
            let exists = tx.query_row("SELECT 1 FROM meetings WHERE id = ?1", [&id], |_| Ok(())).optional().map_err(|e| e.to_string())?;
            if exists.is_some() {
                skipped += 1;
                continue;
            }
            let file = text(&r[2]);
            // the audio: copied when the database is from another folder, kept when it is already ours
            if !file.is_empty() && !file.contains("..") && !file.starts_with('/') {
                let (from, to) = (old_media.join(&file), cfg.media_root.join(&file));
                if from.is_file() && !to.exists() {
                    if let Some(dir) = to.parent() {
                        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
                    }
                    std::fs::copy(&from, &to).map_err(|e| format!("{}: {e}", from.display()))?;
                    files += 1;
                }
            }
            let json_or = |v: &V, empty: &str| {
                let s = text(v);
                if serde_json::from_str::<Value>(&s).is_ok() { s } else { empty.to_string() }
            };
            let num = |v: &V| match v {
                V::Integer(n) => *n as f64,
                V::Real(f) => *f,
                _ => 0.0,
            };
            tx.execute(
                "INSERT INTO meetings (id, title, file, duration, language, status, progress, error, summary, decisions, \
                 action_items, speaker_names, tier_used, created, notes, tags, device_used, heartbeat, template) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
                params![
                    id, text(&r[1]), file, num(&r[3]), text(&r[4]), text(&r[5]), num(&r[6]) as i64, text(&r[7]), text(&r[8]),
                    json_or(&r[9], "[]"), json_or(&r[10], "[]"), json_or(&r[11], "{}"), text(&r[12]), django_time(&text(&r[13])),
                    text(&r[14]), json_or(&r[15], "[]"), text(&r[16]), django_time(&text(&r[17])), text(&r[18])
                ],
            )
            .map_err(|e| e.to_string())?;
            meetings += 1;
            let mut ss = old.prepare("SELECT start, end, speaker, text FROM meetings_segment WHERE meeting_id = ?1 ORDER BY start, id").map_err(|e| e.to_string())?;
            let seg_rows: Vec<(f64, f64, Option<i64>, String)> =
                ss.query_map([&old_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).and_then(|it| it.collect()).map_err(|e| e.to_string())?;
            for (a, b, who, t) in seg_rows {
                tx.execute("INSERT INTO segments (meeting_id, start, end, speaker, text) VALUES (?1, ?2, ?3, ?4, ?5)", params![id, a, b, who, t]).map_err(|e| e.to_string())?;
                segs += 1;
            }
            let mut qq = old.prepare("SELECT question, answer, status, created FROM meetings_question WHERE meeting_id = ?1 ORDER BY id").map_err(|e| e.to_string())?;
            let q_rows: Vec<(String, String, String, String)> =
                qq.query_map([&old_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).and_then(|it| it.collect()).map_err(|e| e.to_string())?;
            for (q, a, s, c) in q_rows {
                tx.execute("INSERT INTO questions (meeting_id, question, answer, status, created) VALUES (?1, ?2, ?3, ?4, ?5)", params![id, q, a, s, django_time(&c)]).map_err(|e| e.to_string())?;
                qs += 1;
            }
        }
    }
    // own templates keep their number, so a meeting's "u<pk>" still points at the same one
    let mut st = old.prepare("SELECT id, name, description, instructions, created FROM meetings_notetemplate").map_err(|e| e.to_string())?;
    let t_rows: Vec<(i64, String, String, String, String)> =
        st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))).and_then(|it| it.collect()).map_err(|e| e.to_string())?;
    for (pk, n, d, i, c) in t_rows {
        tpls += tx
            .execute("INSERT OR IGNORE INTO note_templates (id, name, description, instructions, created) VALUES (?1, ?2, ?3, ?4, ?5)", params![pk, n, d, i, django_time(&c)])
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(format!(
        "Imported {meetings} meeting(s) ({skipped} already here), {segs} transcript line(s), {qs} question(s), {tpls} template(s), {files} audio file(s)."
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn django_values() {
        assert_eq!(django_time("2026-11-04 05:56:12.746947"), "2026-11-04T05:56:12.746947+00:00");
        assert_eq!(django_time("2026-11-04 05:56:12"), "2026-11-04T05:56:12+00:00");
        assert_eq!(django_uuid("c7f646ce22174ca0ade5955cab024d1d"), "c7f646ce-2217-4ca0-ade5-955cab024d1d");
    }

    #[test]
    fn demo_data_parses() {
        let d: Vec<Value> = serde_json::from_str(DEMO_JSON).unwrap();
        assert_eq!(d.len(), 5);
        assert_eq!(d[0]["title"], "Project Sync");
    }
}
