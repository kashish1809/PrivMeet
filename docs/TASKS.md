# PrivMeet: 6-day task split

| # | Person | Area |
|---|---|---|
| Person 1 | **Vinayak** | Backend pipeline and AI (Whisper, diarization, Ollama, GPU) |
| Person 2 | **Kashish** | React frontend: pages, upload, recorder, player |
| Person 3 | **Karthik** | Docker, Postgres, security, notes/Q&A UI, docs |

Day 0 (done, on `main`): Django project, models, hardware tiers (`meetings/hw.py`), pipeline modules, Celery tasks, API views. See `docs/PLAN.md` for the design.

## Rules for every task
- Start a task only when its owner says "start T<id>". AGENTS.md has the full protocol.
- One task = one new branch, named exactly as below. Commit only: no push, no PR, no co-author or AI trailers.
- Before starting, check that every "Needs" task is merged into `main`. If one is not, stop and tell the person.
- Only touch the files listed under "Files". Ask the person before editing anything else.
- **Day 6 is testing only.** It starts after all Day 1–5 tasks of all three people are merged into `main`.

## Contracts (so parallel work fits together)
- **`frontend/src/api.js`** (T2.1):
  - `api(path, {method, body})` sends a JSON request with the `X-CSRFToken` header, read from the `csrftoken` cookie. It returns the parsed JSON, or throws `Error(data.error)`.
  - `upload(path, formData, onProgress)` uses XHR, reports `onProgress(0..1)`, and resolves to JSON.
- **`frontend/src/components/SummaryPanel.jsx`** (T3.4): `export default function SummaryPanel({ meeting, onSave })`.
  - `meeting` is the full JSON from `GET /api/meetings/<id>/`.
  - `onSave(patch)` sends a PATCH and resolves to the updated meeting.
- **`frontend/src/components/QABox.jsx`** (T3.4): `export default function QABox({ meetingId, onSeek })`.
  - `onSeek(seconds)` is called when the user clicks a `[mm:ss]` citation.
- T2.1 creates both components as stubs that `return null`. Kashish's detail page renders them, and Karthik replaces the stubs.
- **API** (already built, `backend/meetings/urls.py`):
  - `GET|POST /api/meetings/`, `?q=` searches.
  - `GET|PATCH|DELETE /api/meetings/<id>/`.
  - `GET /api/meetings/<id>/audio` supports Range requests.
  - `POST /api/meetings/<id>/ask`, `POST /api/meetings/<id>/retry`, `GET /api/meetings/<id>/export.md`.
  - `GET /api/questions/<id>/`, `GET /api/system/`.

---

## Day 1

### T1.1 · Vinayak · Migrations + model download script
- **Branch:** `d1/vinayak/T1.1-migrations`
- **Needs:** none
- **Files:** `backend/meetings/migrations/*`, `scripts/download_models.sh`
- **Do:**
  1. Run `python manage.py makemigrations meetings` to create `0001_initial`.
  2. Add `0002_segment_fts_index`. It uses `RunPython` and creates the index only when `schema_editor.connection.vendor == "postgresql"`: `GinIndex(SearchVector("text", config="english"), name="segment_fts")` on `Segment`, using the `VECTOR` from `meetings/search.py`. Add a reverse function that drops the index.
  3. Write `scripts/download_models.sh`. It downloads the diarization models into `backend/data/models/diarize/` as `segmentation.onnx` and `embedding.onnx`:
     - Segmentation: `https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2`. Take `model.onnx` from the archive.
     - Embedding: `https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx`. The tag spelling "recongition" is upstream's.
- **Done when:** `CELERY_EAGER=1 python manage.py migrate` works on SQLite, and the script is idempotent.

### T2.1 · Kashish · Frontend scaffold
- **Branch:** `d1/kashish/T2.1-frontend-scaffold`
- **Needs:** none
- **Files:** everything under `frontend/`
- **Do:**
  - Vite + React (plain JSX, no TypeScript) + Tailwind v4 via `@tailwindcss/vite`.
  - In `vite.config.js`, set `base: "/static/"`, `build.outDir: "dist"`, and a dev proxy from `/api` to `http://localhost:8000`.
  - Write `src/api.js` per the contracts above.
  - Write `src/App.jsx` with a tiny hash router: `#/` list, `#/new` new meeting, `#/m/<id>` detail. No router library.
  - Add a layout with a header and a footer that shows tier/models from `GET /api/system/`. That call also sets the CSRF cookie.
  - Create stub pages `src/pages/{MeetingList,NewMeeting,MeetingDetail}.jsx` and stub components `src/components/{SummaryPanel,QABox}.jsx`.
