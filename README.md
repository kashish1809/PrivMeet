# PrivMeet

Self-hosted AI meeting notes. Upload or record a meeting and get back a transcript with speaker labels, a summary, decisions, action items, search across all meetings, and Q&A with `[mm:ss]` citations. **Everything runs on your own machine**: the audio never leaves it, and by default neither does the text.

- Runs on a low-end laptop (CPU only, about 6 GB RAM) and uses an NVIDIA GPU when there is one.
- Records straight from the browser, including the audio of a Meet, Zoom or Teams tab.
- Four themes (Indigo, Teal, Amber, Slate), a pixel or a normal font, a desktop app for Windows and Linux.

**Stack:**
- Backend: one Rust binary (axum, SQLite with FTS5) that serves the API and the web app and runs the pipeline. See [docs/TECH_STACK.md](docs/TECH_STACK.md).
- AI: OpenAI Whisper via whisper.cpp, sherpa-onnx speaker diarization, Ollama (or an opt-in cloud provider).
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
docker compose up -d                    # .env is optional; see .env.example
```

Open **http://127.0.0.1:8000**.

The launcher scripts do the same in one step. They add the GPU override when an NVIDIA GPU answers, wait for the server and open the browser:

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

The server (Whisper) and Ollama get the GPU, and the tier becomes `high`. Check it at http://127.0.0.1:8000/api/system/ (`"device": "cuda"`).

On a GPU with less than 6 GB of VRAM, the LLM drops to the 3B model so it fits whole in VRAM. Without a working driver the server reports `"device": "cpu"` and runs Whisper on the CPU.

## Hardware tiers
`native/server/src/hw.rs` picks a tier from the RAM and the GPU when the server starts:

| Tier | When | Whisper | LLM (Ollama) | Speakers | 10 min of audio* |
|---|---|---|---|---|---|
| `low` | < 7.5 GB RAM, no GPU | `base`, CPU | `qwen2.5:1.5b`, 4k context | off | ~45 s |
| `mid` | ≥ 7.5 GB RAM, no GPU | `small`, CPU | `qwen2.5:3b`, 8k context | on | ~2.5 min |
| `high` | NVIDIA GPU | `large-v3-turbo`, CUDA | `qwen2.5:7b` (`3b` under 6 GB VRAM) | on | ~2 min on a 4 GB GTX 1650 |

\* Measured with the earlier Python backend on a Ryzen 5 5600; the Rust pipeline is about twice as slow today (task R1.22). See [docs/BENCHMARKS.md](docs/BENCHMARKS.md).

Only one heavy model is in memory at a time. The server runs one job at a time, runs ffmpeg, Whisper, diarization and the LLM one after another, and hands the freed memory back to the system after each job.

## Settings and overrides
Most things can be changed in the app under **Settings**:
- **General:** your name and the default recording title.
- **AI Model:** the Ollama server and model, context length, CPU threads and speaker detection.
- **Recording:** the default microphone, tab audio and camera.
- **Appearance:** theme and font.

A model picked there is used from the next meeting on, with no restart.

**Cloud models (optional).** The AI Model tab can also send the notes to **OpenAI, OpenRouter, Anthropic** or any OpenAI-compatible server with your own API key.
- Only the transcript *text* is sent, for the summary and Q&A.
- Audio and speaker detection stay local. Transcription does too, unless you also turn on cloud transcription (Groq, OpenAI or a compatible server).
- The app warns you before switching, and Ollama stays the default.

**Environment variables.** The same knobs exist as variables in `.env` (see [.env.example](.env.example)). The Settings page wins over them.

| Variable | Default | What it does |
|---|---|---|
| `TIER` | auto | force `low`, `mid` or `high` |
| `WHISPER_MODEL`, `LLM_MODEL` | tier | e.g. `small`, `qwen2.5:3b` |
| `NUM_CTX`, `BEAM_SIZE` | tier | LLM context length, Whisper beam size |
| `DIARIZE` | tier | `1` or `0` for speaker labels |
| `CPU_THREADS` | half the cores | threads for Whisper and the local LLM |
| `MAX_UPLOAD_MB` | 2048 | largest upload |
| `WEB_MEM`, `OLLAMA_MEM` | 4g, 4g | container memory limits |
| `PRIVMEET_VERSION` | latest | pin the image version, e.g. `0.1.0` |

## Running locally without Docker (development)
You need [Rust](https://rustup.rs) with clang and cmake, Node 20+, ffmpeg on `PATH` and [Ollama](https://ollama.com) on `localhost:11434`.

```bash
# server
cd native/server
cargo build --release
./target/release/privmeet-server        # http://127.0.0.1:8000/api/

