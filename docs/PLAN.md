# PrivMeet: self-hosted meeting notes, plan

## Context
This is a miniproject. The repo is empty apart from `LICENSE`. The goal is to upload or record a meeting and get back a transcript with speaker labels, a summary, decisions and action items. Users can also search past meetings and ask questions about one. Everything runs locally, so no audio leaves the machine.

The app must run on low-end hardware, such as the dev box (5.7 GB RAM, 8 threads, AMD Vega iGPU, which counts as CPU-only). It must also use high-end hardware (an NVIDIA GPU) without wasting RAM, CPU or GPU on either.

**Stack (from the screenshot):** Python, Django + Celery, React + Tailwind, Docker, PostgreSQL, local MP3/WAV/MP4, OpenAI Whisper, LangChain + Ollama.

**Decisions taken:**
- Whisper runs through `faster-whisper`: the same OpenAI Whisper models on CTranslate2 int8, with no PyTorch. The report can say "OpenAI Whisper (faster-whisper backend)".
- v1 features: upload, browser recording, speaker labels, search, and Q&A.
- High-end means an NVIDIA GPU via CUDA, with CPU fallback everywhere.

## Resource strategy (core of the design)
1. **Auto-detected hardware tier.** `meetings/hw.py` reads total RAM from `/proc/meminfo` and CUDA availability from `ctranslate2.get_cuda_device_count()`. Every value can be overridden through env vars (`WHISPER_MODEL`, `LLM_MODEL`, `DIARIZE`, `TIER`).

   | Tier | Trigger | Whisper | LLM (Ollama) | Diarization |
   |---|---|---|---|---|
   | low | < 8 GB, no GPU | `base` int8 CPU | `qwen2.5:1.5b`, num_ctx 4096 | off by default, opt-in |
   | mid | ≥ 8 GB, no GPU | `small` int8 CPU | `qwen2.5:3b` | on |
   | high | NVIDIA GPU | `large-v3-turbo` float16 CUDA | `qwen2.5:7b` | on |

2. **Only one heavy model is in RAM at a time.**
   - The Celery worker runs with `--concurrency=1 --prefetch-multiplier=1 --max-tasks-per-child=1`. The process exits after each job, so all model memory goes back to the OS.
   - The pipeline runs in strict sequence: ffmpeg, then Whisper, then `del model` before diarization, then the LLM.
   - Ollama env: `OLLAMA_MAX_LOADED_MODELS=1` and `OLLAMA_NUM_PARALLEL=1`. On the low tier, also set `keep_alive="30s"` so the LLM unloads soon after the job.
   - Q&A also goes through the Celery queue, so it can never stack on top of a running transcription.
3. **CPU politeness.** Set `cpu_threads = max(1, nproc // 2)` and run the worker under `nice`, so the desktop and UI stay responsive. Whisper's `vad_filter=True` skips silence for a large speed-up.
4. **Light runtime.**
   - React is built to static files at image build time and served by Django through `whitenoise`. No Node container runs.
   - Progress is shown by polling `/api/meetings/<id>/` every 2 s. No websockets or Channels.
   - Gunicorn runs with 2 workers.
   - Postgres is tuned small (`shared_buffers=64MB`). Redis gets `maxmemory 32mb`.
   - Each compose service has a `mem_limit`.
5. **Light diarization.** Use `sherpa-onnx` (ONNX pyannote-segmentation plus 3D-Speaker embedding models, about 40 MB), not pyannote/PyTorch. Speakers are assigned to Whisper segments by time overlap.
6. **Long meetings on small LLMs.** A LangChain map-reduce chain splits the transcript into chunks sized to `num_ctx`, summarizes each chunk, then combines the results. `ChatOllama(format="json")` returns `{summary, decisions[], action_items[{owner, task, due}]}`.

Target peak RAM on the low tier is about 2 GB for the whole stack. That fits the dev box.

## Repo layout
```
backend/
  manage.py
  privmeet/        settings.py (env-driven), celery.py, urls.py
  meetings/
    models.py      Meeting, Segment, Question
    views.py       plain Django JsonResponse views (no DRF)
    tasks.py       process_meeting, answer_question
    hw.py          tier detection + model choice
    pipeline/      audio.py, transcribe.py, diarize.py, llm.py (summary + Q&A)
    search.py      Postgres FTS + Q&A excerpts
    tests/
  requirements.txt django, celery[redis], psycopg[binary], faster-whisper,
                   sherpa-onnx, langchain-ollama, langchain-text-splitters,
                   whitenoise, gunicorn
frontend/          Vite + React + Tailwind
  src/pages/       MeetingList, NewMeeting (upload + record), MeetingDetail
Dockerfile         multi-stage: node build, then python:3.12-slim + ffmpeg
compose.yml        db, redis, ollama, web, worker (CPU)
compose.gpu.yml    override: NVIDIA device reservations for worker + ollama
.env.example
README.md          setup, tiers, env overrides
```