- **Done when:** `npm run dev` shows the layout and footer against the running backend, and `npm run build` succeeds.

### T3.1 · Karthik · Dockerfile
- **Branch:** `d1/karthik/T3.1-dockerfile`
- **Needs:** none
- **Files:** `Dockerfile`, `.dockerignore`
- **Do:** write a multi-stage build.
  1. `node:22-slim` runs `npm ci && npm run build` in `frontend/`. If `frontend/` is not merged yet, keep the stage and test with a dummy `dist/index.html`.
  2. `python:3.12-slim` adds `ffmpeg`, `pip install -r backend/requirements.txt`, and diarization models in `/opt/models/diarize`. Use the same URLs as T1.1.
  3. Copy `backend/` to `/app` and `frontend/dist` to `/app/frontend_dist`, then run `collectstatic`.
  - Set env: `DATA_DIR=/data`, `DIARIZE_MODELS_DIR=/opt/models/diarize`, `PYTHONUNBUFFERED=1`.
  - Add build arg `GPU=0`. When it is `1`, `pip install nvidia-cublas-cu12 nvidia-cudnn-cu12==9.*` and set `LD_LIBRARY_PATH` to their lib dirs. T1.5 will verify this on a GPU.
- **Done when:** `docker build .` succeeds and the image has no PyTorch (`pip show torch` fails).

## Day 2

### T1.2 · Vinayak · Real pipeline run + CLI command
- **Branch:** `d2/vinayak/T1.2-pipeline-run`
- **Needs:** T1.1
- **Files:** `backend/meetings/pipeline/*`, `backend/meetings/tasks.py`, `backend/meetings/management/commands/process_file.py`
- **Do:**
  - Add `python manage.py process_file <path> [--title]`. It creates a Meeting and runs `process_meeting` synchronously, then prints the segments, speakers and summary.
  - Run it on a short single-speaker clip and a 5–10 min multi-speaker meeting recording. Fix any bugs in transcribe, diarize or tasks.
  - Check that the Whisper model is freed before diarization. RSS should drop, measured with `/usr/bin/time -v`.
- **Done when:** both files reach status `done` locally with Ollama running, and speaker labels look right on the multi-speaker file.

### T2.2 · Kashish · Meeting list + search
- **Branch:** `d2/kashish/T2.2-meeting-list`
- **Needs:** T2.1
- **Files:** `frontend/src/pages/MeetingList.jsx`, new files in `frontend/src/components/` (not SummaryPanel/QABox)
- **Do:**
  - Meeting cards: title, date, duration, and a status badge with progress %.
  - Poll every 2 s only while some meeting is not `done`/`failed`.
  - A search box (debounced 300 ms) calls `?q=`. Show hit snippets; clicking one opens `#/m/<id>?t=<start>`.
  - Empty state with a link to `#/new`.
- **Done when:** the list, polling and search work against the backend.

### T3.2 · Karthik · docker compose
- **Branch:** `d2/karthik/T3.2-compose`
- **Needs:** T3.1, T1.1
- **Files:** `compose.yml`, `.env.example`
- **Do:** services:
  - **db:** `postgres:17-alpine`, `-c shared_buffers=64MB -c max_connections=20`, healthcheck `pg_isready`, volume.
  - **redis:** `redis-server --maxmemory 32mb --save "" --appendonly no`.
  - **ollama:** `ollama/ollama`, with `OLLAMA_MAX_LOADED_MODELS=1`, `OLLAMA_NUM_PARALLEL=1` and a volume. No published port.
  - **web:** `migrate`, then `gunicorn privmeet.wsgi -b 0.0.0.0:8000 -w 2 --timeout 300`. Port `127.0.0.1:8000:8000` only.
  - **worker:** `nice -n 10 celery -A privmeet worker --concurrency=1 --prefetch-multiplier=1 --max-tasks-per-child=1 -l info`.
  - web and worker share the `/data` volume.
  - Set `mem_limit` on every service. Use env-overridable values for worker and ollama, e.g. `${WORKER_MEM:-4g}`.
  - `.env.example` lists every env var from `backend/privmeet/settings.py` and `backend/meetings/hw.py`.
- **Done when:** `docker compose up` works, the UI or API loads at `http://127.0.0.1:8000`, and an upload is processed.

## Day 3

### T1.3 · Vinayak · Ollama summary + Q&A quality
- **Branch:** `d3/vinayak/T1.3-llm-quality`
- **Needs:** T1.2
- **Files:** `backend/meetings/pipeline/llm.py`, `backend/meetings/search.py`
- **Do:**
  - Tune the prompts for `qwen2.5:1.5b` (low tier) and `qwen2.5:3b` (mid) so summary, decisions and action items are correct, with owners and due dates when spoken.
  - Test a 45–60 min recording: the map-reduce must stay inside `num_ctx`.
  - Test Q&A citations `[mm:ss]` on short (full transcript) and long (retrieval) meetings.
