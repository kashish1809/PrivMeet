# PrivMeet: 6-day task split

Every person has **two tasks per day**:
- **Task A**, the main track.
- **Task B**, the UI / desktop app / release track.

| Person | Name | Task A (main) | Task B (second) |
|---|---|---|---|
| Person 1 | **Vinayak** | Backend pipeline + AI (`T1.x`) | Heavy UI per mockup (`U1.x`) |
| Person 2 | **Kashish** | React frontend pages (`T2.x`) | Tauri desktop app + launcher (`A2.x`) |
| Person 3 | **Karthik** | Docker, Postgres, security, notes UI, docs (`T3.x`) | GitHub workflows, packaging, CLI launchers (`W3.x`) |

- Day 0 (done, on `main`): Django project, models, hardware tiers (`meetings/hw.py`), pipeline modules, Celery tasks, API views.
- Design: `docs/PLAN.md`. UI mockup: `docs/ui/mockup.webp`. App reference: GitPilot (`github.com/vinayakkam/gitpilot`).

## Day plan
| Day | Vinayak | Kashish | Karthik |
|---|---|---|---|
| 1 | T1.1 + **U1.1** design system | T2.1 + **A2.1** Tauri scaffold | T3.1 + **W3.1** CI workflow |
| 2 | T1.2 + **U1.2** app shell + sidebar | T2.2 + **A2.2** backend manager (Rust) | T3.2 + **W3.2** Docker image workflow |
| 3 | T1.3 + **U1.3** Record / Live screen | T2.3 + **A2.3** launcher flow | T3.3 + **W3.3** build-installers workflow |
| 4 | T1.4 + **U1.4** UI backend + Meeting Info + Home | T2.4 + **A2.4** mic/camera/screen in webview | T3.4 + **W3.4** Linux/Windows packaging |
| 5 | T1.5 + **U1.5** Settings, History, Tools | T2.5 + **A2.5** branding, single instance, About | T3.5 + **W3.5** CLI launchers + release docs |
| 6 | T1.6 + **UT1.6** UI test pass | T2.6 + **AT2.6** desktop app test | T3.6 + **WT3.6** release dry run |

## Rules for every task
- Start a task only when its owner says "start <id>". AGENTS.md has the full protocol.
- Task A and task B of the same day are **separate branches and separate commits**.
- One task = one new branch, named exactly as below. Commit only: no push, no PR, no co-author or AI trailers.
- Before starting, check that every "Needs" task is merged into `main`. If one is not, stop and tell the person.
- Only touch the files listed under "Files". Ask the person before editing anything else.
- **Day 6 is testing only.** It starts after all Day 1–5 tasks (A and B) of all three people are merged into `main`.

## Contracts (so parallel work fits together)
- **`frontend/src/api.js`** (T2.1):
  - `api(path, {method, body})` sends a JSON request with the `X-CSRFToken` header, read from the `csrftoken` cookie. It returns the parsed JSON, or throws `Error(data.error)`.
  - `upload(path, formData, onProgress)` uses XHR, reports `onProgress(0..1)`, and resolves to JSON.
- **`frontend/src/components/SummaryPanel.jsx`** (T3.4): `export default function SummaryPanel({ meeting, onSave })`. It covers the "AI Summary" and "Key Points" (decisions) parts of the Summary tab.
  - `meeting` is the full JSON from `GET /api/meetings/<id>/`.
  - `onSave(patch)` sends a PATCH and resolves to the updated meeting.
- **`frontend/src/components/ActionItemsPanel.jsx`** (T3.4): `export default function ActionItemsPanel({ meeting, onSave })`. It is the Action Items tab: a table with checkbox, task, owner and due, plus "Add Action Item".
- **`frontend/src/components/QABox.jsx`** (T3.4): `export default function QABox({ meetingId, onSeek })`.
  - `onSeek(seconds)` is called when the user clicks a `[mm:ss]` citation.
- T2.1 creates these three components and `MeetingInfo.jsx` (owned by U1.4) as stubs that `return null`. Kashish's detail page renders them, and the owners replace the stubs.
- **Shared UI** (U1.1): every page uses the components in `frontend/src/ui/` and `lucide-react` icons. Until U1.1 is merged, use plain Tailwind and swap to `src/ui` in your next task.
- **API** (already built, `backend/meetings/urls.py`):
  - `GET|POST /api/meetings/`, `?q=` searches.
  - `GET|PATCH|DELETE /api/meetings/<id>/`.
  - `GET /api/meetings/<id>/audio` supports Range requests.
  - `POST /api/meetings/<id>/ask`, `POST /api/meetings/<id>/retry`, `GET /api/meetings/<id>/export.md`.
  - `GET /api/questions/<id>/`, `GET /api/system/`.