## Data model
- **Meeting:** uuid, title, file (stored under `MEDIA_ROOT` with a uuid name), duration, language, status (`queued|converting|transcribing|diarizing|summarizing|done|failed`), progress %, error, summary, decisions JSON, action_items JSON, tier_used, created.
- **Segment:** meeting FK, start, end, speaker, text. A GIN index on `SearchVector('text')` gives Postgres full-text search, so no vector DB is needed.
- **Question:** meeting FK, question, answer, status.

## API
- `POST /api/meetings/`: multipart upload. Check the size limit, then validate with `ffprobe` (an audio stream must exist), then enqueue `process_meeting`.
- `GET /api/meetings/?q=`: list meetings, or FTS search over segments with snippet hits.
- `GET /api/meetings/<id>/`: detail plus segments. Also used for progress polling.
- `DELETE /api/meetings/<id>/`: remove the row and the media file.
- `POST /api/meetings/<id>/ask`: create a Question and enqueue `answer_question`. `GET /api/questions/<id>/` polls it.
- `GET /api/meetings/<id>/export.md`: Markdown notes.
- `GET /api/system/`: detected tier and models, shown in the UI footer.

## Pipeline (`tasks.process_meeting`)
1. `audio.py`: `ffmpeg -i in -ac 1 -ar 16000 -f wav` into a temp file. It handles MP3, WAV, MP4 and WebM (browser recordings). Use subprocess with list args, never `shell=True`.
2. `transcribe.py`: `WhisperModel(name, device, compute_type, cpu_threads)`. Stream segments, saving them in batches and updating progress as `seg.end / duration`.
3. `diarize.py` (if enabled): run sherpa-onnx diarization and set `Segment.speaker` by maximum overlap.
4. `llm.py`: run the map-reduce chain and save summary, decisions and action items.
5. On any exception, set status `failed` and store the error. Always delete the temp WAV.

**Q&A (`search.py` + `llm.py`):** FTS picks the top-k matching segments plus their neighbours. These go into a prompt with timestamps, and the answer cites `[mm:ss]`. Shortcut: keyword retrieval only; upgrade to pgvector + `nomic-embed-text` if recall is poor.

## Frontend
- **List page:** a search box, plus meeting cards with status badges.
- **New page:** a drag-drop upload, or Record/Stop using `MediaRecorder` (webm/opus), with a title field.
- **Detail page:**
  - A progress bar while processing.
  - An audio player. Clicking a segment seeks the player, and the current segment is highlighted.
  - Color chips for speakers, which can be renamed client-side and saved via a PATCH on Meeting.
  - Summary, decisions and an action-item checklist.
  - A Q&A box and an export button.

## Security
- No auth (single-user), so compose publishes `127.0.0.1:8000` only. The README will warn about this.
- Upload size cap (`DATA_UPLOAD_MAX_MEMORY_SIZE`, plus a streamed file-size check) and ffprobe validation.
- Uuid filenames, and media is served only through the API.

## Build order (milestones)
1. Scaffold the Django project, settings from env, Celery, and compose with db/redis/ollama/web/worker.
2. Audio → faster-whisper → segments, with the status/progress endpoint.
3. Hardware tiers (`hw.py`), worker flags and Ollama env.
4. LangChain + Ollama map-reduce summary.
5. React UI: list, upload/record, detail with synced transcript.
6. sherpa-onnx diarization.
7. FTS search and Q&A.
8. `compose.gpu.yml`, README, and benchmark numbers for the report.

## Verification
- **Unit (pytest):**
  - `hw.py` tier selection with faked meminfo/CUDA.
  - Speaker-overlap assignment.
  - Transcript chunking.
  - API views with the pipeline mocked.
  - Upload rejection for a non-media file.
- **Pipeline smoke test:** a 30 s fixture WAV generated with `espeak-ng` in the test setup is run through the real `base` model, and the test asserts that the expected words appear.
- **End-to-end:** run `docker compose up` and upload an MP4. Watch status reach `done`, then check the summary, action items, search and Q&A.
- **Resources:** watch `docker stats` during a 10-minute meeting on the dev box; low-tier peak should stay under 2.5 GB. On an NVIDIA box, run `docker compose -f compose.yml -f compose.gpu.yml up` and confirm `nvidia-smi` shows the worker and Ollama.
