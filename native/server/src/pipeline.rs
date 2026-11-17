//! The work queue and the pipeline: one job at a time on one worker thread, as the Celery
//! worker runs with concurrency 1, so only one heavy model is ever in memory. A port of
//! backend/meetings/tasks.py (process_meeting, answer_question) and search.excerpts.

use std::collections::HashMap;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex, OnceLock};

use rusqlite::params;
use serde_json::Value;

use crate::meetings::{self as mt, Meeting, Segment};
use crate::web::{App, AppState};
use crate::{audio, db, diarize, hw, llm, names, providers, stt, templates};

pub enum Job {
    Meeting(String),
    Question(i64),
}

static QUEUE: OnceLock<Mutex<Sender<Job>>> = OnceLock::new();

/// Start the worker thread. Rows left processing by a previous run are failed first: no run
/// survives a restart (apps.reap_interrupted).
pub fn start(app: Arc<App>) {
    {
        let db = app.db();
        let n = db
            .execute(
                &format!(
                    "UPDATE meetings SET status = 'failed', progress = 0, heartbeat = ?1, \
                     error = 'The server stopped while this was processing. Press Retry to run it again.' \
                     WHERE status IN ({})",
                    mt::PROCESSING.iter().map(|s| format!("'{s}'")).collect::<Vec<_>>().join(",")
                ),
                [db::now_iso()],
            )
            .unwrap_or(0);
        if n > 0 {
            eprintln!("freed {n} meeting(s) left processing by the previous run");
        }
        let _ = db.execute("UPDATE questions SET status = 'failed', answer = 'Error: the server restarted.' WHERE status = 'pending'", []);
    }
    let (tx, rx) = channel::<Job>();
    let _ = QUEUE.set(Mutex::new(tx));
    std::thread::Builder::new()
        .name("pipeline".into())
        .spawn(move || {
            for job in rx {
                match job {
                    Job::Meeting(id) => process_meeting(&app, &id),
                    Job::Question(id) => answer_question(&app, id),
                }
            }
        })
        .expect("start the pipeline thread");
}

fn send(job: Job) {
    if let Some(q) = QUEUE.get() {
        let _ = q.lock().unwrap_or_else(|p| p.into_inner()).send(job);
    }
}

pub fn enqueue(_app: &AppState, meeting: &str) {
    send(Job::Meeting(meeting.to_string()));
}

pub fn enqueue_question(_app: &AppState, question: i64) {
    send(Job::Question(question));
}

