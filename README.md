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