- `frontend/src/ui/` (U1.1) is used instead of raw Tailwind for buttons, cards, tabs, inputs, badges, avatars and menus. **Icons:** `lucide-react` only.
- `frontend/src/layout/AppShell.jsx` (U1.2) provides the sidebar and page frame. Pages render only their content.
- **Routes** (hash): `#/` Home, `#/meetings`, `#/new`, `#/m/<id>`, `#/record`, `#/history`, `#/settings`, `#/tools/transcription`, `#/tools/summarization`, `#/tools/action-items`, `#/tools/integrations`.
- `frontend/src/components/MeetingInfo.jsx` (U1.4): `export default function MeetingInfo({ meeting, onSave })`. It shows title, date, duration, participants (speakers), notes and tags. Kashish's detail page renders it in the right column.
- **Theme:** Tailwind v4 `dark:` with a class on `<html>` (`light | dark | system`, stored in `localStorage.theme`). The primary color is indigo/violet as in the mockup.

## How the desktop app works (decided)
- `desktop/src-tauri/` is a Tauri 2 shell. It uses the system webview (WebView2 or WebKitGTK), so no Electron and no extra RAM.
- On open, a small bundled **launcher page** (`desktop/launcher/`, plain HTML/JS) checks Docker and starts the stack with `docker compose up -d`. It runs a bundled `compose.yml` that uses the published image. When `/api/system/` answers, the window navigates to `http://127.0.0.1:8000`.
- The GPU override (`compose.gpu.yml`) is added automatically when `nvidia-smi` works.
- On quit, the app stops the stack unless "Keep running in background" is on.
- The React UI itself is served by Django, as in the main plan. The desktop app does not bundle a second copy.

---

## Day 1

### Vinayak

**Task A**

#### T1.1 · Migrations + model download script
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

**Task B**

#### U1.1 · Design system
- **Branch:** `d1/vinayak/U1.1-design-system`
- **Needs:** none. Build standalone; wiring happens in U1.2.
- **Files:** `frontend/src/ui/*`, `frontend/src/ui/theme.css`
- **Do:** build these components to match the mockup in light and dark:
  - Button (primary / secondary / danger / ghost, with icon) and IconButton
  - Card, Badge (meeting status colors), Avatar + AvatarStack (stable color per speaker), Tabs, Input, SearchInput, Select, Textarea, Toggle, TagChip (removable)
  - Menu (kebab), Modal + ConfirmDialog, EmptyState, ProgressBar, StatusDot
  - `theme.css`: color tokens and the dark variant. `useTheme()` hook (`light|dark|system`).
  - Do not edit `frontend/package.json`. T2.1 adds `lucide-react` on the same day.
- **Done when:** every component renders in both themes, is keyboard reachable and has visible focus rings.

### Kashish

**Task A**

#### T2.1 · Frontend scaffold
- **Branch:** `d1/kashish/T2.1-frontend-scaffold`
- **Needs:** none
- **Files:** everything under `frontend/` except `frontend/src/ui/`
- **Do:**
  - Vite + React (plain JSX, no TypeScript) + Tailwind v4 via `@tailwindcss/vite`, plus `lucide-react` for U1.1. Do not create `src/ui/`; that folder is Vinayak's U1.1.
  - In `vite.config.js`, set `base: "/static/"`, `build.outDir: "dist"`, and a dev proxy from `/api` to `http://localhost:8000`.
  - Write `src/api.js` per the contracts above.
  - Write `src/App.jsx` with a tiny hash router: `#/meetings` list (and `#/` until U1.2 adds Home), `#/new` new meeting, `#/m/<id>` detail. No router library. U1.2 adds the other routes and the sidebar shell.
  - Call `GET /api/system/` once on load; it sets the CSRF cookie. Show tier/models in a simple temporary header, which U1.2 replaces with the sidebar.
  - Create stub pages `src/pages/{MeetingList,NewMeeting,MeetingDetail}.jsx` and stub components `src/components/{SummaryPanel,ActionItemsPanel,QABox,MeetingInfo}.jsx`.
