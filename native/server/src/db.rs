//! The database: SQLite in DATA_DIR/privmeet.sqlite3, the tables of backend/meetings/models.py,
//! and an FTS5 index over the transcript in place of Postgres's GIN index (search.py).
//!
//! Migrations are numbered steps run once each, tracked in PRAGMA user_version.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

/// Each step moves user_version from its index to index + 1. Never edit a released step: add one.
const MIGRATIONS: &[&str] = &[
    // 1: the tables of models.py (Meeting, Segment, Question, NoteTemplate)
    r#"
    CREATE TABLE meetings (
        id            TEXT PRIMARY KEY,           -- uuid, as Django's UUIDField
        title         TEXT NOT NULL,
        file          TEXT NOT NULL DEFAULT '',   -- path under MEDIA_ROOT, as FileField.name
        duration      REAL NOT NULL DEFAULT 0,
        language      TEXT NOT NULL DEFAULT '',
        status        TEXT NOT NULL DEFAULT 'queued',
        progress      INTEGER NOT NULL DEFAULT 0,
        error         TEXT NOT NULL DEFAULT '',
        summary       TEXT NOT NULL DEFAULT '',
        decisions     TEXT NOT NULL DEFAULT '[]', -- JSON
        action_items  TEXT NOT NULL DEFAULT '[]', -- JSON
        speaker_names TEXT NOT NULL DEFAULT '{}', -- JSON {"0": "Alice"}
        notes         TEXT NOT NULL DEFAULT '',
        tags          TEXT NOT NULL DEFAULT '[]', -- JSON
        template      TEXT NOT NULL DEFAULT '',
        tier_used     TEXT NOT NULL DEFAULT '',
        device_used   TEXT NOT NULL DEFAULT '',
        created       TEXT NOT NULL,              -- ISO 8601 UTC, as Django serialises it
        heartbeat     TEXT NOT NULL
    );
    CREATE INDEX meetings_created ON meetings (created DESC);

    CREATE TABLE segments (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        meeting_id TEXT NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
        start      REAL NOT NULL,
        end        REAL NOT NULL,
        speaker    INTEGER,
        text       TEXT NOT NULL
    );
    CREATE INDEX segments_meeting ON segments (meeting_id, start);

    CREATE TABLE questions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        meeting_id TEXT NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
        question   TEXT NOT NULL,
        answer     TEXT NOT NULL DEFAULT '',
        status     TEXT NOT NULL DEFAULT 'pending',
        created    TEXT NOT NULL
    );

    CREATE TABLE note_templates (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        name         TEXT NOT NULL,
        description  TEXT NOT NULL DEFAULT '',
        instructions TEXT NOT NULL,
        created      TEXT NOT NULL
    );
    "#,
    // 2: full-text search over the transcript, kept in step with segments by triggers
    r#"
    CREATE VIRTUAL TABLE segments_fts USING fts5 (
        text, content = 'segments', content_rowid = 'id', tokenize = 'porter unicode61'
    );
    CREATE TRIGGER segments_ai AFTER INSERT ON segments BEGIN
        INSERT INTO segments_fts (rowid, text) VALUES (new.id, new.text);
    END;
    CREATE TRIGGER segments_ad AFTER DELETE ON segments BEGIN
        INSERT INTO segments_fts (segments_fts, rowid, text) VALUES ('delete', old.id, old.text);
    END;
    CREATE TRIGGER segments_au AFTER UPDATE OF text ON segments BEGIN
        INSERT INTO segments_fts (segments_fts, rowid, text) VALUES ('delete', old.id, old.text);
        INSERT INTO segments_fts (rowid, text) VALUES (new.id, new.text);
    END;
    "#,
];

/// Open (creating if needed) and bring the schema up to date.
pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;",
    )?;
    migrate(&conn)?;
    Ok(conn)
}

pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, step) in MIGRATIONS.iter().enumerate().skip(version.max(0) as usize) {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(step)?;
        tx.execute_batch(&format!("PRAGMA user_version = {}", i + 1))?;
        tx.commit()?;
    }
    Ok(())
}

/// Now as Django writes it: "2026-11-17T06:11:36.818574+00:00".
pub fn now_iso() -> String {
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    iso_from_unix(d.as_secs() as i64, d.subsec_micros())
}

pub fn iso_from_unix(secs: i64, micros: u32) -> String {
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{micros:06}+00:00",
        rem / 3600,
        rem / 60 % 60,
        rem % 60
    )
}

/// Days since 1970-01-01 to (year, month, day), proleptic Gregorian (Howard Hinnant's method).
pub fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("PRAGMA foreign_keys = ON").unwrap();
        migrate(&c).unwrap();
        c
    }

    #[test]
    fn migrates_once_and_is_idempotent() {
        let c = mem();
        migrate(&c).unwrap();
        let v: i64 = c.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v as usize, MIGRATIONS.len());
    }

    #[test]
    fn search_follows_inserts_updates_and_cascades() {
        let c = mem();
        c.execute("INSERT INTO meetings (id, title, created, heartbeat) VALUES ('m1', 'T', 'x', 'x')", []).unwrap();
        c.execute("INSERT INTO segments (meeting_id, start, end, text) VALUES ('m1', 0, 1, 'We discussed the budgets for Q4')", []).unwrap();
        let hits = |q: &str| -> i64 { c.query_row("SELECT count(*) FROM segments_fts WHERE segments_fts MATCH ?1", [q], |r| r.get(0)).unwrap() };
        assert_eq!(hits("budget"), 1); // porter stemming: budgets -> budget
        c.execute("UPDATE segments SET text = 'Marketing plan' WHERE meeting_id = 'm1'", []).unwrap();
        assert_eq!((hits("budget"), hits("marketing")), (0, 1));
        c.execute("DELETE FROM meetings WHERE id = 'm1'", []).unwrap();
        let left: i64 = c.query_row("SELECT count(*) FROM segments", [], |r| r.get(0)).unwrap();
        assert_eq!((left, hits("marketing")), (0, 0));
    }

    #[test]
    fn dates_like_django() {
        assert_eq!(iso_from_unix(0, 0), "1970-01-01T00:00:00.000000+00:00");
        // Python: datetime.fromtimestamp(1794900696.818574, timezone.utc).isoformat()
        assert_eq!(iso_from_unix(1_794_900_696, 818_574), "2026-11-17T07:31:36.818574+00:00");
        assert_eq!(civil_from_days(-1), (1969, 12, 31));
        assert_eq!(civil_from_days(11_016), (2000, 2, 29));
    }
}
