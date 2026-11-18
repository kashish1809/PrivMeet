//! The work queue and the pipeline: one job at a time on one worker thread, as the Celery
//! worker runs with concurrency 1, so only one heavy model is ever in memory. A port of
//! backend/meetings/tasks.py (process_meeting, answer_question) and search.excerpts.

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex, OnceLock};

use rusqlite::params;
use serde_json::Value;

use crate::meetings::{self as mt, Meeting, Segment};
use crate::web::{App, AppState};
use crate::{audio, db, diarize, hw, llm, names, providers, stt, templates};

pub enum Job {
    Meeting(String),
    /// Only the LLM stage, on the stored transcript: (meeting, template, status to go back to on failure).
    Summarize(String, Option<String>, String),
    Question(i64),
    Pull(String),
}

static QUEUE: OnceLock<Mutex<Sender<Job>>> = OnceLock::new();
/// Meetings waiting for the worker, in order: queue_position, and what a cancel takes out.
static PENDING: Mutex<VecDeque<String>> = Mutex::new(VecDeque::new());
/// The meeting the worker is running now, and whether the user asked to stop it. The flag is
/// a static so whisper.cpp's and sherpa-onnx's 'static callbacks can read it.
static CURRENT: Mutex<Option<String>> = Mutex::new(None);
static CANCEL: AtomicBool = AtomicBool::new(false);

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

/// How many queued meetings are ahead of this one; None when it is not waiting.
pub fn queue_position(id: &str) -> Option<usize> {
    lock(&PENDING).iter().position(|x| x == id)
}

/// Whether the running meeting should stop (read by the transcription and diarization loops).
pub fn cancelled() -> bool {
    CANCEL.load(Ordering::Relaxed)
}

/// Stop a meeting: the running one stops at its next check (true), a waiting one leaves the
/// queue at once (false: the caller marks it failed).
pub fn cancel(id: &str) -> bool {
    if lock(&CURRENT).as_deref() == Some(id) {
        CANCEL.store(true, Ordering::Relaxed);
        return true;
    }
    lock(&PENDING).retain(|x| x != id);
    false
}

/// Take the first waiting entry for `id`; false when a cancel already removed it, so a job
/// whose meeting was cancelled (or retried, which queues it again) is not run twice.
fn take_pending(id: &str) -> bool {
    let mut q = lock(&PENDING);
    match q.iter().position(|x| x == id) {
        Some(i) => {
            q.remove(i);
            true
        }
        None => false,
    }
}

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
                    Job::Meeting(id) => {
                        if take_pending(&id) {
                            *lock(&CURRENT) = Some(id.clone());
                            CANCEL.store(mt::cancel_requested(&app.db(), &id), Ordering::Relaxed);
                            process_meeting(&app, &id);
                            *lock(&CURRENT) = None;
                            CANCEL.store(false, Ordering::Relaxed);
                        }
                    }
                    Job::Summarize(id, template, before) => summarize_meeting(&app, &id, template.as_deref(), &before),
                    Job::Question(id) => answer_question(&app, id),
                    Job::Pull(name) => crate::models::pull_model(&app, &name),
                }
                release_memory();
            }
        })
        .expect("start the pipeline thread");
}

/// glibc keeps the heap Whisper and ONNX freed for reuse (~70 MB after a meeting); hand it back
/// to the OS so the idle server shrinks again.
fn release_memory() {
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    unsafe {
        unsafe extern "C" {
            fn malloc_trim(pad: usize) -> i32;
        }
        malloc_trim(0);
    }
}

fn send(job: Job) {
    if let Some(q) = QUEUE.get() {
        let _ = q.lock().unwrap_or_else(|p| p.into_inner()).send(job);
    }
}

/// Queue an Ollama model download behind any meeting being processed.
pub fn enqueue_pull(name: &str) {
    send(Job::Pull(name.to_string()));
}

pub fn enqueue(_app: &AppState, meeting: &str) {
    if QUEUE.get().is_some() {
        lock(&PENDING).push_back(meeting.to_string());
    }
    send(Job::Meeting(meeting.to_string()));
}