- **Done when:** `npm run dev` shows the layout and footer against the running backend, and `npm run build` succeeds.

**Task B**

#### A2.1 · Tauri 2 scaffold
- **Branch:** `d1/kashish/A2.1-tauri-scaffold`
- **Needs:** none
- **Files:** `desktop/**` (new). Do not touch `frontend/` or `backend/`.
- **Do:**
  - `desktop/package.json` with `@tauri-apps/cli` 2 and a `desktop/src-tauri/` like GitPilot's: `tauri.conf.json`, `Cargo.toml`, `src/main.rs`, `src/lib.rs`, `capabilities/default.json`, `icons/`.
  - Product name "PrivMeet". Pick the identifier with Vinayak. Window 1280×820, min 900×580, centered.
  - `frontendDist` is `../launcher` (plain `index.html` + `launcher.js` + `launcher.css`, no React).
  - Bundle targets: `appimage`, `deb`, `nsis`, `msi`.
- **Done when:** `npm run tauri dev` in `desktop/` opens a window with the launcher page on Linux.

### Karthik

**Task A**

#### T3.1 · Dockerfile
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

**Task B**

#### W3.1 · CI workflow
- **Branch:** `d1/karthik/W3.1-ci`
- **Needs:** none
- **Files:** `.github/workflows/ci.yml`
- **Do:**
  - Run on push and pull request.
  - **Backend job:** Python 3.12, install requirements, `python manage.py check`, and `makemigrations --check --dry-run` (enable once T1.1 is merged).
  - **Frontend job:** Node 22, `npm ci && npm run build` in `frontend/`. Skip if the folder is missing.
  - Cache pip and npm.
  - WT3.6 adds a `pytest` step once T1.6 is merged.
- **Done when:** the workflow file is valid (`actionlint` if installed) and documented in its header comment.

---

## Day 2

### Vinayak

**Task A**

#### T1.2 · Real pipeline run + CLI command
- **Branch:** `d2/vinayak/T1.2-pipeline-run`
- **Needs:** T1.1
- **Files:** `backend/meetings/pipeline/*`, `backend/meetings/tasks.py`, `backend/meetings/management/commands/process_file.py`
- **Do:**
  - Add `python manage.py process_file <path> [--title]`. It creates a Meeting and runs `process_meeting` synchronously, then prints the segments, speakers and summary.
  - Run it on a short single-speaker clip and a 5–10 min multi-speaker meeting recording. Fix any bugs in transcribe, diarize or tasks.
  - Check that the Whisper model is freed before diarization. RSS should drop, measured with `/usr/bin/time -v`.
- **Done when:** both files reach status `done` locally with Ollama running, and speaker labels look right on the multi-speaker file.

**Task B**

#### U1.2 · App shell + sidebar
- **Branch:** `d2/vinayak/U1.2-app-shell`
- **Needs:** U1.1, T2.1
- **Files:** `frontend/src/layout/*`, `frontend/src/App.jsx` (only the AppShell wrapper and new routes), `frontend/src/main.jsx` (import `theme.css`), stub pages `frontend/src/pages/{Home,RecordLive,History,Settings,Tools}.jsx`
- **Do:**
  - Sidebar per the mockup: logo "PrivMeet / Self-hosted AI meeting notes". The MAIN group has Home, Meetings, Record / Live, History and Settings. The TOOLS group has Transcription, Summarization, Action Items and Integrations.
  - The active item is highlighted, and Record / Live gets a red dot while recording.
  - Bottom card: "Local AI · Ollama · <model>" with a green or grey dot from `/api/system/`.
  - Below 900 px the sidebar collapses to icons; on phones it becomes a drawer.
  - Add all the routes from the contracts.
- **Done when:** every route opens inside the shell, and Kashish's pages still work inside it.

### Kashish

**Task A**

#### T2.2 · Meeting list + search
- **Branch:** `d2/kashish/T2.2-meeting-list`
- **Needs:** T2.1
- **Files:** `frontend/src/pages/MeetingList.jsx`, new files in `frontend/src/components/` (not SummaryPanel/QABox)
- **Do:** build the "Meetings" screen from the mockup.
  - A "New Meeting" button.
  - Rows grouped Today / Yesterday / Last week / Older, each with title, duration, participant count and time.
  - A status badge with progress %, and a kebab menu (Open, Export, Delete).
  - Poll every 2 s only while some meeting is not `done`/`failed`.
  - A search box (debounced 300 ms) calls `?q=`. Show hit snippets; clicking one opens `#/m/<id>?t=<start>`.
  - Empty state with a link to `#/new`.
