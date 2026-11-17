# PrivMeet tech stack (Rust backend, `rust/migration`)

The backend moves from Django + Celery to one Rust binary. The React app, the desktop app and
the API stay the same, so nothing above the backend changes.

## At a glance

| Layer | Before (Python) | Now (Rust) |
|---|---|---|
| HTTP server | Django 5 views, gunicorn (3 processes) | **axum 0.8** on **tokio**, one process |
| Static files (the React build) | Django / WhiteNoise | **tower-http** `ServeDir` |
| Database | PostgreSQL 17 (Docker) or SQLite (dev) | **SQLite** via **rusqlite** (bundled) |
| Search | PostgreSQL full-text (GIN index) | **SQLite FTS5** |
| Background jobs | Celery worker + Redis | **one pipeline thread** with a channel queue |
| Audio decoding | ffmpeg / ffprobe (subprocess) | ffmpeg / ffprobe (subprocess, list args) |
| Speech to text, local | faster-whisper (CTranslate2) | **whisper.cpp** via **whisper-rs 0.16** |
| Speech to text, cloud | Groq / OpenAI transcription API | same APIs via **reqwest** |
| Speaker diarization | sherpa-onnx (Python) | **sherpa-onnx** via **sherpa-rs 0.6** (same ONNX models) |
| Summary, action items, Q&A | LangChain + Ollama or cloud LLM | direct HTTP to **Ollama** `/api/chat` or the cloud API via **reqwest** |
| JSON | Django `JsonResponse` | **serde** / **serde_json** |
| Settings | `settings.json` in `DATA_DIR` | the same file, same keys and validation messages |

## Rust crates (`native/server/Cargo.toml`)

| Crate | Use |
|---|---|
| `axum` (+ `multipart`) | router, handlers, uploads |
| `tokio` | async runtime, signals, file I/O |
| `tower-http` (`fs`) | serving the built React app |
| `tokio-util` (`io`) | streaming audio with Range requests |
| `rusqlite` (`bundled`) | SQLite + FTS5, no system library needed |
| `reqwest` (`blocking`, `json`, `multipart`, `rustls`) | Ollama and cloud LLM / transcription calls |
| `serde`, `serde_json` | API and settings JSON |
| `whisper-rs` | whisper.cpp bindings, ggml models downloaded on first use |
| `sherpa-rs` | speaker diarization (pyannote segmentation + speaker embeddings, ONNX) |
| `regex` | prompt-output parsing, name and date handling |
| `uuid` (`v4`) | meeting ids |
| `tempfile` | temporary WAV files |

Feature `cuda`: builds whisper.cpp with CUDA; without it the server uses the CPU.

## Unchanged

| Part | Stack |
|---|---|
| Web app | React 19, Vite 8, Tailwind CSS 4, `lucide-react` icons; plain JSX, hash routes |
| Desktop app | Tauri 2 (system webview), `tauri-plugin-opener`, `tauri-plugin-single-instance`; plain HTML/JS launcher |
| Local LLM | Ollama (`qwen2.5` models by hardware tier) |
| API | the same `/api/` paths, JSON shapes, CSRF cookie and feature flags as Django |

## Removed with the Rust backend

- Python, Django, gunicorn
- Celery and Redis (the queue is in-process)
- PostgreSQL (SQLite with FTS5 covers search for a single-user local app)
- LangChain (plain HTTP calls)
- faster-whisper / CTranslate2 (whisper.cpp instead)

## Why

| | Python stack | Rust |
|---|---|---|
| Web server, idle | 44–48 MB (dev); ~150 MB in Docker | **6.9 MB** |
| Idle after meetings | 58 MB | **39 MB** |
| Peak, local run (whisper `base` + diarization) | ~1.6 GB (whole Docker stack) | **450–515 MB** |
| Processes to run | web, worker, Redis, Postgres, Ollama | **server** + Ollama |
| Transcript quality, cloud (test meeting) | WER 3.8 %, 17/17 names | WER 3.8 %, 17/17 names |

The Python peak covers the whole Docker stack and the Rust peak one process; the like-for-like
comparison is stage 6 in `native/README.md`.

## Shipping

- One release binary, `privmeet-server` (5.0 MB), plus `libsherpa-onnx-c-api.so` and
  `libonnxruntime.so` in the same folder (the binary's rpath is `$ORIGIN`).
- Runtime needs: `ffmpeg` / `ffprobe` on the PATH; Ollama for local summaries; the diarization
  models (`segmentation.onnx`, `embedding.onnx`) in `MODELS_DIR/diarize`.
- Same environment variables as Django: `HOST`, `PORT`, `DATA_DIR`, `MODELS_DIR`,
  `FRONTEND_DIST`, `OLLAMA_URL`, `MAX_UPLOAD_MB`, and the tier overrides.
