# PrivMeet

Self-hosted AI meeting notes. Upload or record a meeting and get back a transcript with
speaker labels, a summary, decisions, action items, full-text search and Q&A. Every stage
runs on your machine: no account, no cloud API, no audio leaving the box.

It is built for low-end hardware (CPU only, about 6 GB of RAM, no GPU) and uses an NVIDIA
GPU automatically when one is present.

Stack: Django + Celery, React + Tailwind, PostgreSQL, Redis, Docker, OpenAI Whisper
(faster-whisper on CTranslate2), sherpa-onnx diarization, LangChain + Ollama.

## What it does

- **Upload or record.** MP3, WAV, MP4, M4A, WebM, OGG, Opus, FLAC, MKV or MOV. The browser
  recorder captures the microphone plus the shared tab's audio, so online meetings work.
- **Transcript with speaker labels.** Whisper transcribes, sherpa-onnx separates speakers,
  and each line gets a speaker you can rename.
- **Notes.** A summary, the decisions and the action items with owner and due date when
  they were spoken.
- **Search and Q&A.** Postgres full-text search over every transcript, and questions about
  one meeting answered with `[mm:ss]` citations you can click.
- **Export.** Markdown notes and the audio file.

## Requirements

| | |
|---|---|
| Docker | Docker Engine or Docker Desktop with Compose v2 |
| RAM | 6 GB minimum. 8 GB or more gives the mid tier, an NVIDIA GPU the high tier |
| Disk | About 2 GB for the models on the first run, plus your recordings |
| CPU | Any x86-64 or arm64 CPU. AVX2 helps Whisper a lot |
| GPU | Optional. NVIDIA with a working driver and the NVIDIA Container Toolkit |
| Network | Only for the image pull and the model downloads. Nothing else |

## Quick start

```sh
cp .env.example .env
# Put a real secret in .env. The stack refuses to start without one.
python -c "import secrets; print(secrets.token_urlsafe(50))"
docker compose up -d
```

Open <http://127.0.0.1:8000>. The web container migrates the database on start, so the
first page load takes a few seconds while Postgres and Ollama come up.

`scripts/privmeet.sh` wraps the common commands (`up`, `down`, `logs`, `status`,
`update`) and adds the GPU override when `nvidia-smi` works. See
[docs/RELEASING.md](docs/RELEASING.md) for the release steps.

To stop the stack: `docker compose down`. Your data lives in the `db`, `data` and
`ollama` volumes and survives `down`; `docker compose down -v` deletes it.

### First run downloads models

The image already contains the diarization models, so nothing extra is needed for
speakers. The other two download on demand, once:

- **Whisper.** faster-whisper fetches the tier's model from Hugging Face the first time a
  meeting is transcribed (`base` is about 140 MB, `small` about 480 MB,
  `large-v3-turbo` about 1.6 GB). The meeting stays in `transcribing` until the download
  finishes; after that the model is cached in the `data` volume.
- **Ollama.** The tier's chat model is pulled by the worker on the first summary
  (`qwen2.5:1.5b` is about 1 GB, `qwen2.5:3b` about 2 GB, `qwen2.5:7b` about 4.7 GB) and
  stays in the `ollama` volume.

So the first upload on a fresh install takes several minutes even on a fast machine. To
pre-download the Ollama model while you make coffee:

```sh
docker compose exec ollama ollama pull qwen2.5:1.5b   # the low tier's model
```

Diarization models for a non-Docker run come from `scripts/download_models.sh`.

### GPU

With an NVIDIA GPU, `compose.gpu.yml` adds the device reservations and builds the worker
with the CUDA runtime:

```sh
docker compose -f compose.yml -f compose.gpu.yml up -d --build
```

Then check `curl -s http://127.0.0.1:8000/api/system/`: it should report
`"tier": "high"` and `"device": "cuda"`. Without a GPU that file is not used at all and
the stack stays on the CPU tiers.

The desktop app and `scripts/privmeet.sh up` add the override for you when `nvidia-smi`
answers.

### Desktop app