- **Done when:** the list, polling and search work against the backend.

**Task B**

#### A2.2 · Backend manager (Rust)
- **Branch:** `d2/kashish/A2.2-backend-manager`
- **Needs:** A2.1, T3.2
- **Files:** `desktop/src-tauri/src/*`, `desktop/src-tauri/tauri.conf.json` (resources), `desktop/src-tauri/capabilities/*`
- **Do:** Tauri commands:
  - `check_docker` returns installed, running, compose v2 or not, and the version.
  - `has_nvidia` checks whether `nvidia-smi` succeeds.
  - `start_backend` runs `docker compose -p privmeet -f compose.yml [-f compose.gpu.yml] up -d` using compose files bundled as Tauri resources and copied to the app data dir.
  - `stop_backend`.
  - `backend_status` polls `http://127.0.0.1:8000/api/system/`.
  - `backend_logs` streams `docker compose logs -f` lines as Tauri events.
  - Use `tokio::process`, never a shell string. Return errors as readable messages.
- **Done when:** the commands start, stop and report the real stack from the dev window.

### Karthik

**Task A**

#### T3.2 · docker compose
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

**Task B**

#### W3.2 · Docker image workflow
- **Branch:** `d2/karthik/W3.2-docker-image`
- **Needs:** T3.1
- **Files:** `.github/workflows/docker.yml`, `compose.yml` (image line only)
- **Do:**
  - On tag `v*`, build and push `ghcr.io/vinayakkam/privmeet:<version>` and `:latest` (CPU), and `:<version>-gpu` (`GPU=1` build arg), with `docker/build-push-action` and the GHA cache.
  - Set `compose.yml` web/worker to `image: ghcr.io/vinayakkam/privmeet:${PRIVMEET_VERSION:-latest}` with `build: .` kept for developers. The desktop app needs the image, because users have no source checkout.
- **Done when:** the workflow is valid, and `docker compose build` still works locally.

---

## Day 3

### Vinayak

**Task A**

#### T1.3 · Ollama summary + Q&A quality
- **Branch:** `d3/vinayak/T1.3-llm-quality`
- **Needs:** T1.2
- **Files:** `backend/meetings/pipeline/llm.py`, `backend/meetings/search.py`
- **Do:**
  - Tune the prompts for `qwen2.5:1.5b` (low tier) and `qwen2.5:3b` (mid) so summary, decisions and action items are correct, with owners and due dates when spoken.
  - Test a 45–60 min recording: the map-reduce must stay inside `num_ctx`.
  - Test Q&A citations `[mm:ss]` on short (full transcript) and long (retrieval) meetings.
- **Done when:** 3 test recordings give useful notes, and Q&A answers with timestamps.

**Task B**

#### U1.3 · Record / Live screen (heaviest)
- **Branch:** `d3/vinayak/U1.3-record-live`
- **Needs:** U1.2
- **Files:** `frontend/src/pages/RecordLive.jsx`, `frontend/src/record/*` (new folder)
- **Do:** build the top screen of the mockup.
  - **Header:** editable title, date, a "Recording" status pill with a timer, and a Stop Recording button.
  - **Tiles:**
    - "You" shows the mic level with a Web Audio `AnalyserNode` and an optional camera preview.
    - With **Share** on, a second tile shows the shared tab or window.
    - There are no fake participants: other people appear as speakers after processing.
  - **Controls:** Mic (mute), Camera, Share, Record (start/pause/resume), More (input device picker, "include tab/system audio"), and Leave (stop + upload).
  - **Audio capture:** mix the mic plus the shared tab/system audio (`getDisplayMedia({audio: true})`) with a Web Audio `MediaStreamDestination`, then send it to `MediaRecorder` (`audio/webm;codecs=opus`). Video is recorded only when Camera is on.
    - This is how users record an online meeting (Meet, Zoom or Teams in a browser).
  - **Right panel:** Transcript / Summary / Action Items tabs. While recording they show a waveform and "Transcript appears when you stop". After stopping, upload with `upload()` and go to `#/m/<id>`.
  - **Meeting Info column:** title, notes and tags typed during recording, sent with the upload.
  - If mic permission is denied, or `getDisplayMedia` is unsupported (some Linux webviews), show a clear message and keep mic-only recording working.
