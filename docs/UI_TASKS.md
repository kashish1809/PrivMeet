# PrivMeet: UI + desktop app task sheet (second task of each day)

Everyone has **two tasks per day**:
- The main task, in `docs/TASKS.md`.
- A second task from this sheet.

| Person | Second-task track | IDs |
|---|---|---|
| Vinayak | **Heavy UI**: the mockup design system, shell and screens | `U1.x` |
| Kashish | **Desktop app + launcher**: Tauri 2, like GitPilot | `A2.x` |
| Karthik | **Workflows + packaging**: GitHub Actions, installers, CLI launchers | `W3.x` |

- **Design reference:** `docs/ui/mockup.webp`.
- **App reference:** GitPilot (`github.com/vinayakkam/gitpilot`), a Tauri 2 app with `src-tauri/`, `.github/workflows/build-installers.yml`, `packaging/arch/PKGBUILD` and `packaging/windows/*.bmp`. Copy its structure, not its code.
- The same rules as `docs/TASKS.md` apply: start only on "start", one branch per task, commit only, no push, no co-author. Day 6 starts after **all** Day 1–5 tasks (main and second) are merged.

## Day plan
| Day | Vinayak | Kashish | Karthik |
|---|---|---|---|
| 1 | T1.1 + **U1.1** design system | T2.1 + **A2.1** Tauri scaffold | T3.1 + **W3.1** CI workflow |
| 2 | T1.2 + **U1.2** app shell + sidebar | T2.2 + **A2.2** backend manager (Rust) | T3.2 + **W3.2** Docker image workflow |
| 3 | T1.3 + **U1.3** Record / Live screen | T2.3 + **A2.3** launcher flow | T3.3 + **W3.3** build-installers workflow |
| 4 | T1.4 + **U1.4** UI backend + Meeting Info + Home | T2.4 + **A2.4** mic/camera/screen in webview | T3.4 + **W3.4** Linux/Windows packaging |
| 5 | T1.5 + **U1.5** Settings, History, Tools | T2.5 + **A2.5** branding, single instance, About | T3.5 + **W3.5** CLI launchers + release docs |
| 6 | T1.6 + **UT1.6** UI test pass | T2.6 + **AT2.6** desktop app test | T3.6 + **WT3.6** release dry run |

## How the desktop app works (decided, for every task here)
- `desktop/src-tauri/` is a Tauri 2 shell. It uses the system webview (WebView2 or WebKitGTK), so no Electron and no extra RAM.
- On open, a small bundled **launcher page** (`desktop/launcher/`, plain HTML/JS) checks Docker and starts the stack with `docker compose up -d`. It runs a bundled `compose.yml` that uses the published image. When `/api/system/` answers, the window navigates to `http://127.0.0.1:8000`.
- The GPU override (`compose.gpu.yml`) is added automatically when `nvidia-smi` works.
- On quit, the app stops the stack unless "Keep running in background" is on.
- The React UI itself is served by Django, as in the main plan. The desktop app does not bundle a second copy.

## UI contracts (on top of the contracts in TASKS.md)
- `frontend/src/ui/` (U1.1) holds all shared components. Every page by every person uses these instead of raw Tailwind for buttons, cards, tabs, inputs, badges, avatars and menus.
- **Icons:** `lucide-react` only.
- `frontend/src/layout/AppShell.jsx` (U1.2) provides the sidebar and page frame. Pages render only their content.
- **Routes** (hash): `#/` Home, `#/meetings`, `#/new`, `#/m/<id>`, `#/record`, `#/history`, `#/settings`, `#/tools/transcription`, `#/tools/summarization`, `#/tools/action-items`, `#/tools/integrations`.
- `frontend/src/components/MeetingInfo.jsx` (U1.4): `export default function MeetingInfo({ meeting, onSave })`. It shows title, date, duration, participants (speakers), notes and tags. Kashish's detail page renders it in the right column.
- **Theme:** Tailwind v4 `dark:` with a class on `<html>` (`light | dark | system`, stored in `localStorage.theme`). The primary color is indigo/violet as in the mockup.

