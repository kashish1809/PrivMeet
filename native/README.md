# PrivMeet's backend

One crate: `server/` (`privmeet-server`), the whole backend in one process. It answers `/api/`,
serves the built React app, and runs the pipeline on its own thread: ffmpeg, Whisper,
diarization, then the language model, one meeting at a time so only one heavy model is ever in
memory.

## Run it

```
cd native/server
cargo build --release
FRONTEND_DIST=../../frontend/dist DATA_DIR=/tmp/privmeet-rs PORT=8011 ./target/release/privmeet-server
```

Build the app first (`npm run build` in `frontend/`). Then open http://127.0.0.1:8011.

Building needs **clang** and **cmake**: whisper-rs and sherpa-rs-sys run bindgen and build
whisper.cpp and sherpa-onnx from source. Running needs **ffmpeg** on the PATH, and Ollama at
`OLLAMA_URL` unless a cloud provider is picked in Settings.

Environment variables, each with a working default: `HOST` (127.0.0.1), `PORT` (8000),
`DATA_DIR`, `MODELS_DIR`, `FRONTEND_DIST`, `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`,
`MAX_UPLOAD_MB`, `OLLAMA_URL`, and the tier overrides `TIER`, `CPU_THREADS`, `WHISPER_MODEL`,
`LLM_MODEL`, `NUM_CTX`, `BEAM_SIZE` and `DIARIZE`. The saved settings
(`DATA_DIR/settings.json`) win over all of them.

Other commands:

```
privmeet-server seed-demo [--reset]               # the mockup's demo meetings
privmeet-server import-django <db.sqlite3>        # copy an older install's meetings into this one
privmeet-server process-file <file> [--title T]   # one recording through the pipeline, no web UI
```

`import-django` reads the database of an install that ran PrivMeet's earlier Python backend. It
opens it read-only and copies the meetings (matched by id; ones already here are skipped, never
overwritten), transcripts, questions, own templates and the audio files from the `media/` folder
next to it. Columns and tables that version did not have yet are filled with blanks, so a
database from any release imports. SQLite only.

**Use a separate `DATA_DIR`** from the one being imported: the database here is
`privmeet.sqlite3`, not the old `db.sqlite3`.

## Modules

`server/src`:

- `web.rs`: the router, `FEATURES`, the Host check and the app pages.
- `csrf.rs`: the `csrftoken` cookie and the `X-CSRFToken` header `frontend/src/api.js` sends.
- `config.rs`, `settings.rs`, `hw.rs`: environment, saved settings and the hardware tier.
- `db.rs`: SQLite, the numbered migrations and the FTS5 index over the transcript.
- `api.rs`, `meetings.rs`: the meetings API, validation and the JSON shapes.
- `pipeline.rs`: the work queue, processing a meeting, answering a question, the Q&A excerpts.
- `audio.rs`: ffmpeg and ffprobe, always as list arguments, never through a shell.
- `stt.rs`: whisper.cpp through whisper-rs, the ggml download on first use, cloud transcription.
- `diarize.rs`: sherpa-rs (pyannote segmentation plus speaker embeddings).
- `names.rs`: the Whisper name hint, the spelling corrector and speaker inference.
- `llm.rs`, `providers.rs`: prompts, map-reduce, parsing and grounding; Ollama and the cloud APIs.
- `templates.rs`, `models.rs`, `export.rs`, `backup.rs`: note templates, model management, the
  export formats, and backup and restore.
- `cli.rs`: `seed-demo`, `import-django` and `process-file`.

sherpa-rs links sherpa-onnx dynamically and copies `libsherpa-onnx-c-api.so` and
`libonnxruntime.so` next to the binary; `build.rs` sets the rpath to `$ORIGIN`, so ship the three
files together. Diarization needs `segmentation.onnx` and `embedding.onnx` in `MODELS_DIR/diarize`
(or `DIARIZE_MODELS_DIR`); without them it is skipped. `scripts/download_models.sh` fetches them.

The pipeline has no feature flag of its own; `FEATURES` in `web.rs` lists only what is built, so
the app hides the rest.

## Accuracy and memory

**The English test meeting** (`Weekly product sync.mp3`, 150 s, 4 speakers, a scripted
reference), with the speakers' names in the Settings vocabulary:

| | WER | Names right | Speakers | Owners right |
|---|---|---|---|---|
| Cloud (Groq) | 3.8 % | 17 of 17 | 4 | 3 of 5 |
| whisper.cpp `base` + diarization on this machine, Groq summary | 5.8 % | 16 of 17 | 4 | 3 of 5 |

Q&A answers with `[mm:ss]` citations. Peak memory during the local run (whisper.cpp `base` and
diarization): **450–515 MB**. Afterwards it settles at **39 MB** (it was 99–124 MB before the
worker called `malloc_trim` after each job; glibc kept ~70 MB of freed heap). Of those 39 MB,
~25 MB are the code pages of `libonnxruntime.so`, sherpa-onnx and the binary. Idle before any
meeting: **6.9 MB**. Release binary: 5.0 MB.

`scripts/bench.sh` repeats the processing benchmark; the tables are in `docs/BENCHMARKS.md`.

**Unit tests:** `cargo test` covers CSRF parsing, settings validation, tiers and overrides,
migrations, FTS5 search, dates, tags and notes, date filters, prompt-output parsing, harvest and
de-duplication, grounding, citations, the text splitter, silence cleanup, speaker assignment, the
name corrector and speaker inference.

**Known shortcuts:**
- Name correction handles Latin script only.
- RAM detection is Linux only.
- After a local run the server stays at 39 MB, not its idle 6.9 MB: the ONNX and whisper code
  stays mapped. Running the pipeline in a child process would return it, if ever needed.

## History

This backend replaced a Python one (Django, Celery, Redis and Postgres) to cut memory, keeping
the same `/api/` so the React app needed no change. Measured on the same laptop and data, the
web process idles at 6.9 MB against 44 MB in development and about 150 MB in Docker, and peaks
15 % lower during a local run. `import-django` exists for installs that still hold meetings from
that version.