A Tauri 2 shell that starts the stack for you and opens the same UI in the system webview
(no Electron, no second browser engine). Installers, the launcher and its own notes are in
[desktop/README.md](desktop/README.md).

## Local development without Docker

Needs Python 3.12, Node 20+, `ffmpeg` on `PATH` and Ollama listening on
<http://localhost:11434> (`ollama serve`, then `ollama pull qwen2.5:1.5b`).

```sh
# backend
cd backend
uv venv -p 3.12 .venv && uv pip install -p .venv -r requirements.txt
DEBUG=1 CELERY_EAGER=1 .venv/bin/python manage.py migrate
DEBUG=1 CELERY_EAGER=1 .venv/bin/python manage.py runserver     # :8000

# frontend, in a second shell
cd frontend
npm install
npm run dev                                                     # :5173
```

On Windows the interpreter is `.venv\Scripts\python.exe` and the variables are set with
`$env:DEBUG="1"; $env:CELERY_EAGER="1"`.

- `CELERY_EAGER=1` runs the pipeline inside the web process, so neither Redis nor a worker
  is needed. It is only for development: the server must answer while the task runs.
- `DEBUG=1` allows the built-in development `SECRET_KEY`. With `DEBUG` off, settings.py
  refuses to start until a real `SECRET_KEY` is set.
- Without `POSTGRES_HOST` the app uses SQLite. Search falls back to a `LIKE` query instead
  of Postgres full-text search, so results are slower and less ranked.
- The Vite dev server proxies `/api` to :8000 and `CSRF_TRUSTED_ORIGINS` already allows
  <http://localhost:5173>.
- Voice diarization stays off until `scripts/download_models.sh` has fetched the two ONNX
  models, unless you point `DIARIZE_MODELS_DIR` at an existing copy.

There is no login in development either: the dev server binds `127.0.0.1` for the same
reason.

## Hardware tiers

`backend/meetings/hw.py` picks a tier from total RAM and CUDA availability. Nothing else
hard-codes a model name.

| Tier | Detected when | Whisper | Chat model | Diarization |
|---|---|---|---|---|
| `low` | under 8 GB RAM, no GPU | `base`, int8 CPU, beam 1 | `qwen2.5:1.5b`, num_ctx 4096 | off (opt in) |
| `mid` | 8 GB or more, no GPU | `small`, int8 CPU, beam 5 | `qwen2.5:3b`, num_ctx 8192 | on |
| `high` | NVIDIA GPU present | `large-v3-turbo`, float16 CUDA | `qwen2.5:7b`, num_ctx 8192 | on |

The worker writes the tier it detected to the `data` volume, and `GET /api/system/` serves
it, so the UI and the API always agree even when the web container cannot see the GPU.

## Configuration

Everything comes from environment variables, so the same image runs on every tier. Compose
reads them from `.env`; the full annotated list is [.env.example](.env.example).

| Variable | Default | What it does |
|---|---|---|
| `SECRET_KEY` | none, required | Django key. Compose refuses to start without it, and settings.py rejects the built-in key when `DEBUG` is off |
| `DEBUG` | `0` | `1` turns on Django debug pages and allows the development key. Never in Docker |
| `ALLOWED_HOSTS` | `localhost,127.0.0.1` | Host headers Django answers for |
| `CSRF_TRUSTED_ORIGINS` | `127.0.0.1:8000,localhost:8000` in compose, `http://localhost:5173` otherwise | Origins allowed to POST/PATCH/DELETE with the CSRF cookie |
| `MAX_UPLOAD_MB` | `2048` | Upload size cap |
| `TIER` | empty = auto | `low`, `mid` or `high`. Forcing `high` without a GPU falls back to CPU |
| `CPU_THREADS` | half the cores | Whisper threads |
| `WHISPER_MODEL` | tier default | Any faster-whisper size: `tiny`, `base`, `small`, `medium`, `large-v3-turbo` |
| `LLM_MODEL` | tier default | Any Ollama model name |
| `NUM_CTX` | tier default | Ollama context window. Long meetings are chunked to fit it |
| `BEAM_SIZE` | tier default | Whisper beam size. Higher is slower and slightly better |
| `DIARIZE` | tier default | `1` or `0` |
| `OLLAMA_URL` | `http://ollama:11434` | Chat model server. `http://localhost:11434` for a local run |
| `POSTGRES_HOST` and friends | `db` in compose, empty locally | Empty means SQLite |
| `DATA_DIR` | `backend/data` | Uploads, the database file and the worker profile |
| `REDIS_URL` | `redis://redis:6379/0` | Celery broker |
| `CELERY_EAGER` | empty | `1` runs tasks inline. Development only |
| `DB_MEM`, `REDIS_MEM`, `WEB_MEM`, `WORKER_MEM`, `OLLAMA_MEM` | `256m`, `64m`, `1g`, `4g`, `4g` | Compose `mem_limit` per service. Lower them on a 6 GB box |
| `PRIVMEET_VERSION` | `latest` | Image tag to pull. Pin it for a reproducible install |