- **Done when:** a mic + tab-audio recording of a YouTube video uploads and is processed, and pause/resume and mute work.
- Live transcription while recording is **out of scope**. Its stretch task is S1 below.

### Kashish

**Task A**

#### T2.3 · New meeting: upload
- **Branch:** `d3/kashish/T2.3-new-meeting`
- **Needs:** T2.1
- **Files:** `frontend/src/pages/NewMeeting.jsx`, new files in `frontend/src/components/`
- **Do:**
  - A title field and a drag-drop/file picker for `.mp3 .wav .mp4 .m4a .webm .ogg .opus .flac .mkv .mov`.
  - An upload progress bar using `upload()` from `api.js`.
  - Show server errors (e.g. "No audio stream found").
  - Add a "Record instead" button that links to `#/record`. Recording is Vinayak's U1.3.
  - After upload, go to `#/m/<id>`.
  - Keep this page light; the desktop app (A2.x) is the bigger part of your day.
- **Done when:** an uploaded file creates a meeting that gets processed.

**Task B**

#### A2.3 · Launcher flow
- **Branch:** `d3/kashish/A2.3-launcher-flow`
- **Needs:** A2.2
- **Files:** `desktop/launcher/*`, `desktop/src-tauri/src/*`
- **Do:**
  - Steps with clear status: "Checking Docker", "Starting PrivMeet (first run downloads ~2 GB)", "Waiting for server", then navigate the window to `http://127.0.0.1:8000`.
  - If Docker is missing or stopped, show install/start instructions per OS with a link (opened via the opener plugin), plus a Retry button.
  - Show a log viewer on failure.
  - Save a "Keep running in background on quit" setting. Stop the stack on window close otherwise.
- **Done when:** a cold start from app launch to the UI works, and quitting stops the containers.

### Karthik

**Task A**

#### T3.3 · Postgres search + security pass
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

**Task B**

#### W3.3 · build-installers workflow
- **Branch:** `d3/karthik/W3.3-build-installers`
- **Needs:** A2.1
- **Files:** `.github/workflows/build-installers.yml`
- **Do:** model it on GitPilot's `build-installers.yml`.
  - Windows job: `windows-latest`, NSIS + MSI.
  - Linux job: `ubuntu-24.04`, deb + AppImage, with the WebKitGTK 4.1 apt deps.
  - Use `dtolnay/rust-toolchain@stable` + `Swatinem/rust-cache@v2`, run `npm ci` in `desktop/`, then `npx tauri build`.
  - `actions/upload-artifact@v4`.
  - A release job uses `softprops/action-gh-release@v2` on tag `v*`, attaching all installers.
  - Trigger on tag `v*` plus `workflow_dispatch`.
- **Done when:** the workflow is valid. A real run happens in WT3.6.

---

## Day 4

### Vinayak

**Task A**

#### T1.4 · Benchmarks + tier tuning
- **Branch:** `d4/vinayak/T1.4-benchmarks`
- **Needs:** T1.3
- **Files:** `scripts/bench.py`, `docs/BENCHMARKS.md`, `backend/meetings/hw.py`
- **Do:**
  - `scripts/bench.py <audio>` runs each stage per tier (forced with `TIER=`). It records wall time and peak RSS using `resource.getrusage` in a child process, and the Ollama model size from `ollama ps`.
  - Write results for a 10-min file to `docs/BENCHMARKS.md`.
  - If low-tier peak is over 2.5 GB, or the real-time factor on low is above 1.0, tune the tier defaults in `hw.py`.
- **Done when:** the benchmark table is filled for low and mid (high if a GPU is available).

**Task B**

#### U1.4 · UI backend + Meeting Info + Home
- **Branch:** `d4/vinayak/U1.4-ui-backend-home`
- **Needs:** U1.2, T1.1
- **Files:** `backend/meetings/models.py`, `backend/meetings/migrations/0003_*`, `backend/meetings/views.py` (new views only, plus PATCH fields), `backend/meetings/urls.py`, `frontend/src/components/MeetingInfo.jsx`, `frontend/src/pages/Home.jsx`
- **Do:**
  - **Backend:**
    - `Meeting.notes` (text) and `Meeting.tags` (JSON list of strings, max 10, 30 chars each). PATCH and upload accept both.
    - `GET /api/meetings/?tag=&from=&to=` filters.
    - `GET /api/tags/`.
    - `GET /api/action-items/` returns all action items across meetings with the meeting id and title.
  - **MeetingInfo:** a panel per the mockup. Notes autosave (debounced), tags can be added and removed, and participants are avatars of the speakers.
  - **Home:**
    - Quick actions: Record, Upload.
    - Recent meetings (5).
    - Open action items (from `/api/action-items/`).
    - A Local AI status card.