---

## Vinayak: Heavy UI (`U1.x`)

### U1.1 · Day 1 · Design system
- **Branch:** `d1/vinayak/U1.1-design-system`
- **Needs:** none. Build standalone; wiring happens in U1.2.
- **Files:** `frontend/src/ui/*`, `frontend/src/ui/theme.css`
- **Do:** build these components to match the mockup in light and dark:
  - Button (primary / secondary / danger / ghost, with icon) and IconButton
  - Card, Badge (meeting status colors), Avatar + AvatarStack (stable color per speaker), Tabs, Input, SearchInput, Select, Textarea, Toggle, TagChip (removable)
  - Menu (kebab), Modal + ConfirmDialog, EmptyState, ProgressBar, StatusDot
  - `theme.css`: color tokens and the dark variant. `useTheme()` hook (`light|dark|system`).
  - Add `lucide-react` to `frontend/package.json`. This is the only allowed new dependency.
- **Done when:** every component renders in both themes, is keyboard reachable and has visible focus rings.

### U1.2 · Day 2 · App shell + sidebar
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

### U1.3 · Day 3 · Record / Live screen (heaviest)
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

### U1.4 · Day 4 · UI backend + Meeting Info + Home
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

### U1.5 · Day 5 · Settings, History, Tools
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

### UT1.6 · Day 6 · UI test pass
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

### S1 · Stretch (only after Day 6, if time) · Live transcript preview
- MediaRecorder `timeslice` of 15 s sends chunks to a new endpoint. A `tiny` Whisper model transcribes them, on the mid/high tiers only.
- The transcript tab shows "Live". The final notes still come from the full pipeline.

---

## Kashish: Desktop app + launcher (`A2.x`)

### A2.1 · Day 1 · Tauri 2 scaffold
- **Branch:** `d1/kashish/A2.1-tauri-scaffold`
- **Needs:** none
- **Files:** `desktop/**` (new). Do not touch `frontend/` or `backend/`.
- **Do:**
  - `desktop/package.json` with `@tauri-apps/cli` 2 and a `desktop/src-tauri/` like GitPilot's: `tauri.conf.json`, `Cargo.toml`, `src/main.rs`, `src/lib.rs`, `capabilities/default.json`, `icons/`.
  - Product name "PrivMeet". Pick the identifier with Vinayak. Window 1280×820, min 900×580, centered.
  - `frontendDist` is `../launcher` (plain `index.html` + `launcher.js` + `launcher.css`, no React).
  - Bundle targets: `appimage`, `deb`, `nsis`, `msi`.
- **Done when:** `npm run tauri dev` in `desktop/` opens a window with the launcher page on Linux.

### A2.2 · Day 2 · Backend manager (Rust)
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

### A2.3 · Day 3 · Launcher flow
- **Branch:** `d3/kashish/A2.3-launcher-flow`
- **Needs:** A2.2
- **Files:** `desktop/launcher/*`, `desktop/src-tauri/src/*`
- **Do:**
  - Steps with clear status: "Checking Docker", "Starting PrivMeet (first run downloads ~2 GB)", "Waiting for server", then navigate the window to `http://127.0.0.1:8000`.
  - If Docker is missing or stopped, show install/start instructions per OS with a link (opened via the opener plugin), plus a Retry button.
  - Show a log viewer on failure.
  - Save a "Keep running in background on quit" setting. Stop the stack on window close otherwise.
- **Done when:** a cold start from app launch to the UI works, and quitting stops the containers.

