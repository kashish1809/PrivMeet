# PrivMeet in Rust (`rust/migration`)

PrivMeet's backend: ported from Django to Rust to cut memory. The Rust server answers the same
`/api/` as Django did, so the React app works unchanged, and it serves the built app itself.
The Django backend is removed; `import-django` copies an old install's meetings.

| Crate | What |
|---|---|
| `server/` (`privmeet-server`) | the HTTP server: the React app, CSRF, settings, hardware profile, SQLite |
| `transcribe/` (`privmeet-transcribe`) | a standalone whisper.cpp test tool; the server's `stt.rs` replaced it in stage 4 |

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
`db.sqlite3`. `settings.json` is shared and readable by both.

Other commands:

```
privmeet-server seed-demo [--reset]           # the mockup's demo meetings, as manage.py seed_demo
privmeet-server import-django <db.sqlite3>    # copy a Django install's meetings into this one
```

`import-django` opens Django's database read-only and copies the meetings (by id; ones already
here are skipped, never overwritten), transcripts, questions, own templates and the audio files
from the `media/` folder next to it. Only SQLite installs; a Postgres one is not supported yet.

## Stages

| Stage | What | State |
|---|---|---|
| 1 | Server core: router, Host check, the React app under `/static/`, CSRF | done |
| 2 | SQLite and FTS5 schema, settings store, hardware tiers; `/api/system/`, `/api/settings/` | done |
| 3 | Meetings: upload, list and search, detail, edit, delete, audio with Range, retry, tags, action items, ask | done |
| 4 | Pipeline: ffmpeg, whisper.cpp or cloud transcription, names, diarization, summary, Q&A | done |
| 5 | Template, models and export endpoints, settings test, demo data, import from Django | done |
| 6 | Measure against Python, side-by-side tests, then hand-over to Docker and the desktop app | done |

### Stage 6 (done)

- Measured against Django one at a time on the same laptop and data: the Rust server idles at
  20 MB against 263 MB for gunicorn + the Celery worker, and peaks 15 % lower during a local
  run, but takes about twice as long (task R1.22). Full tables: `docs/BENCHMARKS.md`.
- Parity: with Django's database imported, 68 requests (list, search, filters, every detail and
  export) and 32 more (templates, models, Test Connection) answer as Django did.
- Docker runs it as `web` beside `ollama` (`Dockerfile`, `compose.yml`); the desktop app needed no
  change, since it starts the same compose file and waits for the same `/api/system/`.
- `scripts/bench.sh` repeats the processing benchmark.

### Stage 5 (done)

- `export.rs`: Markdown, plain text, JSON, SRT, VTT, the share page, Word, OpenDocument and
  calendar (.ics) exports, and the audio as MP3 or Opus. The Office files are zips written by
  hand (stored entries, CRC32), so no zip crate.
- `templates.rs`: `/api/templates/` CRUD next to the built-ins.
- `models.rs`: `/api/models/`, model downloads (queued on the pipeline thread, like Celery),
  model delete and `/api/settings/test`.
- `cli.rs`: `seed-demo` and `import-django`; `demo.json` is the demo content, exported once from
  `seed_demo.py`.

`FEATURES` now lists the same twelve flags as Django.

### Stage 4 (done)

**Modules:**
- `providers.rs`: Ollama `/api/chat` and the cloud chat and transcription APIs.
- `llm.rs`: prompts, map-reduce, parsing, de-duplication, grounding, the summary check and citations.
- `stt.rs`: whisper.cpp, downloading the ggml model on first use, and cloud transcription in chunks.
- `diarize.rs`: sherpa-rs.
- `names.rs`: the name hint, the corrector, and speaker inference.
- `templates.rs`
- `pipeline.rs`: the worker, `process_meeting`, `answer_question` and the Q&A excerpts.

sherpa-rs links sherpa-onnx dynamically and copies `libsherpa-onnx-c-api.so` and
`libonnxruntime.so` next to the binary; `build.rs` sets the rpath to `$ORIGIN`, so ship the
three files together. Like Django, diarization needs `segmentation.onnx` and `embedding.onnx`
in `MODELS_DIR/diarize` (or `DIARIZE_MODELS_DIR`); without them it is skipped.

**The English test meeting** (`Weekly product sync.mp3`, 150 s, 4 speakers, a scripted
reference), with the speakers' names in the Settings vocabulary:

| | WER | Names right | Speakers | Owners right |
|---|---|---|---|---|
| Python, cloud (Groq) | 3.8 % | 17 of 17 | 4 | 3 of 5 |
| Rust, cloud (Groq) | 3.8 % | 17 of 17 | 4 | 3 of 5 |
| Rust, whisper.cpp `base` + diarization on this machine, Groq summary | 5.8 % | 16 of 17 | 4 | 3 of 5 |

Q&A answers with `[mm:ss]` citations. Peak memory of the whole server during the local run
(whisper.cpp `base` and diarization): **450–515 MB**. Afterwards it settles at **39 MB**
(it was 99–124 MB before the worker called `malloc_trim` after each job; glibc kept ~70 MB of freed
heap). Of those 39 MB, ~25 MB are the code pages of `libonnxruntime.so`, sherpa-onnx and the binary.

The pipeline adds no feature flag (Django's list has none for it); `FEATURES` in
`server/src/web.rs` still lists only what is built, so the app hides the rest.

**Known shortcuts:**
- sherpa-rs ignores `cpu_threads`.
- Name correction handles Latin script only.
- RAM detection is Linux only.
- After a local run the server stays at 39 MB, not its idle 7 MB: the ONNX and whisper code
  stays mapped. Running the pipeline in a child process would return it, if ever needed.

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
