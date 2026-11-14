# PrivMeet

Self-hosted AI meeting notes. Upload or record a meeting and get back a transcript with speaker labels, a summary, decisions, action items, search across all meetings, and Q&A with `[mm:ss]` citations. **Everything runs on your own machine**: the audio never leaves it, and by default neither does the text.

- Runs on a low-end laptop (CPU only, about 6 GB RAM) and uses an NVIDIA GPU when there is one.
- Records straight from the browser, including the audio of a Meet, Zoom or Teams tab.
- Four themes (Indigo, Teal, Amber, Slate), a pixel or a normal font, a desktop app for Windows and Linux.

**Stack:**
- Backend: Django + Celery, PostgreSQL, Redis.
- AI: OpenAI Whisper via faster-whisper (no PyTorch), sherpa-onnx speaker diarization, LangChain + Ollama.
- Frontend: React + Tailwind. Desktop: Tauri.
- Runs in Docker Compose.

> ⚠️ **There is no login.** PrivMeet is single-user and trusts whoever can reach it. Compose publishes the app on `127.0.0.1:8000` only. **Do not expose that port to your network or the internet** (no `0.0.0.0`, no port forwarding, no public reverse proxy) unless you put your own authentication in front of it. See [SECURITY.md](SECURITY.md).

## Requirements