- **Done when:** notes and tags persist, and Home shows real data.

### Kashish

**Task A**

#### T2.4 · Meeting detail: player + transcript
- **Branch:** `d4/kashish/T2.4-meeting-detail`
- **Needs:** T2.2
- **Files:** `frontend/src/pages/MeetingDetail.jsx`, new files in `frontend/src/components/` (not SummaryPanel/QABox)
- **Do:**
  - Poll `GET /api/meetings/<id>/` every 2 s while processing. Show stage + progress bar, the error and a Retry button when `failed`.
  - **Layout** per the mockup:
    - Header: "Back to Meetings", title, date · duration · participants, and Edit/Share/kebab buttons.
    - Tabs: Transcript | Summary | Action Items | Ask.
    - A right column with `<MeetingInfo meeting onSave>`.
  - An `<audio>` player from `/api/meetings/<id>/audio`. The transcript list highlights the current segment, clicking a segment seeks, and the list auto-scrolls (pausable). `?t=` in the hash seeks on load.
  - A "Search transcript…" box that filters and highlights matches client-side.
  - Speaker avatars with stable colors, from `src/ui` Avatar.
  - The Summary tab renders `<SummaryPanel>`, the Action Items tab `<ActionItemsPanel>`, and the Ask tab `<QABox meetingId onSeek>`, per the contracts.
- **Done when:** the transcript and audio stay in sync on a 10-min meeting.

**Task B**

#### A2.4 · Mic, camera and screen capture in the webview
- **Branch:** `d4/kashish/A2.4-media-permissions`
- **Needs:** A2.3
- **Files:** `desktop/src-tauri/src/*`, `desktop/src-tauri/Cargo.toml`, `desktop/src-tauri/capabilities/*`, `desktop/src-tauri/tauri.conf.json`
- **Do:** make `getUserMedia` (mic, camera) and `getDisplayMedia` (Share) work inside the app window for the page at `http://127.0.0.1:8000`, which U1.3 uses.
  - **Linux (WebKitGTK):** enable media-stream settings and grant permission requests for `127.0.0.1` only, via `with_webview`.
  - **Windows (WebView2):** handle `PermissionRequested` for `127.0.0.1` only.
  - Allow the remote URL in capabilities only if a Tauri API is needed there.
  - If screen capture is unsupported on a platform, the UI already falls back. Document it.
- **Done when:** recording with the mic works inside the desktop app on Linux, and the Windows result is documented.

### Karthik

**Task A**

#### T3.4 · Summary, Action Items + Q&A panels
- **Branch:** `d4/karthik/T3.4-notes-ui`
- **Needs:** T2.1, U1.1
- **Files:** `frontend/src/components/SummaryPanel.jsx`, `frontend/src/components/ActionItemsPanel.jsx`, `frontend/src/components/QABox.jsx`
- **Do:** match the mockup's Summary and Action Items tabs, using `src/ui` components.
  - **SummaryPanel:** an "AI Summary" card plus "Key Points" (decisions), and an Export button linking to `/api/meetings/<id>/export.md`.
  - **ActionItemsPanel:** a table with checkbox, task, owner and due.
    - Toggling `done` saves via `onSave({action_items})`.
    - Inline edit of task/owner/due, plus "Add Action Item" and delete.
  - **QABox:** a question input that calls `POST /ask` and polls `/api/questions/<id>/` until it is not `pending`. Show the history for the session. `[mm:ss]` in answers becomes buttons that call `onSeek`.
  - Disable the box unless the meeting is `done`.
- **Done when:** all three components work inside T2.4's page, or in a temporary test page that you do not commit.

**Task B**

#### W3.4 · Linux + Windows packaging
- **Branch:** `d4/karthik/W3.4-packaging`
- **Needs:** W3.3
- **Files:** `packaging/**`, `desktop/src-tauri/tauri.conf.json` (bundle section only, and tell Kashish)
- **Do:**
  - `packaging/arch/PKGBUILD` for `privmeet-bin`, built from the release `.deb` like GitPilot's. Depends: `webkit2gtk-4.1`, `gtk3`. Optdepends: `docker`, `docker-compose`, `nvidia-container-toolkit`.
  - Deb depends/recommends in the bundle config.
  - `packaging/windows/` NSIS header/sidebar and WiX banner/dialog BMPs from the logo, wired in `tauri.conf.json` as in GitPilot.