/// "Who: words" per line, with "[mm:ss] " in front when `timestamps` (Meeting.transcript).
pub fn transcript(m: &Meeting, segs: &[Segment], timestamps: bool, guessed: Option<&HashMap<i64, String>>) -> String {
    segs.iter()
        .map(|s| {
            let who = m.speaker_label(s.speaker, guessed);
            let stamp = if timestamps { format!("[{}] ", mmss(s.start)) } else { String::new() };
            format!("{stamp}{}{}", if who.is_empty() { String::new() } else { format!("{who}: ") }, s.text)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn mmss(seconds: f64) -> String {
    let s = seconds.max(0.0) as i64;
    if s >= 3600 { format!("{}:{:02}:{:02}", s / 3600, s / 60 % 60, s % 60) } else { format!("{:02}:{:02}", s / 60, s % 60) }
}

fn progress(app: &App, id: &str, status: &str, value: i64) {
    mt::set_status(&app.db(), id, status, Some(value));
}

/// The whole pipeline for one meeting: ffmpeg -> Whisper (here or in the cloud) -> names ->
/// diarization -> summary. Each stage frees its model before the next one loads.
fn process_meeting(app: &App, id: &str) {
    if let Err(e) = run(app, id) {
        eprintln!("meeting {id} failed: {e}");
        let msg: String = e.chars().take(2000).collect();
        let _ = app.db().execute(
            "UPDATE meetings SET error = ?2, status = 'failed', heartbeat = ?3 WHERE id = ?1",
            params![id, if msg.is_empty() { "Error".to_string() } else { msg }, db::now_iso()],
        );
    }
}

fn run(app: &App, id: &str) -> Result<(), String> {
    let Some(m) = mt::get(&app.db(), id).map_err(|e| e.to_string())? else { return Ok(()) };
    let p = app.profile();
    let saved = app.settings();
    let known = names::known_names(&app.db(), &saved);
    let prompt = names::asr_prompt(&known);
    let fix = names::Corrector::new(&known);
    {
        let db = app.db();
        db.execute("UPDATE meetings SET tier_used = ?2, error = '' WHERE id = ?1", params![id, p.tier]).map_err(|e| e.to_string())?;
        db.execute("DELETE FROM segments WHERE meeting_id = ?1", [id]).map_err(|e| e.to_string())?;
    }
    let tmp = tempfile::Builder::new().suffix(".wav").tempfile().map_err(|e| e.to_string())?;
    let wav = tmp.path().to_path_buf();

    progress(app, id, "converting", 0);
    audio::to_wav(&app.cfg.media_root.join(&m.file), &wav)?;

    progress(app, id, "transcribing", 2);
    let on_asr = |f: f64| progress(app, id, "transcribing", 2 + (68.0 * f) as i64);
    let (segs, info) = stt::transcribe(&wav, &p, &app.cfg.models_dir, &prompt, &on_asr)?;
    let device = if hw::uses_cloud(&p) { p.llm_provider.chars().take(8).collect() } else { p.device.clone() };
    {
        let db = app.db();
        db.execute(
            "UPDATE meetings SET duration = ?2, language = ?3, device_used = ?4 WHERE id = ?1",
            params![id, info.duration, info.language, device],
        )
        .map_err(|e| e.to_string())?;
        let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;
        for s in &segs {
            let text = fix.as_ref().map_or_else(|| s.text.clone(), |f| f.fix(&s.text));
            tx.execute("INSERT INTO segments (meeting_id, start, end, text) VALUES (?1, ?2, ?3, ?4)", params![id, s.start, s.end, text])
                .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
    }

    if p.diarize && diarize::available(&app.cfg.models_dir) {
        progress(app, id, "diarizing", 70);
        let turns = diarize::diarize(stt::read_wav(&wav)?, &app.cfg.models_dir, p.cpu_threads)?;
        let mut stored = mt::segments(&app.db(), id).map_err(|e| e.to_string())?;
        diarize::assign_speakers(&mut stored, &turns);
        let db = app.db();
        let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;
        for s in &stored {
            tx.execute("UPDATE segments SET speaker = ?2 WHERE id = ?1", params![s.id, s.speaker]).map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
    } else if p.diarize {
        eprintln!("diarization models missing in {}, skipping", diarize::models_dir(&app.cfg.models_dir).display());
    }
    drop(tmp); // the WAV is no longer needed

    progress(app, id, "summarizing", 80);
    providers::ensure_model(&p)?;
    let (m, stored) = {
        let db = app.db();
        (mt::get(&db, id).map_err(|e| e.to_string())?.ok_or("The meeting was deleted.")?, mt::segments(&db, id).map_err(|e| e.to_string())?)
    };
    // who is which speaker, from the conversation, so "I'll do it" gets the right owner
    let guessed = names::infer_speakers(&stored, &known);
    let focus = templates::instructions(&app.db(), &m.template, &app.default_template());
    let on_llm = |f: f64| progress(app, id, "summarizing", 80 + (15.0 * f) as i64);
    let notes = llm::summarize(&transcript(&m, &stored, false, Some(&guessed)), &p, &on_llm, &m.language, &focus)?;
    app.db()
        .execute(
            "UPDATE meetings SET summary = ?2, decisions = ?3, action_items = ?4, status = 'done', progress = 100, heartbeat = ?5 WHERE id = ?1",
            params![id, notes.summary, Value::from(notes.decisions.clone()).to_string(), notes.items_json().to_string(), db::now_iso()],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

const HITS: usize = 8;
const BEFORE: usize = 2;
const AFTER: usize = 20;

/// The whole transcript when it fits the model's context, else the best-matching lines (FTS5)
/// with neighbours, gaps marked "...", best hit first so the weakest lose their tail.
pub fn excerpts(app: &App, m: &Meeting, question: &str, max_chars: usize) -> String {
    let segs = mt::segments(&app.db(), &m.id).unwrap_or_default();
    let full = transcript(m, &segs, true, None);
    if full.chars().count() <= max_chars {
        return full;
    }
    let words = mt::search_words(question, true);
    let hits: Vec<i64> = if words.is_empty() {
        vec![]
    } else {
        let db = app.db();
        db.prepare(
            "SELECT s.id FROM segments_fts f JOIN segments s ON s.id = f.rowid \
             WHERE segments_fts MATCH ?1 AND s.meeting_id = ?2 ORDER BY bm25(segments_fts) LIMIT ?3",
        )
        .and_then(|mut st| st.query_map(params![mt::fts_query(&words), m.id, HITS as i64], |r| r.get(0))?.collect())
        .unwrap_or_default()
    };
    if hits.is_empty() {
        // nothing matched ("summarize the meeting"): the summary and the opening beat nothing
        let head = if m.summary.is_empty() { String::new() } else { format!("Meeting summary: {}\n\n", m.summary) };
        return (head + &full).chars().take(max_chars).collect();
    }
    let pos: HashMap<i64, usize> = segs.iter().enumerate().map(|(i, s)| (s.id, i)).collect();
    let (mut keep, mut used): (Vec<usize>, usize) = (Vec::new(), 0);
    'hits: for h in hits {
        let Some(&at) = pos.get(&h) else { continue };
        for j in at.saturating_sub(BEFORE)..=(at + AFTER).min(segs.len() - 1) {
            if keep.contains(&j) {
                continue;
            }
            let line = transcript(m, std::slice::from_ref(&segs[j]), true, None);
            if used + line.chars().count() + 1 > max_chars {
                continue 'hits;
            }
            keep.push(j);
            used += line.chars().count() + 1;
        }
    }
    keep.sort_unstable();
    let mut lines: Vec<String> = Vec::new();
    let mut last: Option<usize> = None;
    for j in keep {
        if last.is_some_and(|l| j != l + 1) {
            lines.push("...".into());
        }
        lines.push(transcript(m, std::slice::from_ref(&segs[j]), true, None));
        last = Some(j);
    }
    lines.join("\n").chars().take(max_chars).collect()
}

fn answer_question(app: &App, qid: i64) {
    let row: Option<(String, String)> = app
        .db()
        .query_row("SELECT meeting_id, question FROM questions WHERE id = ?1", [qid], |r| Ok((r.get(0)?, r.get(1)?)))
        .ok();
    let Some((mid, question)) = row else { return };
    let result = (|| -> Result<String, String> {
        let m = mt::get(&app.db(), &mid).map_err(|e| e.to_string())?.ok_or("The meeting was deleted.")?;
        let p = app.profile();
        providers::ensure_model(&p)?;
        llm::answer(&excerpts(app, &m, &question, llm::qa_chars(&p)), &question, &p)
    })();
    let (answer, status) = match result {
        Ok(a) => (a, "done"),
        Err(e) => (format!("Error: {e}"), "failed"),
    };
    let _ = app.db().execute("UPDATE questions SET answer = ?2, status = ?3 WHERE id = ?1", params![qid, answer, status]);
}