- **Done when:** 3 test recordings give useful notes, and Q&A answers with timestamps.

### T2.3 · Kashish · New meeting: upload + recorder
- **Branch:** `d3/kashish/T2.3-new-meeting`
- **Needs:** T2.1
- **Files:** `frontend/src/pages/NewMeeting.jsx`, new files in `frontend/src/components/`
- **Do:**
  - A title field and a drag-drop/file picker for `.mp3 .wav .mp4 .m4a .webm .ogg .opus .flac .mkv .mov`.
  - An upload progress bar using `upload()` from `api.js`.
  - Show server errors (e.g. "No audio stream found").
  - A Record tab: `MediaRecorder` (audio/webm;codecs=opus) with start/pause/stop, a timer and a preview player. It uploads as `recording-<date>.webm`.
  - Handle a denied mic permission.
  - After upload, go to `#/m/<id>`.
- **Done when:** both the file and recording paths create a meeting that gets processed.

### T3.3 · Karthik · Postgres search + security pass
- **Branch:** `d3/karthik/T3.3-postgres-security`
- **Needs:** T3.2
- **Files:** `backend/meetings/search.py` (only if a fix is needed, and coordinate with Vinayak), `backend/privmeet/settings.py`, `backend/meetings/views.py`
- **Do:**
  - In compose, confirm `EXPLAIN` of the search query uses the `segment_fts` GIN index.
  - Check that search works for multi-word queries.
  - Verify upload limits (`MAX_UPLOAD_MB`), non-media rejection and CSRF on POST/PATCH/DELETE.
  - Verify audio Range requests (seeking works in Chrome and Firefox).
  - Verify `DEBUG` is off by default, and that a `SECRET_KEY` from env is required when `DEBUG` is off: add a startup error if the default key is used and `DEBUG != 1`.
- **Done when:** each check is either fixed or confirmed.

## Day 4

### T1.4 · Vinayak · Benchmarks + tier tuning
- **Branch:** `d4/vinayak/T1.4-benchmarks`
- **Needs:** T1.3
- **Files:** `scripts/bench.py`, `docs/BENCHMARKS.md`, `backend/meetings/hw.py`
- **Do:**
  - `scripts/bench.py <audio>` runs each stage per tier (forced with `TIER=`). It records wall time and peak RSS using `resource.getrusage` in a child process, and the Ollama model size from `ollama ps`.
  - Write results for a 10-min file to `docs/BENCHMARKS.md`.
  - If low-tier peak is over 2.5 GB, or the real-time factor on low is above 1.0, tune the tier defaults in `hw.py`.
- **Done when:** the benchmark table is filled for low and mid (high if a GPU is available).

### T2.4 · Kashish · Meeting detail: player + transcript
- **Branch:** `d4/kashish/T2.4-meeting-detail`
- **Needs:** T2.2
- **Files:** `frontend/src/pages/MeetingDetail.jsx`, new files in `frontend/src/components/` (not SummaryPanel/QABox)
- **Do:**
  - Poll `GET /api/meetings/<id>/` every 2 s while processing. Show stage + progress bar, the error and a Retry button when `failed`.
  - An `<audio>` player from `/api/meetings/<id>/audio`. The transcript list highlights the current segment, clicking a segment seeks, and the list auto-scrolls (pausable). `?t=` in the hash seeks on load.
  - Speaker chips with stable colors.
  - Render `<SummaryPanel meeting onSave>` and `<QABox meetingId onSeek>` per the contracts.
- **Done when:** the transcript and audio stay in sync on a 10-min meeting.

### T3.4 · Karthik · Summary panel + Q&A box
- **Branch:** `d4/karthik/T3.4-notes-ui`
- **Needs:** T2.1
- **Files:** `frontend/src/components/SummaryPanel.jsx`, `frontend/src/components/QABox.jsx`
- **Do:**
  - **SummaryPanel:** summary, decisions, and an action-item checklist that saves `done` via `onSave({action_items})`. Inline edit of a task's text/owner/due. An Export button links to `/api/meetings/<id>/export.md`.
  - **QABox:** a question input that calls `POST /ask` and polls `/api/questions/<id>/` until it is not `pending`. Show the history for the session. `[mm:ss]` in answers becomes buttons that call `onSeek`.
  - Disable the box unless the meeting is `done`.
- **Done when:** both components work inside T2.4's page, or in a temporary test page that you do not commit.

## Day 5

