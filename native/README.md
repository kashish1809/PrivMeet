# PrivMeet in Rust (`rust/migration`)

The backend is being ported from Django to Rust to cut memory. The Rust server answers the
same `/api/` as Django, so the React app works unchanged, and it serves the built app itself.
While the port is in progress, the Django backend stays the one in use.

| Crate | What |
|---|---|
| `server/` (`privmeet-server`) | the HTTP server: the React app, CSRF, settings, hardware profile, SQLite |
| `transcribe/` (`privmeet-transcribe`) | speech to text with whisper.cpp; becomes a module of the server in stage 4 |

## Run it

```
cd native/server
cargo build --release
FRONTEND_DIST=../../frontend/dist DATA_DIR=/tmp/privmeet-rs PORT=8011 ./target/release/privmeet-server
```

Build the app first (`npm run build` in `frontend/`). Then open http://127.0.0.1:8011.

The environment variables are Django's, with the same defaults:
`HOST` (127.0.0.1), `PORT` (8000), `DATA_DIR`, `MODELS_DIR`, `FRONTEND_DIST`, `ALLOWED_HOSTS`,
`CSRF_TRUSTED_ORIGINS`, `MAX_UPLOAD_MB`, `OLLAMA_URL`, and the tier overrides `TIER`,
`CPU_THREADS`, `WHISPER_MODEL`, `LLM_MODEL`, `NUM_CTX`, `BEAM_SIZE` and `DIARIZE`.

**Use a separate `DATA_DIR`.** The Rust database (`privmeet.sqlite3`) is not Django's
`db.sqlite3`; importing an existing install's meetings comes later. `settings.json` is shared
and readable by both.

## Stages

| Stage | What | State |
|---|---|---|
| 1 | Server core: router, Host check, the React app under `/static/`, CSRF | done |
| 2 | SQLite and FTS5 schema, settings store, hardware tiers; `/api/system/`, `/api/settings/` | done |
| 3 | Meetings: upload, list and search, detail, edit, delete, audio with Range | next |
| 4 | Pipeline: ffmpeg, whisper.cpp or cloud transcription, names, diarization, summary, Q&A | |
| 5 | Templates, tags, action items, models, exports, settings test, demo data, import from Django | |
| 6 | Measure against Python, side-by-side tests, then hand-over to the desktop app | |

`FEATURES` in `server/src/web.rs` lists only what is built, so the app hides the rest.

## Checked so far

- **Unit tests:** `cargo test` runs 13 of them, covering CSRF parsing, settings validation (Django's
  messages, word for word), tiers and overrides, migrations, FTS5 search and dates.
- **Against Django on the same `settings.json`:** `/api/system/` is identical apart from the
  feature list, and `GET /api/settings/` is identical.
- **Memory:**

| | Django | Rust |
|---|---|---|
| Web server, idle after serving the app and the API | 44 MB (dev, 1 process); about 150 MB in Docker (gunicorn, 3 processes) | **6.9 MB** |
| Release binary | n/a | 5.0 MB |