| | Minimum | Better |
|---|---|---|
| OS | Linux, Windows 10/11 or macOS with Docker | |
| RAM | 6 GB (low tier) | 8 GB+ (mid tier: speaker labels, a 3B model) |
| CPU | 4 threads | 8+ threads |
| GPU | none | NVIDIA with 4 GB+ VRAM and the NVIDIA Container Toolkit |
| Disk | ~6 GB free (images and models) | more for long recordings |
| Software | [Docker](https://docs.docker.com/get-docker/) with Compose v2 | |

## Quick start (Docker)

```bash
git clone https://github.com/kashish1809/PrivMeet.git
cd PrivMeet
cp .env.example .env
# put a long random value in SECRET_KEY, e.g. the output of:
python -c "import secrets; print(secrets.token_urlsafe(50))"
docker compose up -d
```

Open **http://127.0.0.1:8000**.

The launcher scripts do the same in one step. They create `.env` with a random `SECRET_KEY`, add the GPU override when an NVIDIA GPU answers, wait for the server and open the browser:

```bash
scripts/privmeet.sh up          # Linux / macOS: up | down | logs | update | status
.\scripts\privmeet.ps1 up       # Windows PowerShell, same commands
```

Prefer an app? Install the desktop app from the [releases](https://github.com/kashish1809/PrivMeet/releases) (`.exe`/`.msi` for Windows, `.deb`/`.AppImage` for Linux). It starts and stops the Docker stack for you.

### The first run downloads models
The first start pulls the Docker images, and the first meeting downloads its models, **about 2 GB in total on the low tier**:
- the Whisper model for your tier, into the `data` volume
- the Ollama LLM, into the `ollama` volume

The speaker-diarization models (~35 MB) are already in the image.

The first meeting therefore takes longer than the rest. Later meetings start at once, and the models survive `docker compose down`. `docker compose down -v` deletes the volumes, and with them your meetings and models.

To fetch the LLM before the first meeting:
```bash
docker compose exec ollama ollama pull qwen2.5:1.5b    # the low tier's model; see the tier table
```

## Using an NVIDIA GPU
1. Install the NVIDIA driver and the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html).
2. Check that it works: `docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi`.
3. Start with the GPU override:
   ```bash
   docker compose -f compose.yml -f compose.gpu.yml up -d
   ```
   The launcher scripts and the desktop app add it on their own when `nvidia-smi` works.

The worker (Whisper) and Ollama get the GPU, and the tier becomes `high`. Check it at http://127.0.0.1:8000/api/system/ (`"device": "cuda"`).

On a GPU with less than 6 GB of VRAM, the LLM drops to the 3B model so it fits whole in VRAM. If CUDA fails at run time (missing libraries, out of memory), transcription logs the error and **finishes on the CPU**: a broken GPU costs speed, not the meeting.

## Hardware tiers
`backend/meetings/hw.py` picks a tier from the RAM and the GPU when the worker starts:

| Tier | When | Whisper | LLM (Ollama) | Speakers | 10 min of audio* |
|---|---|---|---|---|---|
| `low` | < 7.5 GB RAM, no GPU | `base`, int8, CPU | `qwen2.5:1.5b`, 4k context | off | ~45 s |
| `mid` | ≥ 7.5 GB RAM, no GPU | `small`, int8, CPU | `qwen2.5:3b`, 8k context | on | ~2.5 min |
| `high` | NVIDIA GPU | `large-v3-turbo`, int8_float16, CUDA | `qwen2.5:7b` (`3b` under 6 GB VRAM) | on | ~2 min on a 4 GB GTX 1650 |

\* Measured on a Ryzen 5 5600; see [docs/BENCHMARKS.md](docs/BENCHMARKS.md). Run `scripts/bench.py <audio>` on your own machine.

Only one heavy model is in memory at a time. The worker runs one job at a time, runs ffmpeg, Whisper, diarization and the LLM one after another, and restarts after each job, so the memory goes back to the system.

## Settings and overrides
Most things can be changed in the app under **Settings**:
- **General:** your name and the default recording title.
- **AI Model:** the Ollama server and model, context length, CPU threads and speaker detection.
- **Recording:** the default microphone, tab audio and camera.
- **Appearance:** theme and font.

A model picked there is used from the next meeting on, with no restart.

**Cloud models (optional).** The AI Model tab can also send the notes to **OpenAI, OpenRouter, Anthropic** or any OpenAI-compatible server with your own API key.
- Only the transcript *text* is sent, for the summary and Q&A.
- Audio, transcription and speaker detection always stay local.
- The app warns you before switching, and Ollama stays the default.

**Environment variables.** The same knobs exist as variables in `.env` (see [.env.example](.env.example)). The Settings page wins over them.

| Variable | Default | What it does |
|---|---|---|
| `SECRET_KEY` | (required) | Django secret; the app refuses to start without one unless `DEBUG=1` |
| `TIER` | auto | force `low`, `mid` or `high` |
| `WHISPER_MODEL`, `LLM_MODEL` | tier | e.g. `small`, `qwen2.5:3b` |
| `NUM_CTX`, `BEAM_SIZE` | tier | LLM context length, Whisper beam size |
| `DIARIZE` | tier | `1` or `0` for speaker labels |
| `CPU_THREADS` | half the cores | threads for Whisper and the local LLM |
| `MAX_UPLOAD_MB` | 2048 | largest upload |
| `WORKER_MEM`, `OLLAMA_MEM`, `WEB_MEM`, `DB_MEM`, `REDIS_MEM` | 4g, 4g, 1g, 256m, 64m | container memory limits |
| `PRIVMEET_VERSION` | latest | pin the image version, e.g. `0.1.0` |

## Running locally without Docker (development)
You need Python 3.12, [uv](https://docs.astral.sh/uv/), Node 20+, ffmpeg on `PATH` and [Ollama](https://ollama.com) on `localhost:11434`.

```bash
# backend
cd backend
uv venv -p 3.12 .venv && uv pip install -p .venv -r requirements.txt
export DEBUG=1 CELERY_EAGER=1          # Windows PowerShell: $env:DEBUG=1; $env:CELERY_EAGER=1
.venv/bin/python manage.py migrate      # Windows: .venv\Scripts\python
.venv/bin/python manage.py runserver    # http://127.0.0.1:8000/api/

# frontend, in a second terminal
cd frontend
npm install
npm run dev                             # http://localhost:5173, proxies /api to :8000
```

- `CELERY_EAGER=1` runs the jobs inside the web process, so you need no Redis and no worker.
- Without `POSTGRES_HOST` the app uses SQLite.
- `scripts/download_models.sh` fetches the speaker-diarization models.
- `python manage.py process_file meeting.mp3` runs the whole pipeline on one file from the command line.
- The API is described in [docs/API.md](docs/API.md), and the design in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