### T1.5 · Vinayak · GPU path + CPU fallback
- **Branch:** `d5/vinayak/T1.5-gpu`
- **Needs:** T1.4, T3.2
- **Files:** `compose.gpu.yml`, `backend/meetings/pipeline/transcribe.py`, `backend/meetings/hw.py`, `Dockerfile` (GPU arg only, and tell Karthik)
- **Do:**
  - `compose.gpu.yml` override: worker and ollama get `deploy.resources.reservations.devices` (nvidia, all, [gpu]). The worker builds with `GPU=1`.
  - If loading the CUDA model raises an error, log it and retry once with `device="cpu", compute_type="int8"`.
  - Test on an NVIDIA machine if anyone has one. If not, write the exact steps in `docs/BENCHMARKS.md`.
- **Done when:** the CPU path still works, and the GPU path works or is documented as untested.

### T2.5 · Kashish · Detail actions + polish
- **Branch:** `d5/kashish/T2.5-polish`
- **Needs:** T2.4
- **Files:** `frontend/src/pages/*`, `frontend/src/components/*` (not SummaryPanel/QABox), `frontend/src/index.css`
- **Do:**
  - Rename speakers by clicking a chip; this calls `PATCH speaker_names`.
  - Edit the title inline, and add Delete meeting with a confirm.
  - Make the layout responsive for mobile widths, and add dark mode via `prefers-color-scheme`.
  - Accessibility: labels, focus rings, keyboard play/pause (space) outside inputs.
- **Done when:** everything works on a phone-sized viewport and keyboard-only use.

### T3.5 · Karthik · README + architecture docs
- **Branch:** `d5/karthik/T3.5-docs`
- **Needs:** T3.2
- **Files:** `README.md`, `docs/ARCHITECTURE.md`
- **Do:**
  - **README:** what it is, requirements, `docker compose up` quick start, the first-run model download note, GPU usage, local dev without Docker (venv + `CELERY_EAGER=1` + Vite), the tier table and env overrides, and troubleshooting.
  - Include a security warning in the README: there is no login, so do not expose the port beyond localhost.
  - **ARCHITECTURE.md:** a component diagram (Mermaid), the pipeline stages, the resource strategy, and the data model. This is for the project report.
- **Done when:** a new person can run the app from the README alone.

## Day 6: testing (only after ALL Day 1–5 tasks are merged into `main`)

### T1.6 · Vinayak · Backend unit tests
- **Branch:** `d6/vinayak/T1.6-unit-tests`
- **Files:** `backend/pytest.ini`, `backend/requirements-dev.txt`, `backend/meetings/tests/test_hw.py`, `test_diarize.py`, `test_llm.py`, `test_search.py`
- **Do:** pytest + pytest-django on SQLite. Cover:
  - `hw.build_profile`: tiers, env overrides, forced high without CUDA.
  - `diarize.assign_speakers`: overlap, no overlap gives None.
  - `llm.parse_notes`: bad JSON, missing keys, wrong types.
  - `llm.split` sizes.
  - `search.excerpts`: full vs. retrieval.
  - A smoke test that runs real Whisper `base` on a short sample. Skip it when the sample file is absent.
- **Done when:** `pytest` passes, and any bugs found are fixed in this branch.

### T2.6 · Kashish · API tests + browser test pass
- **Branch:** `d6/kashish/T2.6-api-tests`
- **Files:** `backend/meetings/tests/test_views.py`, `docs/testing/frontend.md`
- **Do:**
  - Django test client with `tasks.*.delay` and `audio.probe` mocked. Cover:
    - Upload accepted; bad extension gives 400; no audio stream gives 400; too big gives 413.
    - The list and the `?q=` search.
    - PATCH validation.
    - DELETE removes the file.
    - Audio Range gives 206/416.
    - `ask` is rejected unless `done`.
    - Export markdown.
  - Run a manual checklist in Chrome and Firefox and record the results in `docs/testing/frontend.md`.
- **Done when:** the tests pass and the checklist is filled.

### T3.6 · Karthik · End-to-end + resource test
- **Branch:** `d6/karthik/T3.6-e2e`
- **Files:** `docs/testing/e2e.md`
- **Do:**
  - Fresh clone, then `docker compose up` on the low-end machine (Vinayak's 5.7 GB laptop).
  - Process an MP3, a WAV, an MP4 and a browser recording.
  - Check search, Q&A, export, delete and retry after stopping ollama.
  - Record peak `docker stats` memory per service and total time per file.
  - Repeat on a mid or GPU machine if one is available.
  - Report bugs to their owners. Small fixes may go in this branch; tell the owner.
- **Done when:** `docs/testing/e2e.md` is filled with results.