# frontend, in a second terminal
cd frontend
npm install
npm run dev                             # http://localhost:5173, proxies /api to :8000
```

- One process and a SQLite file in `DATA_DIR` (default `native/server/data`): no Redis, worker or Postgres.
- `scripts/download_models.sh` fetches the speaker-diarization models; point `DIARIZE_MODELS_DIR` (or `MODELS_DIR/diarize`) at them.
- `privmeet-server process-file meeting.mp3` runs the whole pipeline on one file from the command line.
- `privmeet-server seed-demo` adds the mockup's demo meetings; `privmeet-server import-django <old db.sqlite3>` copies the meetings of an install that ran PrivMeet's earlier Python backend.
- More in [native/README.md](native/README.md).
- The API is described in [docs/API.md](docs/API.md), and the design in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Coming from the Python backend

A checkout that once ran PrivMeet's earlier Python backend still has `backend/` on disk, about
9 GB of virtualenv, caches and faster-whisper models. Git deleted the tracked files but cannot
delete what it never tracked, so clear it out once:

```
scripts/cleanup-old-backend.sh              # --dry-run first if you like
powershell -ExecutionPolicy Bypass -File scripts\cleanup-old-backend.ps1   # Windows
```

It moves the recordings, the speaker models and the old database into `native/server/data`,
removes the rest, and then prints the one `import-django` command that turns the old database
into meetings. To have it run by itself after every pull:

```
git config core.hooksPath .githooks
```

## Troubleshooting

| Problem | What to do |
|---|---|
| `Cannot connect to the Docker daemon` | Start Docker Desktop (or `sudo systemctl start docker`) and try again. |
| Port 8000 is already in use | Another app, or another PrivMeet, holds it. Stop it, or change `127.0.0.1:8000:8000` in `compose.yml` to another port such as `127.0.0.1:8080:8000`. |
| The first meeting sits at "Summarizing" for minutes | The LLM is being downloaded (about 1 GB on the low tier). Watch it with `docker compose logs -f ollama`. Later meetings are fast. |
| A meeting fails with a connection error (e.g. `Connection refused`) while summarizing | The `ollama` container is down or still starting: `docker compose ps`, then `docker compose restart ollama`. Retry the meeting from its page. |
| The server is killed, or a long meeting fails at random | Not enough memory. Use the low tier (`TIER=low`), lower `NUM_CTX`, or raise `WEB_MEM` / `OLLAMA_MEM` if the machine has room. Close other heavy apps. |
| Upload says `No audio stream found` | The file has no audio track, or it is not really a media file. Supported: mp3, wav, mp4, m4a, webm, ogg, opus, flac, mkv, mov. |
| Recording: "Microphone access was blocked" | Allow the microphone for `127.0.0.1` in the browser's site settings (the icon in the address bar), then press **Try again**. |
| Recording a Meet / Zoom / Teams tab has no other voices | When sharing, pick the **tab** and tick **Share tab audio**. Windows and Chrome can also share system audio for a whole screen. |
| GPU not used | Check the toolkit with the `nvidia-smi` container above, start with `compose.gpu.yml`, and check `"device"` at http://127.0.0.1:8000/api/system/. |
| No speaker labels | Expected on the low tier. Turn on **Find speakers** under Settings, AI Model, Advanced options (it needs about 0.3 GB more RAM). |
| Everything else | `scripts/privmeet.sh status` and `scripts/privmeet.sh logs web` show what the stack is doing. |

## Security
- **No login, single user.** Anyone who can reach port 8000 can read, change and delete every meeting. Keep the default `127.0.0.1` binding. To reach it from another device, use an SSH tunnel or a VPN to this machine, not a public port.
- **Uploads are checked:** an extension allow-list, a size limit (`MAX_UPLOAD_MB`, enforced before the body is read), and `ffprobe` must find an audio stream. Files are stored under random names and served only through the API.
- **Every write needs the CSRF token,** and requests whose `Host` is not in `ALLOWED_HOSTS` are refused.
- **Privacy:** with the default Ollama provider nothing leaves the machine, apart from downloading Docker images and models. A cloud LLM provider is opt-in and gets only transcript text.
- Report security problems as described in [SECURITY.md](SECURITY.md).

## Project
- How it works: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · API: [docs/API.md](docs/API.md) · Benchmarks: [docs/BENCHMARKS.md](docs/BENCHMARKS.md) · Releasing: [docs/RELEASING.md](docs/RELEASING.md)
- Design and team plan: [docs/PLAN.md](docs/PLAN.md), [docs/TASKS.md](docs/TASKS.md); rules for AI agents: [AGENTS.md](AGENTS.md)
- [CONTRIBUTING.md](CONTRIBUTING.md) · [CHANGELOG.md](CHANGELOG.md) · [AUTHORS.md](AUTHORS.md) · License: [MIT](LICENSE). The bundled Monocraft pixel font is under the SIL Open Font License (`frontend/src/ui/fonts/MONOCRAFT-OFL.txt`).
