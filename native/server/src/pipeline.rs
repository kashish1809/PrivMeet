//! The work queue: one job at a time on one worker thread, as the Celery worker runs with
//! concurrency 1 (only one heavy model in memory). Jobs: process a meeting, answer a question.

use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex, OnceLock};

use crate::meetings as mt;
use crate::web::{App, AppState};

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
                [crate::db::now_iso()],
            )
            .unwrap_or(0);
        if n > 0 {
            eprintln!("freed {n} meeting(s) left processing by the previous run");
        }
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

// shortcut: stage 3 stops here; stage 4 of rust/migration runs the real pipeline.
fn process_meeting(app: &App, id: &str) {
    let db = app.db();
    let _ = db.execute(
        "UPDATE meetings SET status = 'failed', error = 'Processing is not built into the Rust server yet.' WHERE id = ?1",
        [id],
    );
}

fn answer_question(app: &App, id: i64) {
    let db = app.db();
    let _ = db.execute(
        "UPDATE questions SET status = 'failed', answer = 'Error: Q&A is not built into the Rust server yet.' WHERE id = ?1",
        [id],
    );
}