/// Queue a new summary of a processed meeting; `before` is its status, kept if this fails.
pub fn enqueue_summary(meeting: &str, template: Option<String>, before: &str) {
    send(Job::Summarize(meeting.to_string(), template, before.to_string()));
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

/// The check before each stage: Err("Cancelled.") once the user asked to stop.
fn check(app: &App, id: &str) -> Result<(), String> {
    if cancelled() || mt::cancel_requested(&app.db(), id) { Err(mt::CANCELLED.into()) } else { Ok(()) }
}

fn progress(app: &App, id: &str, status: &str, value: i64) {
    mt::set_status(&app.db(), id, status, Some(value));
}

/// The whole pipeline for one meeting: ffmpeg -> Whisper (here or in the cloud) -> names ->
/// diarization -> summary. Each stage frees its model before the next one loads.
pub fn process_meeting(app: &App, id: &str) {
    let result = run(app, id);
    if result.is_ok() && app.settings().get("keep_audio").and_then(Value::as_bool) == Some(false) {
        // keep_audio off: the notes and transcript are all the user wants to keep
        let db = app.db();
        if let Ok(Some(m)) = mt::get(&db, id) {
            mt::remove_audio(&app.cfg.media_root, &m.file);
            let _ = db.execute("UPDATE meetings SET file = '' WHERE id = ?1", [id]);
        }
    }
    if let Err(e) = result {
        eprintln!("meeting {id} failed: {e}");
        // a stage stopped by the cancel flag reports its own error; the user asked for this
        let e = if cancelled() || mt::cancel_requested(&app.db(), id) { mt::CANCELLED.to_string() } else { e };
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

    check(app, id)?;
    progress(app, id, "converting", 0);
    audio::to_wav(&app.cfg.media_root.join(&m.file), &wav)?;

    check(app, id)?;
    progress(app, id, "transcribing", 2);
    let on_asr = |f: f64| progress(app, id, "transcribing", 2 + (68.0 * f) as i64);
    let lang = stt::Lang { hint: &m.language_hint, translate: m.translate };
    let (segs, info) = stt::transcribe(&wav, &p, &app.cfg.models_dir, &prompt, lang, &on_asr)?;
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
        check(app, id)?;
        progress(app, id, "diarizing", 70);
        let on_dia = |f: f64| progress(app, id, "diarizing", 70 + (10.0 * f) as i64);
        let mut stored = mt::segments(&app.db(), id).map_err(|e| e.to_string())?;
        // only the speech voice activity detection found, so long silences cost nothing (R1.22)
        let all = stt::read_wav(&wav)?;
        let mut speech = stt::Speech::glue(&all, &info.speech);
        let glued = !info.speech.is_empty();
        let input = if glued { std::mem::take(&mut speech.samples) } else { all };
        let mut turns = if stored.is_empty() { vec![] } else { diarize::diarize(input, &app.cfg.models_dir, p.cpu_threads, &on_dia)? };
        if glued {
            for t in &mut turns {
                (t.0, t.1) = speech.original_span(t.0, t.1);
            }
        }
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

    write_notes(app, id, &p, &known, None)
}

/// The LLM stage: the summary, key points and action items from the stored transcript, then
/// status done. `template` replaces the meeting's own template and is saved with the notes.
fn write_notes(app: &App, id: &str, p: &hw::Profile, known: &[String], template: Option<&str>) -> Result<(), String> {
    check(app, id)?;
    progress(app, id, "summarizing", 80);
    providers::ensure_model(p)?;
    let (m, stored) = {
        let db = app.db();
        (mt::get(&db, id).map_err(|e| e.to_string())?.ok_or("The meeting was deleted.")?, mt::segments(&db, id).map_err(|e| e.to_string())?)
    };
    // who is which speaker, from the conversation, so "I'll do it" gets the right owner
    let guessed = names::infer_speakers(&stored, known);
    let template = template.unwrap_or(&m.template).to_string();
    let focus = templates::instructions(&app.db(), &template, &app.default_template());
    let on_llm = |f: f64| progress(app, id, "summarizing", 80 + (15.0 * f) as i64);
    // a translated transcript is English whatever was spoken
    let language = if m.translate { "English" } else { m.language.as_str() };
    let notes = llm::summarize(&transcript(&m, &stored, false, Some(&guessed)), p, &on_llm, language, &focus)?;
    check(app, id)?; // an LLM call cannot be stopped midway: drop its result instead
    // names for speakers: the ones read from who addresses whom, then the model's for the rest;
    // only suggestions, never written to speaker_names
    let present: std::collections::HashSet<i64> = stored.iter().filter_map(|s| s.speaker).collect();
    let mut suggestions = serde_json::Map::new();
    for (n, name) in guessed.iter().map(|(n, v)| (*n, v.clone())).chain(notes.speakers.iter().cloned()) {
        if present.contains(&n) {
            suggestions.entry(n.to_string()).or_insert(Value::String(name));
        }
    }
    let title = if m.auto_title && !notes.title.is_empty() { notes.title.clone() } else { m.title.clone() };
    app.db()
        .execute(
            "UPDATE meetings SET summary = ?2, decisions = ?3, action_items = ?4, template = ?5, error = '', status = 'done', progress = 100, \
             heartbeat = ?6, title = ?7, speaker_suggestions = ?8 WHERE id = ?1",
            params![id, notes.summary, Value::from(notes.decisions.clone()).to_string(), notes.items_json().to_string(), template, db::now_iso(), title, Value::Object(suggestions).to_string()],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// A new summary without ffmpeg, Whisper or diarization. On failure the old notes stay and the
/// meeting goes back to the status it had, with the reason in `error`.
pub fn summarize_meeting(app: &App, id: &str, template: Option<&str>, before: &str) {
    eprintln!("meeting {id}: summary only, from the stored transcript (Whisper is not loaded)");
    let result = (|| {
        let p = app.profile();
        let known = names::known_names(&app.db(), &app.settings());
        write_notes(app, id, &p, &known, template)
    })();
    if let Err(e) = result {
        eprintln!("summary of {id} failed: {e}");
        let msg: String = format!("Could not regenerate the summary: {e}").chars().take(2000).collect();
        let _ = app.db().execute(
            "UPDATE meetings SET error = ?2, status = ?3, progress = 100, heartbeat = ?4 WHERE id = ?1",
            params![id, msg, before, db::now_iso()],
        );
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queue_order_cancel_and_no_double_run() {
        lock(&PENDING).extend(["q-a", "q-b", "q-c", "q-b"].map(String::from));
        assert_eq!((queue_position("q-a"), queue_position("q-c"), queue_position("q-z")), (Some(0), Some(2), None));
        assert!(!cancel("q-b")); // waiting: taken out of the queue, the caller fails it
        assert_eq!(queue_position("q-c"), Some(1));
        assert!(take_pending("q-a") && !take_pending("q-b") && take_pending("q-c"));
        *lock(&CURRENT) = Some("q-run".into());
        assert!(cancel("q-run") && cancelled());
        *lock(&CURRENT) = None;
        CANCEL.store(false, Ordering::Relaxed);
    }
}
