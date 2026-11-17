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
| 3 | Meetings: upload, list and search, detail, edit, delete, audio with Range, retry, tags, action items, ask | done |
| 4 | Pipeline: ffmpeg, whisper.cpp or cloud transcription, names, diarization, summary, Q&A | **code written, not yet run end to end** |
| 5 | Template, models and export endpoints, settings test, demo data, import from Django | |
| 6 | Measure against Python, side-by-side tests, then hand-over to the desktop app | |

### Where stage 4 stands (resume here)

The code is ported and builds, and `cargo test` passes (25 tests). It has not processed a real meeting yet.

**Modules:**
- `providers.rs`: Ollama `/api/chat` and the cloud chat and transcription APIs.
- `llm.rs`: prompts, map-reduce, parsing, de-duplication, grounding, the summary check and citations.
- `stt.rs`: whisper.cpp, downloading the ggml model on first use, and cloud transcription in chunks.
- `diarize.rs`: sherpa-rs.
- `names.rs`: the name hint, the corrector, and speaker inference.
- `templates.rs`
- `pipeline.rs`: the worker, `process_meeting`, `answer_question` and the Q&A excerpts.

**Next steps, in order:**
1. **Fix the runtime library.** `./target/release/privmeet-server` stops at start-up with
   `error while loading shared libraries: libsherpa-onnx-c-api.so`: sherpa-rs links sherpa-onnx
   dynamically. Try sherpa-rs's static feature, or set an rpath to the downloaded library folder.
2. **Run the English test meeting through the Rust server.** It is
   `scratchpad/sim/Weekly product sync.mp3` from the session that made it; regenerate it if
   that is gone. Run it twice:
   - cloud mode (Groq transcription and summary);
   - whisper.cpp `base` with diarization on this machine.

   Compare against the Python result: WER 3.8 %, every name right (17 of 17), 4 speakers,
   3 of 5 owners right.
3. **Measure peak memory** during a local run, then add the stage 4 flags to `FEATURES`.
4. **Known shortcuts:**
   - Whisper progress is reported only when transcription ends.
   - sherpa-rs ignores `cpu_threads`.
   - Name correction handles Latin script only.
   - RAM detection is Linux only.

`FEATURES` in `server/src/web.rs` lists only what is built, so the app hides the rest.

## Checked so far

- **Unit tests:** `cargo test` runs 25 of them, covering CSRF parsing, settings validation (Django's
  messages, word for word), tiers and overrides, migrations, FTS5 search, dates, tags and notes,
  dates in filters, prompt-output parsing, harvest and de-duplication, grounding, citations, the
  text splitter, silence cleanup, speaker assignment, the name corrector (difflib's ratio,
  exactly) and speaker inference.
- **Against Django on the same `settings.json`:** `/api/system/` is identical apart from the
  feature list, and `GET /api/settings/` is identical.
- **Memory:**

| | Django | Rust |
|---|---|---|
| Web server, idle after serving the app and the API | 44 MB (dev, 1 process); about 150 MB in Docker (gunicorn, 3 processes) | **6.9 MB** |
| Release binary | n/a | 5.0 MB |