- **Done when:** `makepkg -si` installs from a locally built `.deb` on CachyOS/Arch.

---

## Day 5

### Vinayak

**Task A**

#### T1.5 · GPU path + CPU fallback
- **Branch:** `d5/vinayak/T1.5-gpu`
- **Needs:** T1.4, T3.2
- **Files:** `compose.gpu.yml`, `backend/meetings/pipeline/transcribe.py`, `backend/meetings/hw.py`, `Dockerfile` (GPU arg only, and tell Karthik)
- **Do:**
  - `compose.gpu.yml` override: worker and ollama get `deploy.resources.reservations.devices` (nvidia, all, [gpu]). The worker builds with `GPU=1`.
  - If loading the CUDA model raises an error, log it and retry once with `device="cpu", compute_type="int8"`.
  - Test on an NVIDIA machine if anyone has one. If not, write the exact steps in `docs/BENCHMARKS.md`.
- **Done when:** the CPU path still works, and the GPU path works or is documented as untested.

**Task B**

#### U1.5 · Settings, History, Tools
- **Branch:** `d5/vinayak/U1.5-settings-tools`
- **Needs:** U1.4
- **Files:** `frontend/src/pages/{Settings,History,Tools}.jsx`, `backend/meetings/settings_store.py` (new), `backend/meetings/hw.py`, `backend/meetings/views.py` (new views only), `backend/meetings/urls.py`
- **Do:**
  - **Settings backend:**
    - `GET/PATCH /api/settings/` stores overrides in `DATA_DIR/settings.json`. Fields: `llm_model`, `ollama_url`, `whisper_model`, `num_ctx`, `diarize`, `cpu_threads`.
    - `hw.profile()` merges these overrides. Re-read them at the start of every task, not cached forever.
    - `POST /api/settings/test` calls Ollama `/api/tags` and returns connected + the installed model list.
  - **Settings UI tabs** per the mockup:
    - General: default title format, keep or delete audio after processing.
    - AI Model: the provider is Ollama only. Model select from the installed list, Server URL with Test Connection and a Connected status, and Advanced options.
    - Recording: default mic, include system audio, camera off by default.
    - Appearance: light, dark or system.
  - **History:** a timeline of all meetings grouped by month, with Q&A questions asked per meeting.
  - **Tools pages:**
    - Transcription: the processing queue and progress of non-done meetings.
    - Summarization: re-run the summary for a meeting with the current model (uses `/retry`).
    - Action Items: all items with filters for open/done/owner, toggled via PATCH on the meeting.
    - Integrations: export Markdown/JSON, and a copy-summary button.
- **Done when:** changing the model in Settings changes the model used by the next processed meeting.

### Kashish

**Task A**

#### T2.5 · Detail actions + polish
- **Branch:** `d5/kashish/T2.5-polish`
- **Needs:** T2.4
- **Files:** `frontend/src/pages/*`, `frontend/src/components/*` (not SummaryPanel/QABox), `frontend/src/index.css`
- **Do:**
  - Rename speakers by clicking an avatar; this calls `PATCH speaker_names`.
  - Delete meeting with a `src/ui` ConfirmDialog.
  - Meetings list filters from the mockup: All/status, Date range and Tags. The Tags filter uses `?tag=` from U1.4.
  - Make your pages responsive for mobile widths. Dark mode comes from U1.1; check that your pages look right in it.
  - Accessibility: labels, and keyboard play/pause (space) outside inputs.
- **Done when:** everything works on a phone-sized viewport and keyboard-only use.

**Task B**

#### A2.5 · Branding, single instance, About
- **Branch:** `d5/kashish/A2.5-branding`
- **Needs:** A2.3
- **Files:** `desktop/**`
- **Do:**
  - App icons from the PrivMeet logo (`npm run tauri icon <1024px png>`).
  - `tauri-plugin-single-instance`: a second launch focuses the window.
  - An About dialog with the version, MIT license and the authors Kashish R Shetty, K Vinayak Kamath and HM Karthik.
  - Window title updates with the page.
  - Linux `.desktop` categories `AudioVideo;Office;`.
