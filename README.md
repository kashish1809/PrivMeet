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
