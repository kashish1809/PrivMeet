# PrivMeet tech stack

The backend moved from Django + Celery to one Rust binary. The React app, the desktop app and
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

Measured one at a time on the same 5.7 GB laptop and data ([BENCHMARKS.md](BENCHMARKS.md)):

| | Django stack | Rust |
|---|---|---|
| Idle, production setup | 263 MB RSS / 170 MB PSS (gunicorn + Celery worker, 5 processes), plus Postgres and Redis | **20 MB RSS / 11 MB PSS**, 1 process |
| Peak, local run (Whisper `base` + diarization, 150 s meeting) | 543–564 MB | **441–488 MB** |
| Idle after 3 meetings | 31 MB (web process; jobs ran in a child) | 39 MB |
| Wall time, same run | **50–51 s** | 104–113 s (task R1.22) |
| Processes to run | web, worker, Redis, Postgres, Ollama | **server** + Ollama |
| Transcript quality, cloud | WER 3.8 %, 17/17 names, 4 speakers | WER 3.8 %, 17/17 names, 4 speakers |
| API | | the same 68 parity requests answer identically |

## Shipping

- One release binary, `privmeet-server` (5.0 MB), plus `libsherpa-onnx-c-api.so` and
  `libonnxruntime.so` in the same folder (the binary's rpath is `$ORIGIN`).
- Runtime needs: `ffmpeg` / `ffprobe` on the PATH; Ollama for local summaries; the diarization
  models (`segmentation.onnx`, `embedding.onnx`) in `MODELS_DIR/diarize`.
- Same environment variables as Django: `HOST`, `PORT`, `DATA_DIR`, `MODELS_DIR`,
  `FRONTEND_DIST`, `OLLAMA_URL`, `MAX_UPLOAD_MB`, and the tier overrides.