- **Done when:** the installed app shows the right icon and name in the launcher/start menu.

### Karthik

**Task A**

#### T3.5 · README + architecture docs
- **Branch:** `d5/karthik/T3.5-docs`
- **Needs:** T3.2
- **Files:** `README.md`, `docs/ARCHITECTURE.md`
- **Do:**
  - **README:** what it is, requirements, `docker compose up` quick start, the first-run model download note, GPU usage, local dev without Docker (venv + `CELERY_EAGER=1` + Vite), the tier table and env overrides, and troubleshooting.
  - Include a security warning in the README: there is no login, so do not expose the port beyond localhost.
  - **ARCHITECTURE.md:** a component diagram (Mermaid), the pipeline stages, the resource strategy, and the data model. This is for the project report.
- **Done when:** a new person can run the app from the README alone.

**Task B**

#### W3.5 · CLI launchers + release docs
- **Branch:** `d5/karthik/W3.5-launchers-release`
- **Needs:** T3.2, W3.2
- **Files:** `scripts/privmeet.sh`, `scripts/privmeet.ps1`, `docs/RELEASING.md`
- **Do:**
  - Launchers for people who do not install the desktop app. Commands: `up` (adds `compose.gpu.yml` when `nvidia-smi` works, then opens the browser at http://127.0.0.1:8000), `down`, `logs`, `update` (pull images), `status`.
  - `docs/RELEASING.md`:
    - Bump the version in `desktop/package.json`, `desktop/src-tauri/tauri.conf.json`, `Cargo.toml` and `frontend/package.json`.
    - Update the changelog, then tag `vX.Y.Z`.
    - The person pushes the tag; agents never push.
    - Check the CI artifacts, then update the PKGBUILD checksum.
- **Done when:** `scripts/privmeet.sh up` and `down` work on Linux.

---

## Day 6: testing (only after ALL Day 1–5 tasks are merged into `main`)

### Vinayak

**Task A**

#### T1.6 · Backend unit tests
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

**Task B**

#### UT1.6 · UI test pass
- **Branch:** `d6/vinayak/UT1.6-ui-tests`
- **Files:** `docs/testing/ui.md`, plus fixes in your own UI files
- **Do:** compare every screen to `docs/ui/mockup.webp`:
  - In light and dark.
  - At 1280 px, 900 px and 390 px widths.
  - Keyboard only.
  - With the axe browser extension or `axe-core` in DevTools, fixing all serious issues.
  - Record a Meet/YouTube tab with Share on.
  - Write the results and screenshots list in `docs/testing/ui.md`.
- **Done when:** there are no serious a11y issues and every mockup screen is matched or the gap is documented.

### Kashish

**Task A**

#### T2.6 · API tests + browser test pass
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

**Task B**

#### AT2.6 · Desktop app test
- **Branch:** `d6/kashish/AT2.6-desktop-test`
- **Files:** `docs/testing/desktop.md`, plus fixes in `desktop/**`
- **Do:**
  - Install the built `.deb`/AppImage on Linux and `.msi`/`.exe` on Windows if anyone has it.
  - Run: cold start, record with the mic, upload a file, quit, then reopen to check the "keep running" setting.
  - Check that a second instance focuses the window, and the Docker-missing path.
  - Note RAM used by the app window itself.
- **Done when:** `docs/testing/desktop.md` is filled in.

### Karthik

**Task A**

#### T3.6 · End-to-end + resource test
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

**Task B**

#### WT3.6 · Release dry run
- **Branch:** `d6/karthik/WT3.6-release-dry-run`
- **Files:** `docs/testing/release.md`, plus fixes in workflow/packaging files
- **Do:**
  - Add a `pytest` step to `ci.yml`, since T1.6 is merged by now.
  - The person (not the agent) pushes a test tag such as `v0.1.0-rc1` to a fork or the repo, or runs `workflow_dispatch`.
  - Check all three workflows go green, then download the artifacts.
  - Install the deb or AppImage plus the PKGBUILD package, and smoke-test them.
  - Record the results and run links.
- **Done when:** installers build in CI, and at least the Linux install works.

---

## Stretch (only after Day 6, if time)

#### S1 · Live transcript preview
- MediaRecorder `timeslice` of 15 s sends chunks to a new endpoint. A `tiny` Whisper model transcribes them, on the mid/high tiers only.
- The transcript tab shows "Live". The final notes still come from the full pipeline.