### A2.4 · Day 4 · Mic, camera and screen capture in the webview
- **Branch:** `d4/kashish/A2.4-media-permissions`
- **Needs:** A2.3
- **Files:** `desktop/src-tauri/src/*`, `desktop/src-tauri/Cargo.toml`, `desktop/src-tauri/capabilities/*`, `desktop/src-tauri/tauri.conf.json`
- **Do:** make `getUserMedia` (mic, camera) and `getDisplayMedia` (Share) work inside the app window for the page at `http://127.0.0.1:8000`, which U1.3 uses.
  - **Linux (WebKitGTK):** enable media-stream settings and grant permission requests for `127.0.0.1` only, via `with_webview`.
  - **Windows (WebView2):** handle `PermissionRequested` for `127.0.0.1` only.
  - Allow the remote URL in capabilities only if a Tauri API is needed there.
  - If screen capture is unsupported on a platform, the UI already falls back. Document it.
- **Done when:** recording with the mic works inside the desktop app on Linux, and the Windows result is documented.

### A2.5 · Day 5 · Branding, single instance, About
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

### AT2.6 · Day 6 · Desktop app test
- **Branch:** `d6/kashish/AT2.6-desktop-test`
- **Files:** `docs/testing/desktop.md`, plus fixes in `desktop/**`
- **Do:**
  - Install the built `.deb`/AppImage on Linux and `.msi`/`.exe` on Windows if anyone has it.
  - Run: cold start, record with the mic, upload a file, quit, then reopen to check the "keep running" setting.
  - Check that a second instance focuses the window, and the Docker-missing path.
  - Note RAM used by the app window itself.
- **Done when:** `docs/testing/desktop.md` is filled in.

---

## Karthik: Workflows + packaging (`W3.x`)

### W3.1 · Day 1 · CI workflow
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

### W3.2 · Day 2 · Docker image workflow
- **Branch:** `d2/karthik/W3.2-docker-image`
- **Needs:** T3.1
- **Files:** `.github/workflows/docker.yml`, `compose.yml` (image line only)
- **Do:**
  - On tag `v*`, build and push `ghcr.io/vinayakkam/privmeet:<version>` and `:latest` (CPU), and `:<version>-gpu` (`GPU=1` build arg), with `docker/build-push-action` and the GHA cache.
  - Set `compose.yml` web/worker to `image: ghcr.io/vinayakkam/privmeet:${PRIVMEET_VERSION:-latest}` with `build: .` kept for developers. The desktop app needs the image, because users have no source checkout.
- **Done when:** the workflow is valid, and `docker compose build` still works locally.

### W3.3 · Day 3 · build-installers workflow
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

### W3.4 · Day 4 · Linux + Windows packaging
- **Branch:** `d4/karthik/W3.4-packaging`
- **Needs:** W3.3
- **Files:** `packaging/**`, `desktop/src-tauri/tauri.conf.json` (bundle section only, and tell Kashish)
- **Do:**
  - `packaging/arch/PKGBUILD` for `privmeet-bin`, built from the release `.deb` like GitPilot's. Depends: `webkit2gtk-4.1`, `gtk3`. Optdepends: `docker`, `docker-compose`, `nvidia-container-toolkit`.
  - Deb depends/recommends in the bundle config.
  - `packaging/windows/` NSIS header/sidebar and WiX banner/dialog BMPs from the logo, wired in `tauri.conf.json` as in GitPilot.
- **Done when:** `makepkg -si` installs from a locally built `.deb` on CachyOS/Arch.

### W3.5 · Day 5 · CLI launchers + release docs
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

### WT3.6 · Day 6 · Release dry run
- **Branch:** `d6/karthik/WT3.6-release-dry-run`
- **Files:** `docs/testing/release.md`, plus fixes in workflow/packaging files
- **Do:**
  - Add a `pytest` step to `ci.yml`, since T1.6 is merged by now.
  - The person (not the agent) pushes a test tag such as `v0.1.0-rc1` to a fork or the repo, or runs `workflow_dispatch`.
  - Check all three workflows go green, then download the artifacts.
  - Install the deb or AppImage plus the PKGBUILD package, and smoke-test them.
  - Record the results and run links.
- **Done when:** installers build in CI, and at least the Linux install works.