## Troubleshooting

**`SECRET_KEY` is required when DEBUG is off.** Copy `.env.example` to `.env` and paste a
generated key. For a local run without Docker, set `DEBUG=1` instead.

**`port is already allocated` on 8000.** Something else holds the port. Free it, or change
the published port in `compose.yml` (keep the `127.0.0.1:` prefix).

**A meeting stays `queued`.** The worker is not running or cannot reach Redis:
`docker compose ps` and `docker compose logs worker`. With `CELERY_EAGER=1` outside Docker
the task runs in the request, so the page waits instead.

**A meeting fails with "No audio stream found".** The file has video but no audio track, or
the container is DRM-protected. Check with `ffprobe <file>`. A screen recording with the
system audio muted fails the same way.

**A meeting fails while summarizing.** Ollama could not pull or load the model. Check
`docker compose logs ollama` and that the disk has room. A machine with 6 GB of RAM should
leave `OLLAMA_MEM` at `4g` and use the low tier.

**Long meetings fail on a small machine.** Lower `WORKER_MEM`/`OLLAMA_MEM` is not the fix:
the models need the room. Force `TIER=low` so Whisper `base` and `qwen2.5:1.5b` are used,
and close other applications.

**The GPU is not used.** `curl -s http://127.0.0.1:8000/api/system/` shows the tier and
device. If it says `cpu`, the stack was started without `compose.gpu.yml`, `nvidia-smi`
fails on the host, or the NVIDIA Container Toolkit is missing. `docker run --rm
--gpus all nvidia/cuda:12.4.0-base-ubuntu22.04 nvidia-smi` proves the toolkit works.

**The first transcription takes minutes.** That is the Whisper download, once per model.
The same for the first summary and the Ollama pull. Both are cached in volumes.

**Text is not searchable outside Postgres.** Expected: SQLite has no full-text search and
`search.py` falls back to `LIKE`. Use the Docker stack for real search.

## Security

**There is no login.** PrivMeet is a single-user app for one machine. The stack publishes
`127.0.0.1:8000` only, so it is not reachable from the network.

- Do not change that to `0.0.0.0:8000` or put it behind a port forward or a tunnel. Anyone
  who reaches the port can read, change and delete every meeting.
- Keep `DEBUG=0` outside local development, and always set a real `SECRET_KEY`.
- Uploads are checked for extension, size and a real audio stream, and stored under
  random names. Media is served only through the API.
- The app makes no outbound request except the image pull and the model downloads.

See [SECURITY.md](SECURITY.md) for how to report a problem.

## Docs

- [docs/PLAN.md](docs/PLAN.md): design, resource strategy and milestones
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): component diagram, pipeline, data model
- [docs/RELEASING.md](docs/RELEASING.md): how a release is cut and packaged
- [docs/TASKS.md](docs/TASKS.md): the team's task split
- [desktop/README.md](desktop/README.md): the desktop app and its launcher
- [CONTRIBUTING.md](CONTRIBUTING.md), [AUTHORS.md](AUTHORS.md), [CHANGELOG.md](CHANGELOG.md)

MIT licensed. See [LICENSE](LICENSE).
