# PrivMeet: task split

Every person has **two tasks per day**:
- **Task A**, the main track.
- **Task B**, the UI / desktop app / release track.

Vinayak and Kashish also each have a **v2 track** of 20 tasks (`R1.x`, `R2.x`). It has no days. It brings the app to the new mockup and adds the features that mockup shows.

| Person | Name | Task A (main) | Task B (second) | v2 track |
|---|---|---|---|---|
| Person 1 | **Vinayak** | Backend pipeline + AI (`T1.x`) | Heavy UI per mockup (`U1.x`) | Look, shell, backend features (`R1.x`) |
| Person 2 | **Kashish** | React frontend pages (`T2.x`) | Tauri desktop app + launcher (`A2.x`) | Meeting pages + desktop app (`R2.x`) |
| Person 3 | **Karthik** | Docker, Postgres, security, notes UI, docs (`T3.x`) | GitHub workflows, packaging, CLI launchers (`W3.x`) | none |

- Design: `docs/PLAN.md`. App reference: GitPilot (`github.com/vinayakkam/gitpilot`).
- **UI mockup (v2): `docs/ui/mockup.webp`.** It is the look for every screen.
- `docs/ui/mockup-v1.webp` is the old mockup. Use it only for the **layout** of screens v2 does not draw (Record / Live, Settings, the Meetings list filters). Colors, cards, buttons and the sidebar always come from v2.

## Status (2026-11-14)
Days 1–5 are done and merged into `main` for all three people. Days 1 and 2 task text is in git history (`git log -p docs/TASKS.md`); Days 3–5 stay below for reference.

| Done | Vinayak | Kashish | Karthik |
|---|---|---|---|
| Day 1 | T1.1 migrations, U1.1 design system | T2.1 frontend scaffold, A2.1 Tauri scaffold | T3.1 Dockerfile, W3.1 CI |
| Day 2 | T1.2 pipeline run, U1.2 app shell | T2.2 meeting list, A2.2 backend manager | T3.2 compose, W3.2 Docker image |
| Day 3 | T1.3 LLM quality (#30), U1.3 Record / Live (#31) | T2.3 new meeting (#25), A2.3 launcher flow (#24) | T3.3 Postgres + security (#20), W3.3 build-installers (#19) |
| Day 4 | T1.4 benchmarks (#32), U1.4 UI backend + Home (#33, #34) | T2.4 meeting detail (#27), A2.4 media permissions (#26) | T3.4 notes panels (#21), W3.4 packaging (#22) |
| Day 5 | T1.5 GPU + CPU fallback (#36), U1.5 Settings (#37, #38) | T2.5 polish (#28), A2.5 branding (#29) | T3.5 README + architecture (#40), W3.5 launchers + release docs (#23, #39) |

**v2 track:**
- Done: **R1.7** (settings store, feature flags, API reference). It was merged with U1.4 (#33) because U1.4 needs it.
- Partly done in other branches: R1.1 (the four theme presets, `useTheme` and `THEMES`) and R1.3 (`docs/ui/logo.svg`, `Logo.jsx` with `TAGLINE` and `SUBLINE`, the favicon; the four logo variants are still missing). The rest of R1.x and all of R2.x are open.

**Day 6:** not started. It starts only after every R task is merged or marked `(cut)` here.

**Added beyond the task list** (Vinayak, approved during review; all merged):
- **Themes:** the four theme presets (Indigo, Teal, Amber, Slate) with a picker in Settings → Appearance.
- **Art:** pixel landscapes behind every page. Each theme has its own scene and easter eggs, plus a starfield on dark themes.
- **Logo:** the pixel speech-bubble logo, animated (it glances and blinks). The master is `docs/ui/logo.svg`; the structure and texture references are in `docs/ui/logo-mockup.png` and `docs/ui/logo-texture-ref.jpg`.
- **Font and buttons:** the Monocraft pixel font (OFL, bundled) with textured pixel buttons, plus a font switch to a normal font, where the buttons go flat.
- **Cloud LLM providers:** OpenAI, OpenRouter, Anthropic and any OpenAI-compatible server. They are opt-in from Settings with a privacy warning. Ollama stays the default, and audio never leaves the machine.

### Day 5 review issues: fixed in `fix/day5-review-bugs`
| Owner | Issue | Fix |
|---|---|---|
| Kashish | The meeting detail page showed no status pill, so "Processed" (done, no summary) was invisible. | `MeetingHeader` shows the pill next to the date line, following the "Status pill" contract. |
| Kashish | The header's participant count could disagree with the Participants card. | Both count the distinct speakers in the transcript. |
| Kashish | `tauri.conf.json` bundled only `compose.yml`, so installed apps never had the GPU override. | `compose.gpu.yml` is bundled too. |
| Karthik | `docker.yml` published only `<version>-gpu`, so `compose.gpu.yml` with the default version had no image. | A second metadata step adds `latest-gpu` for real releases. |
| Vinayak | Home's "View Templates" opened "Page not found". | `#/templates` and `#/models` stub pages (part of R1.4). |

**Still open:** the rest of R1.4. The sidebar still shows History and Tools until it gets the five v2 items.

### Checked on `main` (2026-11-14)
- `npm run build` passes. Django `check` passes with no missing migrations. `bash -n scripts/privmeet.sh` passes, and the PowerShell parser accepts `privmeet.ps1`.
- **Smoke run** (runserver, `CELERY_EAGER=1`, low tier, headless Chrome), all passing:
  - upload, with notes and tags → processed
  - a bad extension gives 400, and a write without CSRF gives 403
  - search, audio Range (206), export.md
  - Q&A with a `[mm:ss]` citation
  - the features list, tags, action items, delete
- **Every route in all four themes** renders with no page errors: Home, Meetings, search, New Meeting, detail (also with `?t=`), Record, Settings, the old History page and the not-yet-built Templates page.
- **Not run here:**
  - Docker Compose (no Docker on this machine)
  - the desktop app (no Rust toolchain)
  - real cloud LLM accounts (no API keys)

## Day plan
| Day | Vinayak | Kashish | Karthik |
|---|---|---|---|
| 3 | T1.3 + **U1.3** Record / Live screen | T2.3 + **A2.3** launcher flow | T3.3 + **W3.3** build-installers workflow |
| 4 | T1.4 + **U1.4** UI backend + Home | T2.4 + **A2.4** mic/camera/screen in webview | T3.4 + **W3.4** Linux/Windows packaging |
| 5 | T1.5 + **U1.5** Settings | T2.5 + **A2.5** branding, single instance, About | T3.5 + **W3.5** CLI launchers + release docs |
| any | **R1.1 – R1.20** | **R2.1 – R2.20** | |
| 6 | T1.6 + **UT1.6** UI test pass | T2.6 + **AT2.6** desktop app test | T3.6 + **WT3.6** release dry run |

## Rules for every task
- Start a task only when its owner says "start <id>". AGENTS.md has the full protocol.
- Task A and task B of the same day are **separate branches and separate commits**. Every R task is its own branch too.
- One task = one new branch, named exactly as below. Commit only: no push, no PR, no co-author or AI trailers.
- **At least 4 commits per task**, one per logical step. Each message has a subject plus a body saying what changed, why and how it was checked (format in AGENTS.md step 7).
- Before starting, check that every "Needs" task is merged into `main`. If one is not, stop and tell the person.
- Only touch the files listed under "Files". Ask the person before editing anything else.
- **Day 6 is testing only.** It starts after all Day 1–5 tasks (A and B) of all three people **and all R tasks** are merged into `main`. If the team drops an R task, mark it `(cut)` in this file first.

## Working independently (Vinayak and Kashish)
Either person can do all of their tasks in one go. Nothing waits for the other person.
- **No cross "Needs".** A Vinayak task never needs an unmerged Kashish task, and the reverse. "Needs" lists only your own tasks, or tasks already on `main`.
- **No shared files.** The ownership table below gives every file one owner. Never edit the other person's file; ask them.
- **Build to the contracts, not to the other person's branch.** If the other half is not on `main` yet, your half must still build and run:
  - Read a new API field with a fallback (`meeting.notes ?? ""`).
  - Show a control for a new endpoint only when its **feature flag** is present (see "Feature flags"). Without the flag, hide the control. Never show a button that fails.
  - Do not import an export of the other person's file that is not on `main`. Use plain Tailwind and swap later.
- **Report** which paths you could not check because the other half is not merged. T2.6 and UT1.6 check them on Day 6.
- **Suggested order.** Vinayak: R1.1 to R1.6 (look), then R1.7 and R1.8 (backend base), then the rest in any order. Kashish: R2.1 first. T2.4 unlocks most page tasks and A2.3 unlocks the desktop ones.

### Ownership
| Owner | Files |
|---|---|
| **Vinayak** | `backend/**` (not `backend/meetings/tests/test_views.py`), `frontend/src/ui/**`, `frontend/src/layout/**`, `frontend/src/App.jsx`, `frontend/src/main.jsx`, `frontend/index.html`, `frontend/public/**`, `frontend/src/pages/{Home,RecordLive,Settings,Templates,Models}.jsx`, `frontend/src/record/**`, `docs/ui/**`, `docs/API.md`, `scripts/bench.py`, `compose.gpu.yml` |
| **Kashish** | `frontend/src/pages/{MeetingList,NewMeeting,MeetingDetail}.jsx`, `frontend/src/components/**` (not Karthik's three panels), `frontend/src/api.js`, `frontend/src/format.js`, `frontend/src/index.css`, `backend/meetings/tests/test_views.py`, `desktop/**` |
| **Karthik** | `frontend/src/components/{SummaryPanel,ActionItemsPanel,QABox}.jsx`, `Dockerfile`, `compose.yml`, `.env.example`, `.github/**`, `packaging/**`, `scripts/privmeet.*`, `README.md`, `docs/ARCHITECTURE.md`, `docs/RELEASING.md` |

- Only Vinayak adds models and migrations. A migration takes the next free number when its branch is made; renumber on rebase if another of his branches merged first.
- Nobody adds a frontend dependency. The Tauri plugins named in the A2 and R2 tasks are approved by this file.

## UI v2 spec (what "matches the mockup" means)
Read this with `docs/ui/mockup.webp` open. Hex values are sampled from the mockup.

**Themes.** Four presets, chosen in Settings → Appearance:
| id | Name | Caption | Kind | Page | Sidebar | Card | Accent |
|---|---|---|---|---|---|---|---|
| `indigo` | Indigo (Default) | Modern, professional, and focused. | dark | `#080C1A` | `#0E0F2A` | `#151D36` | `#4942E3` |
| `teal` | Teal | Clean and calm, great for long sessions. | dark | `#0E1D25` | `#0D1D26` | a step lighter than page | teal `#14B8A6`, active item `#085E56` |
| `amber` | Amber | Warm and minimal with high clarity. | dark | `#1E1A1D` | `#1D191D` | a step lighter than page | amber `#F59E0B`, active item `#6C441F` |
| `slate` | Slate (Light) | Clean, minimal light theme for everyday use. | light | `#EAECFC` | `#E6E9FB` | `#EDEEFD` to white | soft indigo, active item `#C6C6FC` |

- Brand palette: `#4942E3`, `#5B3CDD`, `#AFA1FC`, `#151F3A`, `#39466C`, `#E8E8F3`. Success green `#37C87C`.
- Indigo extras: search field `#191E3A`, primary button `#483FE1`, "Summary Ready" pill is green text on `#0F282D`, "Processed" pill is blue text on `#0E203B`.

**Brand.** A rounded gradient "P" mark (violet to indigo, lighter tail) plus the wordmark "PrivMeet". Tagline: "Your meetings. Your data. Your control." Sub-line: "Self-hosted AI meeting notes". Four logo variations: gradient on a dark tile, gradient on a white tile, mono outline, white on an indigo tile.

**Sidebar.** Logo, then exactly five items: Home, Meetings, Templates, Models, Settings. No group headings. The active item is a filled accent pill with white text. Bottom card: green dot, "Self-hosted", "Your data. Your server."

**Top bar.** Search field "Search meetings, notes...", a "Local AI" pill with a green dot, a settings gear button and a round avatar with the user's initials.

**Home.** A hero card ("Welcome back, <name>", "Turn your meetings into structured, actionable insights.", a "New Meeting" button, wave art in the accent color). A "Quick Actions" card (Start Recording / Begin a new meeting, Upload Audio / Process existing file, View Templates / Use a note template). "Recent Meetings": rows with an icon tile, the title, `Oct 28, 2026 · 42 min · 4 participants`, a status pill and a kebab.

**Meeting detail.** Breadcrumb "← Meetings > <title>", "Share" and "Download" outline buttons. Logo tile, title, `date · 42 min · 4 participants`. Tabs in this order: **Summary | Transcript | Action Items | Notes**. Summary tab: one card with "AI Summary" (sparkle icon, paragraph), a divider and "Key Points" (bullets). Right column: an "Action Items" card (checkbox, task, owner at the right, "+ Add Action Item") and a "Participants" card (avatar + name, two columns).

**Not in the sidebar any more.** Record / Live is reached from "Start Recording" and from New Meeting. History and the Tools pages are dropped; their useful parts moved:
| Old | Now |
|---|---|
| Tools → Transcription queue | Processing steps on the meeting (R2.10) and the list status filter (R2.11) |
| Tools → Summarization | "Regenerate summary" (R1.14, R2.12) |
| Tools → Action Items | Home and `GET /api/action-items/` (U1.4) |
| Tools → Integrations | Download and Share menus (R1.13, R2.5, R2.6) |
| History | Meetings list with date filter and sort (R2.11) |
| Meeting Info panel | Notes tab (R2.4) and Participants card (R2.3) |

## Contracts (so parallel work fits together)
- **`frontend/src/api.js`** (Kashish):
  - `api(path, {method, body})` sends a JSON request with the `X-CSRFToken` header, read from the `csrftoken` cookie. It returns the parsed JSON, or throws `Error(data.error)`.
  - `upload(path, formData, onProgress)` uses XHR, reports `onProgress(0..1)`, and resolves to JSON.
  - Vinayak's pages call `api()` directly for their own endpoints, so they never edit `api.js`.
- **`frontend/src/App.jsx`** (Vinayak) keeps the exports `navigate(to)` and `useRoute()` (`{path, query}`) unchanged. Kashish's pages use them.
- **Routes** (hash): `#/` Home, `#/meetings` (also `#/meetings?q=<text>`), `#/new` (also `#/new?template=<id>`), `#/m/<id>` (also `?t=<seconds>`), `#/record`, `#/templates`, `#/models`, `#/settings`.
- **`frontend/src/layout/AppShell.jsx`** (Vinayak) provides the sidebar, the top bar and the page frame. Pages render only their content.
- **Top-bar search** (R1.5) navigates to `#/meetings?q=<text>`. The Meetings page (R2.2) reads `q` from the route. Each side works without the other.
- **Shared UI:** every page uses the components in `frontend/src/ui/` and `lucide-react` icons. Props and export names in `src/ui` never change or disappear; the v2 re-skin only changes how they look.
- **Colors in pages:** use only `zinc-*` (neutrals), `primary-*` (accent) and the status tones through `Badge`, and keep pairing a light class with a `dark:` class as today. R1.1 remaps those scales per theme through CSS variables, so pages re-color with no edit.
- **Theme:** `<html data-theme="indigo|teal|amber|slate">`, stored in `localStorage.theme`. The three dark presets also set the `.dark` class. Default `indigo`.
- **Status pill:** `<Badge status={meeting.status} />`. For a `done` meeting with `has_summary === false`, pass `<Badge tone="blue" dot>Processed</Badge>`. This works before and after the re-skin.
- **`SummaryPanel.jsx`** (T3.4): `export default function SummaryPanel({ meeting, onSave })`. One card with "AI Summary" and "Key Points" (decisions).
  - `meeting` is the full JSON from `GET /api/meetings/<id>/`.
  - `onSave(patch)` sends a PATCH and resolves to the updated meeting.
- **`ActionItemsPanel.jsx`** (T3.4): `export default function ActionItemsPanel({ meeting, onSave, compact })`. Without `compact` it is the Action Items tab (table: checkbox, task, owner, due). With `compact` it is the right-column card (checkbox, task, owner, "+ Add Action Item").
- **`QABox.jsx`** (T3.4): `export default function QABox({ meetingId, onSeek })`. It sits under the transcript in the Transcript tab. `onSeek(seconds)` is called when the user clicks a `[mm:ss]` citation.
- `MeetingInfo.jsx` is no longer used. T2.4 deletes the stub.
- **Logo master:** `docs/ui/logo.svg` (R1.3). A2.5, R2.16 and W3.4 use it when it is on `main`; until then they keep `desktop/app-icon.png`.

### API (on `main` today, `backend/meetings/urls.py`)
- `GET|POST /api/meetings/`, `?q=` searches.
- `GET|PATCH|DELETE /api/meetings/<id>/`.
- `GET /api/meetings/<id>/audio` supports Range requests.
- `POST /api/meetings/<id>/ask`, `POST /api/meetings/<id>/retry`, `GET /api/meetings/<id>/export.md`.
- `GET /api/questions/<id>/`, `GET /api/system/`.

### API v2 (added by Vinayak's tasks; shapes are fixed here)
| Feature flag | Task | Adds |
|---|---|---|
| `settings` | R1.7 | `GET` and `PATCH /api/settings/` → `{display_name, llm_model, ollama_url, whisper_model, num_ctx, diarize, cpu_threads}` |
| `notes`, `tags`, `filters` | U1.4 | Meeting `notes` (string) and `tags` (list of strings). List rows add `speakers` (count), `has_summary` (bool), `tags`. `GET /api/meetings/?status=&tag=&from=&to=`. `GET /api/tags/` → `{tags: [{name, count}]}`. `GET /api/action-items/`. Upload accepts `notes` and `tags`. |
| `templates` | R1.9 | `GET` and `POST /api/templates/`; `GET`, `PATCH` and `DELETE /api/templates/<id>/` → `{id, name, description, instructions, builtin, is_default}`. Meeting `template` (id). Upload accepts `template`. |
| `models` | R1.11 | `GET /api/models/`, `POST /api/models/pull`, `DELETE /api/models/<name>` |
| `exports`, `share-page` | R1.13 | `GET /api/meetings/<id>/export.<fmt>`, `fmt` = `md`, `txt`, `json`, `srt`, `vtt`; `html` is the share page |
| `summarize` | R1.14 | `POST /api/meetings/<id>/summarize` with optional `{template}` |
| `transcript-edit`, `speaker-merge` | R1.15 | Segments carry `id`. `PATCH /api/segments/<id>/` with `{text?, speaker?}`. `POST /api/meetings/<id>/speakers/merge` with `{from, to}`. |
| `cancel` | R1.16 | `POST /api/meetings/<id>/cancel`. List rows add `queue_position` (int or null). |
| `language` | R1.17 | Upload accepts `language` (ISO code, empty = auto) and `translate` (`1` = to English) |
| `suggestions` | R1.18 | Meeting `speaker_suggestions` (`{"0": "Rohan"}`) |
| `storage` | R1.19 | `GET /api/storage/`, `DELETE /api/meetings/<id>/audio`, meeting `has_audio` (bool) |
| `backup` | R1.20 | `GET /api/backup.zip`, `POST /api/restore` |

### Feature flags
- `GET /api/system/` returns `features`, a list of the flags above that the running server supports (R1.7 adds the list; each backend task adds its own flag).
- The frontend asks `hasFeature("exports")` from `api.js` (R2.1). A missing list means no features.
- A field such as `notes` may also be detected with `"notes" in meeting`.

## How the desktop app works (decided)
- `desktop/src-tauri/` is a Tauri 2 shell. It uses the system webview (WebView2 or WebKitGTK), so no Electron and no extra RAM.
- On open, a small bundled **launcher page** (`desktop/launcher/`, plain HTML/JS) checks Docker and starts the stack with `docker compose up -d`. It runs a bundled `compose.yml` that uses the published image. When `/api/system/` answers, the window navigates to `http://127.0.0.1:8000`.
- The GPU override (`compose.gpu.yml`) is added automatically when `nvidia-smi` works.
- On quit, the app stops the stack unless "Keep running in background" is on.
- The React UI itself is served by Django, as in the main plan. The desktop app does not bundle a second copy.
- The app makes no request outside the machine except pulling Docker images and models.

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
- **Do:** v2 does not draw this screen. Keep the **layout** of the top screen in `docs/ui/mockup-v1.webp`, in the v2 look. The page is reached from "Start Recording" on Home and "Record instead" on New Meeting; it is not in the sidebar.
  - **Header:** editable title, date, a "Recording" status pill with a timer, and a Stop Recording button.
  - **Tiles:**
    - "You" shows the mic level with a Web Audio `AnalyserNode` and an optional camera preview.
    - With **Share** on, a second tile shows the shared tab or window.
    - There are no fake participants: other people appear as speakers after processing.
  - **Controls:** Mic (mute), Camera, Share, Record (start/pause/resume), More (input device picker, "include tab/system audio"), and Leave (stop + upload).
  - **Audio capture:** mix the mic plus the shared tab/system audio (`getDisplayMedia({audio: true})`) with a Web Audio `MediaStreamDestination`, then send it to `MediaRecorder` (`audio/webm;codecs=opus`). Video is recorded only when Camera is on.
    - This is how users record an online meeting (Meet, Zoom or Teams in a browser).
  - **Right panel:** while recording, a waveform and "Transcript appears when you stop". After stopping, upload with `upload()` and go to `#/m/<id>`.
  - **Notes column:** title, notes and tags typed during recording, sent with the upload as `title`, `notes` and `tags`. The server ignores the last two until U1.4 is merged.
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
  - Keep this page light. R2.9 adds the template picker, language and multi-file upload.
- **Done when:** an uploaded file creates a meeting that gets processed.

**Task B**

#### A2.3 · Launcher flow
- **Branch:** `d3/kashish/A2.3-launcher-flow`
- **Needs:** A2.2
- **Files:** `desktop/**`
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

#### U1.4 · UI backend + Home
- **Branch:** `d4/vinayak/U1.4-ui-backend-home`
- **Needs:** U1.2, T1.1, R1.7
- **Files:** `backend/meetings/models.py`, `backend/meetings/migrations/*` (next number), `backend/meetings/views.py`, `backend/meetings/urls.py`, `backend/meetings/search.py`, `docs/API.md`, `frontend/src/pages/Home.jsx`
- **Do:**
  - **Backend** (flags `notes`, `tags`, `filters`):
    - `Meeting.notes` (text) and `Meeting.tags` (JSON list of strings, max 10, 30 chars each). PATCH and upload accept both.
    - List rows add `speakers` (number of distinct speakers), `has_summary` and `tags`.
    - `GET /api/meetings/?status=&tag=&from=&to=` filters. `?q=` also matches notes and summary.
    - `GET /api/tags/`.
    - `GET /api/action-items/` returns all action items across meetings with the meeting id and title.
  - **Home** per the v2 mockup:
    - Hero card: "Welcome back, <display_name>" (just "Welcome back" when the name is empty), the sub-line, a "New Meeting" button to `#/new`, and wave art drawn with CSS or inline SVG in the accent color.
    - Quick Actions card: Start Recording (`#/record`), Upload Audio (`#/new`), View Templates (`#/templates`).
    - Recent Meetings: the 5 newest, each with an icon tile, title, `date · min · participants`, status pill and a kebab (Open, Download, Delete).
    - Poll every 2 s while a shown meeting is processing.
- **Done when:** notes and tags persist through the API, and Home matches the mockup with real data in all four themes.

### Kashish

**Task A**

#### T2.4 · Meeting detail: frame, player + transcript
- **Branch:** `d4/kashish/T2.4-meeting-detail`
- **Needs:** T2.2
- **Files:** `frontend/src/pages/MeetingDetail.jsx`, new files in `frontend/src/components/` (not SummaryPanel/ActionItemsPanel/QABox), delete `frontend/src/components/MeetingInfo.jsx`
- **Do:**
  - Poll `GET /api/meetings/<id>/` every 2 s while processing. Show stage + progress bar, the error and a Retry button when `failed`.
  - **Layout** per the v2 mockup:
    - Breadcrumb "← Meetings > <title>", then "Share" and "Download" outline buttons at the right. Until R2.5 and R2.6, Download links to `export.md` and Share copies the page link.
    - Logo tile, title, `date · min · participants`.
    - Tabs: **Summary | Transcript | Action Items | Notes**. The Notes tab is an empty panel until R2.4.
    - Right column: `<ActionItemsPanel meeting onSave compact />` and a simple participants list (R2.3 replaces it).
  - **Summary tab:** `<SummaryPanel meeting onSave />`.
  - **Transcript tab:** an `<audio>` player from `/api/meetings/<id>/audio`. The transcript list highlights the current segment, clicking a segment seeks, and the list auto-scrolls (pausable). `?t=` in the hash seeks on load and opens this tab. A "Search transcript…" box filters and highlights matches client-side. `<QABox meetingId onSeek />` sits under the transcript.
  - **Action Items tab:** `<ActionItemsPanel meeting onSave />`.
  - Speaker avatars with stable colors, from `src/ui` Avatar.
  - Remove the `MeetingInfo` import and delete its stub.
- **Done when:** the transcript and audio stay in sync on a 10-min meeting, and the page matches the mockup's detail screen.

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
  - Test with any page that calls `getUserMedia` if U1.3 is not merged yet.
- **Done when:** recording with the mic works inside the desktop app on Linux, and the Windows result is documented.

### Karthik

**Task A**

#### T3.4 · Summary, Action Items + Q&A panels
- **Branch:** `d4/karthik/T3.4-notes-ui`
- **Needs:** T2.1, U1.1
- **Files:** `frontend/src/components/SummaryPanel.jsx`, `frontend/src/components/ActionItemsPanel.jsx`, `frontend/src/components/QABox.jsx`
- **Do:** match the v2 mockup's detail screen, using `src/ui` components.
  - **SummaryPanel:** one card. "AI Summary" with a sparkle icon and the summary paragraph, a divider, then "Key Points" (decisions) as bullets. No export button: Download lives in the page header.
  - **ActionItemsPanel:**
    - Default: a table with checkbox, task, owner and due. Inline edit of task/owner/due, plus "Add Action Item" and delete.
    - `compact`: the right-column card from the mockup. Checkbox, task and owner per row, and a "+ Add Action Item" outline button.
    - Toggling `done` saves via `onSave({action_items})` in both.
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
  - `packaging/windows/` NSIS header/sidebar and WiX banner/dialog BMPs from the logo (`docs/ui/logo.svg` when it is on `main`, else `desktop/app-icon.png`), wired in `tauri.conf.json` as in GitPilot.
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

#### U1.5 · Settings
- **Branch:** `d5/vinayak/U1.5-settings`
- **Needs:** U1.4, R1.7
- **Files:** `frontend/src/pages/Settings.jsx`, `backend/meetings/views.py` (new view only), `backend/meetings/urls.py`, `docs/API.md`
- **Do:**
  - **Backend:** `POST /api/settings/test` calls Ollama `/api/tags` at the given URL and returns connected + the installed model list. The settings store itself comes from R1.7.
  - **Settings UI tabs** (layout from `mockup-v1.webp`, v2 look):
    - General: display name (shown on Home and as the avatar initials), default title format.
    - AI Model: the provider is Ollama only. Model select from the installed list, Server URL with Test Connection and a Connected status, and Advanced options (`num_ctx`, `cpu_threads`, diarization). A link to `#/models`.
    - Recording: default mic, include system audio, camera off by default. These three are stored in `localStorage`.
    - Appearance: the four theme cards from the mockup (mini preview, name, caption), with a ring on the selected one.
- **Done when:** changing the model in Settings changes the model used by the next processed meeting, and picking a theme card re-colors the whole app.

### Kashish

**Task A**

#### T2.5 · Detail actions + polish
- **Branch:** `d5/kashish/T2.5-polish`
- **Needs:** T2.4
- **Files:** `frontend/src/pages/{MeetingList,NewMeeting,MeetingDetail}.jsx`, `frontend/src/components/*` (not SummaryPanel/ActionItemsPanel/QABox), `frontend/src/index.css`
- **Do:**
  - Rename the meeting by clicking its title on the detail page (PATCH `title`).
  - Delete meeting from the detail page with a `src/ui` ConfirmDialog, then go to `#/meetings`.
  - Make your pages responsive for mobile widths (the right column drops under the tabs).
  - Check your pages in all four themes; fix any color that is not `zinc-*`, `primary-*` or a `Badge` tone.
  - Accessibility: labels, focus order, and keyboard play/pause (space) outside inputs.
- **Done when:** everything works on a phone-sized viewport and keyboard-only use.

**Task B**

#### A2.5 · Branding, single instance, About
- **Branch:** `d5/kashish/A2.5-branding`
- **Needs:** A2.3
- **Files:** `desktop/**`
- **Do:**
  - App icons from the PrivMeet logo (`npm run tauri icon <1024px png>`). Render the PNG from `docs/ui/logo.svg` when it is on `main`. If it is not, keep the current icon and say so in the report; the icon set is one command to redo later.
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

## v2 track: Vinayak (R1.1 – R1.20)
Look and shell first, then backend features. None of these needs a Kashish task.

#### R1.1 · Theme presets
- **Branch:** `v2/vinayak/R1.1-theme-presets`
- **Needs:** none
- **Files:** `frontend/src/ui/theme.css`, `frontend/src/ui/useTheme.js`, `frontend/src/ui/index.js`
- **Do:**
  - Four presets on `<html data-theme>`: `indigo` (default), `teal`, `amber`, `slate`. The three dark ones also set the `.dark` class, so every existing `dark:` class keeps working.
  - A preset only overrides CSS variables: `--color-primary-50…950` (accent) and `--color-zinc-50…950` (neutrals, tinted navy / deep teal / warm brown / cool slate). Use the hex values in "UI v2 spec". Pages need no edit.
  - Extra tokens for the hero wave and the active nav pill: `--pm-grad-from`, `--pm-grad-to`.
  - `useTheme()` returns `[theme, setTheme]` with the four ids. `applyTheme()` maps an old stored value: `light` → `slate`; `dark`, `system` or nothing → `indigo`.
  - Export `THEMES`: `[{id, name, caption, dark}]` with the mockup's names and captions.
- **Done when:** setting `data-theme` in DevTools re-colors the sidebar and the Meetings page with no page edits, and body text passes WCAG AA contrast in all four.

#### R1.2 · UI kit re-skin
- **Branch:** `v2/vinayak/R1.2-ui-reskin`
- **Needs:** R1.1
- **Files:** `frontend/src/ui/*`
- **Do:** change looks only. Every export and prop stays, so other people's pages keep building.
  - Card: 16 px radius, 1 px border, a surface one step lighter than the page, no heavy shadow on dark.
  - Button: primary is a solid accent with a soft gradient; secondary is the outline style of "Share", "Download" and "+ Add Action Item".
  - Badge: `done` reads "Summary Ready" (green). Add the status key `processed` ("Processed", blue).
  - Tabs: the active tab is filled with an accent underline, as "Summary" in the mockup.
  - Input, SearchInput, Select, Textarea: filled dark fields with a subtle border.
  - Menu, Modal, ConfirmDialog, EmptyState, ProgressBar, TagChip: v2 surfaces.
  - Avatar: the mockup's participant colors (indigo, cyan, pink, violet first).
- **Done when:** `npm run build` passes, no export was renamed or removed, and each component matches the mockup in all four themes.

#### R1.3 · Logo + brand assets
- **Branch:** `v2/vinayak/R1.3-logo-brand`
- **Needs:** none
- **Files:** `docs/ui/logo.svg`, `frontend/src/ui/Logo.jsx`, `frontend/src/ui/index.js`, `frontend/public/favicon.svg`, `frontend/index.html`
- **Do:**
  - Draw the gradient "P" mark as an SVG with a square 1024 viewBox: `docs/ui/logo.svg`. It is the master for the desktop icon and the installers.
  - `<Logo variant="gradient|light|mono|solid" size wordmark />` as inline SVG: the four "Logo Variations" in the mockup.
  - Favicon, page title "PrivMeet", and a `theme-color` meta.
  - Export `TAGLINE` ("Your meetings. Your data. Your control.") and `SUBLINE` ("Self-hosted AI meeting notes").
- **Done when:** the four variations match the mockup side by side, and the favicon shows in the browser tab.

#### R1.4 · Sidebar v2 + routes
- **Branch:** `v2/vinayak/R1.4-sidebar-routes`
- **Needs:** R1.3
- **Files:** `frontend/src/layout/Sidebar.jsx`, `frontend/src/App.jsx`, `frontend/src/pages/{Templates,Models}.jsx` (stubs), delete `frontend/src/pages/{History,Tools}.jsx`
- **Do:**
  - Nav items, exactly: Home, Meetings, Templates, Models, Settings. No group headings.
  - The active item is a filled accent pill with white text. Meetings is active on `meetings`, `new`, `m/<id>` and `record`.
  - Bottom card: green dot, "Self-hosted", "Your data. Your server."
  - Routes: add `#/templates` and `#/models`. Remove `#/history` and `#/tools/*`; old links go to `#/`.
  - Keep the `navigate` and `useRoute` exports as they are.
  - Keep the icon rail below 900 px and the phone drawer.
- **Done when:** every v2 route opens inside the shell, the sidebar matches the mockup, and Kashish's three pages still work.

#### R1.5 · Top bar
- **Branch:** `v2/vinayak/R1.5-top-bar`
- **Needs:** R1.4
- **Files:** `frontend/src/layout/TopBar.jsx` (new), `frontend/src/layout/AppShell.jsx`
- **Do:**
  - Search field "Search meetings, notes...". Enter navigates to `#/meetings?q=<text>`. `Ctrl/Cmd+K` focuses it.
  - "Local AI" pill: green dot when `/api/system/` answered, grey when not. Its tooltip names the model. It links to `#/models`.
  - Settings gear to `#/settings`.
  - Avatar with initials from `display_name` (`GET /api/settings/`); a user icon when the name is empty or the endpoint is missing.
  - A red "Recording" pill linking to `#/record` while `useRecording()` is true.
  - On phones the search collapses to an icon and the drawer button stays.
- **Done when:** the bar matches the mockup, and searching from any page lands on the Meetings page.

#### R1.6 · Feedback components
- **Branch:** `v2/vinayak/R1.6-feedback-components`
- **Needs:** R1.2
- **Files:** `frontend/src/ui/*`, `frontend/src/layout/AppShell.jsx` (mount the toaster)
- **Do:** add to `src/ui`:
  - `toast(message, tone)` and `<Toaster />` (an `aria-live` region; no dependency).
  - `Skeleton` (loading placeholder).
  - `Checkbox` (the square checkbox of the Action Items card).
  - `Breadcrumb` ("← Meetings > Project Sync").
  - `Tooltip`.
  - Other people keep plain Tailwind until this is on `main`, then swap in their next task.
- **Done when:** each component renders in all four themes, is keyboard reachable and has a visible focus ring.

#### R1.7 · Settings store, feature flags and API reference
- **Branch:** `v2/vinayak/R1.7-settings-flags-api`
- **Needs:** none
- **Files:** `backend/meetings/settings_store.py` (new), `backend/meetings/hw.py`, `backend/meetings/views.py`, `backend/meetings/urls.py`, `docs/API.md` (new)
- **Do:**
  - `settings_store`: `load()` and `save(patch)` for `DATA_DIR/settings.json`, written atomically. Allowed keys: `display_name` (60 chars), `llm_model`, `ollama_url`, `whisper_model`, `num_ctx`, `diarize`, `cpu_threads`. Reject unknown keys and wrong types.
  - `GET|PATCH /api/settings/`.
  - `hw.profile()` merges these overrides on top of the tier and env values. Re-read them at the start of every task, not cached forever.
  - `FEATURES` list in `views.py`; `GET /api/system/` returns it as `features`. This task adds `settings`. Every later backend task appends its flag.
  - `docs/API.md`: every endpoint with its request, response and flag. Every later backend task updates it in the same branch.
- **Done when:** a PATCH of `llm_model` changes the model in `/api/system/` and in the next processed meeting, and `features` is in the response.

#### R1.8 · Demo data command
- **Branch:** `v2/vinayak/R1.8-seed-demo`
- **Needs:** none
- **Files:** `backend/meetings/management/commands/seed_demo.py`
- **Do:**
  - `python manage.py seed_demo [--reset]` creates the mockup's meetings without Whisper or Ollama:
    - "Project Sync": 42 min, speakers Aryan, Rohan, Sneha and Vinayak, with the summary, key points and action items written in the mockup.
    - "Design Review": 36 min, 3 speakers, done.
    - "Team Sync": 51 min, 5 speakers, done with an empty summary (shows "Processed").
    - One `failed` meeting and one stuck at `transcribing` 40 %.
  - About 30 transcript lines per meeting.
  - Audio: silence of the stated length made with ffmpeg (`anullsrc`, opus at 8 kb/s, list args), so the player and seeking work.
  - Demo rows are marked with `tier_used="demo"`. `--reset` deletes only those. Running twice adds nothing.
- **Done when:** on an empty database the command makes Home and the detail page show the mockup's content.

#### R1.9 · Note templates: backend
- **Branch:** `v2/vinayak/R1.9-templates-backend`
- **Needs:** R1.7
- **Files:** `backend/meetings/models.py`, `backend/meetings/migrations/*`, `backend/meetings/note_templates.py` (new), `backend/meetings/views.py`, `backend/meetings/urls.py`, `backend/meetings/pipeline/llm.py`, `backend/meetings/tasks.py`, `backend/meetings/settings_store.py`, `docs/API.md`
- **Do:** (flag `templates`)
  - Built-in templates as constants in `note_templates.py`: General, Stand-up, One-on-one, Client call, Interview, Lecture. Each has a slug id, name, description and `instructions` (what the summary should focus on).
  - `NoteTemplate` model for the user's own templates (name ≤ 60, description ≤ 200, instructions ≤ 2000).
  - `GET|POST /api/templates/` and `GET|PATCH|DELETE /api/templates/<id>/`. Built-ins are read-only.
  - `Meeting.template` (id as a string). Upload accepts `template`. The default comes from the settings key `default_template`.
  - `llm.py` adds the template's instructions to the summary prompt. The JSON output shape (`summary`, `decisions`, `action_items`) does not change.
- **Done when:** the same recording summarized with "Stand-up" and "Client call" gives clearly different summaries on the low tier.

#### R1.10 · Templates page
- **Branch:** `v2/vinayak/R1.10-templates-page`
- **Needs:** R1.9, R1.4
- **Files:** `frontend/src/pages/Templates.jsx`
- **Do:**
  - A grid of template cards: icon, name, description, a "Default" pill and a "Built-in" tag.
  - "New Template" opens a Modal with name, description and instructions. Own templates can be edited and deleted (ConfirmDialog).
  - "Set as default" on any card.
  - "Use" goes to `#/new?template=<id>`.
- **Done when:** a template made here is offered by the API, and the page matches the v2 look in all four themes.

#### R1.11 · Models: backend
- **Branch:** `v2/vinayak/R1.11-models-backend`
- **Needs:** R1.7
- **Files:** `backend/meetings/views.py`, `backend/meetings/urls.py`, `backend/meetings/tasks.py`, `backend/meetings/hw.py`, `docs/API.md`
- **Do:** (flag `models`)
  - `GET /api/models/` returns the tier, RAM and GPU; the Whisper sizes with the current one and which are already downloaded; the Ollama models that are installed (name, size), the current one and the tier's recommended one; the diarization state; and the running pull (`{model, percent, status}` or null).
  - Recommended names come from `hw.TIERS`. No model name is written anywhere else.
  - `POST /api/models/pull` with `{model}` starts a Celery task that streams Ollama `/api/pull` and writes progress to a file in `DATA_DIR`. One pull at a time. Validate the name against `^[\w.\-/:]+$`.
  - `DELETE /api/models/<name>` calls Ollama `/api/delete`. Refuse to delete the model in use.
  - The pull goes through the worker queue, so it never runs beside a transcription.
- **Done when:** pulling a small model shows rising progress in `GET /api/models/` and the model then appears as installed.

#### R1.12 · Models page
- **Branch:** `v2/vinayak/R1.12-models-page`
- **Needs:** R1.11, R1.4
- **Files:** `frontend/src/pages/Models.jsx`
- **Do:**
  - Hardware card: tier, RAM, GPU or CPU.
  - Speech-to-text card: Whisper sizes with a RAM hint each; pick one (PATCH `/api/settings/`).
  - Summaries card: installed Ollama models, pick one, delete one, and a "Download model" field with a progress bar. Poll every 2 s only while a pull runs.
  - Speakers card: diarization on/off and whether its models are present.
  - Warn when the picked model is larger than the tier recommends.
- **Done when:** picking a model here changes `/api/system/`, and a pull can be watched to the end.

#### R1.13 · Export formats + share page
- **Branch:** `v2/vinayak/R1.13-exports`
- **Needs:** R1.7
- **Files:** `backend/meetings/export.py` (new), `backend/meetings/views.py`, `backend/meetings/urls.py`, `docs/API.md`
- **Do:** (flags `exports`, `share-page`)
  - `GET /api/meetings/<id>/export.<fmt>`: `md` (as today), `txt`, `json` (the full meeting), `srt` and `vtt` (one cue per segment, with the speaker name).
  - `html`: one self-contained page with the title, date, summary, key points, action items, notes and transcript. Inline CSS only, no script, no outside request. Escape every value.
  - Move the Markdown builder into `export.py` and keep its output the same.
- **Done when:** the SRT loads in VLC next to the audio, and the HTML page opens from disk with no network.

#### R1.14 · Regenerate summary
- **Branch:** `v2/vinayak/R1.14-resummarize`
- **Needs:** R1.7
- **Files:** `backend/meetings/tasks.py`, `backend/meetings/views.py`, `backend/meetings/urls.py`, `docs/API.md`
- **Do:** (flag `summarize`)
  - `POST /api/meetings/<id>/summarize` with optional `{template}`. It sets status `summarizing` and runs only the LLM stage on the stored segments. No ffmpeg, Whisper or diarization.
  - 409 when the meeting is processing or has no segments.
  - `template` is used once R1.9 is merged; before that it is ignored.
  - On failure the old summary stays.
- **Done when:** a 10-min meeting gets a new summary in a fraction of the full pipeline time, and Whisper is never loaded (check the worker log).

#### R1.15 · Transcript edit + speaker merge
- **Branch:** `v2/vinayak/R1.15-transcript-edit`
- **Needs:** R1.7
- **Files:** `backend/meetings/views.py`, `backend/meetings/urls.py`, `docs/API.md`
- **Do:** (flags `transcript-edit`, `speaker-merge`)
  - Segments in the meeting JSON carry `id`.
  - `PATCH /api/segments/<id>/` with `{text?, speaker?}`. Text up to 2000 chars; `speaker` is a speaker number of that meeting or null.
  - `POST /api/meetings/<id>/speakers/merge` with `{from, to}` moves every segment of `from` to `to` and drops the `from` name.
  - 409 while the meeting is processing.
- **Done when:** an edited line shows in search and in the exports, and merging two speakers leaves one name in the transcript.

#### R1.16 · Cancel + queue position
- **Branch:** `v2/vinayak/R1.16-cancel-queue`
- **Needs:** R1.7
- **Files:** `backend/meetings/models.py`, `backend/meetings/migrations/*`, `backend/meetings/tasks.py`, `backend/meetings/pipeline/transcribe.py`, `backend/meetings/views.py`, `backend/meetings/urls.py`, `docs/API.md`
- **Do:** (flag `cancel`)
  - `Meeting.cancel_requested` (bool). `POST /api/meetings/<id>/cancel` sets it; 409 when the meeting is not processing.
  - The task checks the flag before each stage and between Whisper segment batches. On cancel it stops, sets `failed` with the error "Cancelled." and removes the temp WAV. No new status value.
  - Retry clears the flag.
  - List rows add `queue_position`: how many queued meetings are ahead (null when not queued).
- **Done when:** cancelling during transcription stops the worker within a few seconds, and the next queued meeting starts.

#### R1.17 · Language + translate
- **Branch:** `v2/vinayak/R1.17-language`
- **Needs:** R1.7
- **Files:** `backend/meetings/models.py`, `backend/meetings/migrations/*`, `backend/meetings/pipeline/transcribe.py`, `backend/meetings/tasks.py`, `backend/meetings/views.py`, `docs/API.md`
- **Do:** (flag `language`)
  - Upload accepts `language` (an ISO code Whisper knows; empty means auto-detect) and `translate` (`1` runs Whisper with `task="translate"`, giving English text).
  - Store both on the meeting (`language_hint`, `translate`). `language` keeps holding what Whisper detected.
  - Reject an unknown code with 400.
- **Done when:** a Hindi clip uploaded with `language=hi` is transcribed in Hindi, and with `translate=1` in English.

#### R1.18 · Auto title + speaker name suggestions
- **Branch:** `v2/vinayak/R1.18-llm-suggestions`
- **Needs:** T1.3, R1.7
- **Files:** `backend/meetings/models.py`, `backend/meetings/migrations/*`, `backend/meetings/pipeline/llm.py`, `backend/meetings/tasks.py`, `backend/meetings/views.py`, `docs/API.md`
- **Do:** (flag `suggestions`)
  - Ask for two more keys in the **same** summary call, so no extra LLM pass runs: `title` and `speakers` (`{"Speaker 1": "Rohan"}`).
  - Title: use it only when the upload had no title (`Meeting.auto_title`, set at upload). Max 80 chars.
  - Speakers: keep a suggestion only when that name appears in the transcript text. Save as `speaker_suggestions` (`{"0": "Rohan"}`). Never write `speaker_names` from the model; the user accepts a suggestion in the UI.
  - Bad or missing keys are ignored; the summary must not fail because of them.
- **Done when:** a recording where people use each other's names gets correct suggestions on the mid tier, and an untitled upload gets a sensible title.

#### R1.19 · Storage + audio retention
- **Branch:** `v2/vinayak/R1.19-storage`
- **Needs:** R1.7, R1.12
- **Files:** `backend/meetings/views.py`, `backend/meetings/urls.py`, `backend/meetings/tasks.py`, `backend/meetings/settings_store.py`, `docs/API.md`, `frontend/src/pages/Models.jsx`
- **Do:** (flag `storage`)
  - `GET /api/storage/`: bytes used by audio, by models (Whisper cache, diarization) and by the database, plus free disk space.
  - `DELETE /api/meetings/<id>/audio` removes the audio file and keeps the notes and transcript. Meeting JSON gains `has_audio`. The audio endpoint then answers 404.
  - Settings key `keep_audio` (default true). When false, the audio is deleted once the meeting is `done`.
  - A Storage card on the Models page with the numbers and the `keep_audio` switch.
- **Done when:** the numbers match `du` within a few percent, and a meeting without audio still opens, searches and exports.

#### R1.20 · Backup + restore
- **Branch:** `v2/vinayak/R1.20-backup`
- **Needs:** R1.7, U1.5
- **Files:** `backend/meetings/backup.py` (new), `backend/meetings/views.py`, `backend/meetings/urls.py`, `docs/API.md`, `frontend/src/pages/Settings.jsx`
- **Do:** (flag `backup`)
  - `GET /api/backup.zip?audio=0|1` streams a zip: `meetings.json` (meetings, segments, questions, templates, settings) and, when asked, the audio files.
  - `POST /api/restore` takes that zip. Meetings are matched by uuid; existing ones are skipped, never overwritten.
  - Safety: cap the upload size, read only the known member names, never extract a path from the zip, and validate every field as the normal API does.
  - A "Your data" block in Settings → General: Download backup (with or without audio) and Restore from backup.
- **Done when:** a backup restored into an empty database gives the same meetings, transcripts and notes, and a zip with a `../` path is rejected.

---

## v2 track: Kashish (R2.1 – R2.20)
Meeting pages first, then the desktop app. None of these needs a Vinayak task. Where a task uses a v2 API, it follows "Working independently": hide the control until the flag is there.

#### R2.1 · API helpers v2 + feature flags
- **Branch:** `v2/kashish/R2.1-api-v2`
- **Needs:** none
- **Files:** `frontend/src/api.js`, `frontend/src/format.js`
- **Do:**
  - `getSystem()` keeps one shared promise, so the app asks `/api/system/` once per page load.
  - `hasFeature(key)` and a `useFeatures()` hook (a Set that fills in when the request returns). No `features` in the response means an empty Set.
  - One small helper per v2 endpoint in "API v2" that your tasks use (templates, summarize, segments, merge, cancel, tags), and `exportUrl(id, fmt)`.
  - `format.js`: `minutes(seconds)` → "42 min", `shortDate(iso)` → "Oct 28, 2026", `participants(meeting)` (uses `speakers`, else `speaker_names`, else the segments), and `statusBadge(meeting)` → the Badge props from the "Status pill" contract.
- **Done when:** `npm run build` passes, and against today's backend `useFeatures()` is empty and nothing breaks.

#### R2.2 · Meetings list v2
- **Branch:** `v2/kashish/R2.2-list-v2`
- **Needs:** R2.1
- **Files:** `frontend/src/pages/MeetingList.jsx`, `frontend/src/components/MeetingRow.jsx`, `frontend/src/components/meetingGroups.js`
- **Do:**
  - Rows as "Recent Meetings" in the mockup: icon tile (a people icon from 5 participants up), title, `Oct 28, 2026 · 42 min · 4 participants`, status pill at the right, kebab.
  - Read `q` from `#/meetings?q=<text>` into the search box (the top bar sends it) and keep the hash in sync while typing, without adding history entries.
  - Keep the day groups, the 2 s poll, the transcript hits and the empty states.
- **Done when:** opening `#/meetings?q=budget` shows the filtered list with "budget" in the box, and rows match the mockup.

#### R2.3 · Participants card
- **Branch:** `v2/kashish/R2.3-participants`
- **Needs:** T2.4
- **Files:** `frontend/src/components/ParticipantsCard.jsx` (new), `frontend/src/pages/MeetingDetail.jsx`
- **Do:**
  - The right-column card of the mockup: avatar + name in two columns, stable colors.
  - Click a name to rename it in place (PATCH `speaker_names`). Enter saves, Esc cancels.
  - Talk time per person as a percentage, from the segments.
  - When `speaker_suggestions` has a name for a speaker, show "Rename to <name>?" with accept and dismiss.
  - With the `speaker-merge` flag: "Merge into…" in a small menu, behind a ConfirmDialog.
- **Done when:** a rename shows at once in the transcript and survives a reload.

#### R2.4 · Notes tab
- **Branch:** `v2/kashish/R2.4-notes-tab`
- **Needs:** T2.4
- **Files:** `frontend/src/components/NotesTab.jsx` (new), `frontend/src/pages/MeetingDetail.jsx`
- **Do:**
  - A notes editor that autosaves 800 ms after typing stops (`onSave({notes})`), with a "Saving… / Saved" hint. Save on blur and before leaving the page too.
  - Tags under it: add with Enter, remove with the chip's ×. Max 10 tags, 30 chars each (`onSave({tags})`).
  - Without the `notes` flag: the editor is disabled with the line "Notes need a newer PrivMeet server."
- **Done when:** with the flag absent the tab is disabled and nothing errors; with it present notes and tags survive a reload.

#### R2.5 · Download menu
- **Branch:** `v2/kashish/R2.5-download-menu`
- **Needs:** T2.4, R2.1
- **Files:** `frontend/src/components/DownloadMenu.jsx` (new), `frontend/src/components/exportCsv.js` (new), `frontend/src/pages/MeetingDetail.jsx`, `frontend/src/components/MeetingRow.jsx`
- **Do:**
  - **The menu.** The "Download" button opens a Menu: Markdown (always) and Audio file (the original upload).
  - **Server formats.** With the `exports` flag also: Plain text, Subtitles (SRT), Subtitles (VTT) and JSON.
  - **PDF:** "PDF (print / save)" opens the print view from R2.15 (`printMeeting.js`), where the browser's "Save as PDF" makes the file. Hide the entry until R2.15 is on `main`.
  - **Action items (CSV):** columns Task, Owner, Due, Done, Meeting, Date. One row per action item, for spreadsheets or a Jira/Trello import.
  - **Transcript (CSV):** columns Start (`mm:ss`), End, Speaker (the saved name, else "Speaker N") and Text.
  - **How the CSVs are built** (in `exportCsv.js`):
    - In the browser from the meeting JSON: no request, no flag, no new dependency. They work against today's backend.
    - RFC 4180 quoting (commas, quotes and newlines inside a field).
    - A UTF-8 BOM, so Excel shows accents and other scripts correctly.
    - Any cell that starts with `=`, `+`, `-` or `@` gets a leading `'`, so a spreadsheet never runs meeting text as a formula.
  - **Grouping:** Notes (PDF, Markdown, Plain text, JSON), Transcript (SRT, VTT, CSV), Action items (CSV), Audio file. Empty groups are hidden: a meeting with no action items has no action-items CSV.
  - Hide "Audio file" when `has_audio === false`.
  - The list row's kebab uses the same component in place of its own export code.
  - **Not in this task:** Word/ODT (needs a library, so ask first), calendar `.ics` (due dates are free text), and audio as MP3/Opus (needs a backend endpoint).
- **Done when:**
  - every shown entry downloads a file with the meeting's title as its name;
  - both CSVs open correctly in Excel and LibreOffice, including commas, quotes, line breaks and non-English text;
  - a cell starting with `=` stays plain text;
  - "PDF" opens the print dialog.

#### R2.6 · Share menu
- **Branch:** `v2/kashish/R2.6-share-menu`
- **Needs:** T2.4, R2.1
- **Files:** `frontend/src/components/ShareMenu.jsx` (new), `frontend/src/pages/MeetingDetail.jsx`
- **Do:**
  - "Copy summary": title, date, summary, key points and action items as plain text to the clipboard, with a fallback when `navigator.clipboard` is missing.
  - "Copy link", with the hint "Opens only on this computer".
  - "Share…" through `navigator.share` where the browser has it.
  - With the `share-page` flag: "Download share page (.html)", a file that can be sent to someone.
  - A short "Copied" confirmation.
- **Done when:** the copied summary pastes cleanly into an email, in Chrome and Firefox.

#### R2.7 · Transcript tools
- **Branch:** `v2/kashish/R2.7-transcript-tools`
- **Needs:** T2.4
- **Files:** new files in `frontend/src/components/`, `frontend/src/pages/MeetingDetail.jsx`
- **Do:**
  - Speaker filter chips above the transcript.
  - Search shows the match count; Enter and Shift+Enter jump to the next and previous match.
  - Copy one line, or the whole transcript with timestamps.
  - With the `transcript-edit` flag: edit a line's text in place and move a line to another speaker (PATCH `/api/segments/<id>/`). Show the server's error and restore the old text when the save fails.
- **Done when:** filter and search work together on a 10-min meeting without lag.

#### R2.8 · Audio player
- **Branch:** `v2/kashish/R2.8-player`
- **Needs:** T2.4
- **Files:** `frontend/src/components/Player.jsx` (new), `frontend/src/pages/MeetingDetail.jsx`
- **Do:**
  - Own controls over a hidden `<audio>`: play/pause, a seek bar that shows the buffered part, current and total time, back and forward 10 s, speed (0.75, 1, 1.25, 1.5, 2; remembered in `localStorage`) and volume.
  - Every control has a label and works from the keyboard.
  - It keeps the `seek(seconds)` behavior T2.4 uses, and stays visible while the transcript scrolls.
  - When `has_audio === false`, show "Audio was removed. Notes and transcript are kept."
- **Done when:** seeking works in Chrome and Firefox on a 10-min meeting, and the player looks right in all four themes.

#### R2.9 · New Meeting v2
- **Branch:** `v2/kashish/R2.9-new-meeting-v2`
- **Needs:** T2.3, R2.1
- **Files:** `frontend/src/pages/NewMeeting.jsx`, new files in `frontend/src/components/`
- **Do:**
  - The page in the v2 look: an upload card and a "Record instead" card.
  - With the `templates` flag: a template picker from `GET /api/templates/`, preselecting `?template=<id>` or the default. Sent as `template`.
  - With the `language` flag: a language select (Auto first) and "Translate to English". Sent as `language` and `translate`.
  - Several files at once: a queue, uploaded one after another with a progress bar each. One file goes to `#/m/<id>`; several go to `#/meetings`.
  - A file that fails stays in the queue with its error and a Retry button.
- **Done when:** three files dropped together become three meetings, and without the flags the page is the plain upload form.

#### R2.10 · Processing view
- **Branch:** `v2/kashish/R2.10-processing-steps`
- **Needs:** T2.4
- **Files:** `frontend/src/components/ProcessingSteps.jsx` (new), `frontend/src/pages/MeetingDetail.jsx`
- **Do:**
  - Steps shown in order: Queued, Converting, Transcribing, Finding speakers, Summarizing. The current one is marked, with the percentage and the elapsed time.
  - "<n> meetings ahead" when `queue_position` is present.
  - With the `cancel` flag: a Cancel button behind a ConfirmDialog.
  - Failed: the error and Retry.
  - "Notify me when it is ready": asks for browser notification permission on click and sends one notification when the status becomes `done` or `failed`. Hide it where `Notification` is not supported.
- **Done when:** the steps follow a real upload from queued to done, and the notification arrives with the tab in the background.

#### R2.11 · List filters, sort and bulk actions
- **Branch:** `v2/kashish/R2.11-list-filters`
- **Needs:** R2.2
- **Files:** `frontend/src/pages/MeetingList.jsx`, new files in `frontend/src/components/`
- **Do:**
  - Status filter: All, Processing, Ready, Failed. Date filter: Today, Last 7 days, Last 30 days, a custom range.
  - With the `filters` flag the filters go to the server (`?status=&from=&to=`). Without it, filter the loaded list in the browser.
  - With the `tags` flag: a Tags filter from `GET /api/tags/`.
  - Sort: Newest, Oldest, Longest, Title.
  - Select mode: checkboxes on rows, then Delete selected (ConfirmDialog with the count) and Download selected (Markdown each).
  - Keep filters and sort in the hash query, so a reload keeps them.
- **Done when:** filters, sort and search combine correctly, with and without the server flag.

#### R2.12 · Regenerate summary
- **Branch:** `v2/kashish/R2.12-regenerate`
- **Needs:** T2.4, R2.1
- **Files:** `frontend/src/components/RegenerateDialog.jsx` (new), `frontend/src/pages/MeetingDetail.jsx`
- **Do:**
  - "Regenerate summary" in the detail page's kebab opens a Modal.
  - With the `templates` flag, the Modal offers the template to use.
  - With the `summarize` flag it calls `POST /summarize`. Without it, it calls `POST /retry` and says clearly that the whole recording is transcribed again.
  - The 2 s poll starts again and the Summary tab updates when done.
- **Done when:** both paths end with a new summary on screen.

#### R2.13 · Keyboard shortcuts + help
- **Branch:** `v2/kashish/R2.13-shortcuts`
- **Needs:** T2.4
- **Files:** `frontend/src/components/shortcuts.js` (new), `frontend/src/components/ShortcutsDialog.jsx` (new), your three pages
- **Do:**
  - List: `/` focuses search, `n` opens New Meeting, arrow keys move between rows, Enter opens.
  - Detail: space plays or pauses, left and right skip 10 s, `1` to `4` switch tabs, `e` renames the title.
  - `?` opens a dialog listing the shortcuts.
  - No shortcut fires while typing in an input, textarea or select, and none uses `Ctrl/Cmd+K` (the top bar owns it).
- **Done when:** the list and detail pages can be used without a mouse.

#### R2.14 · Loading and error states
- **Branch:** `v2/kashish/R2.14-states`
- **Needs:** R2.1
- **Files:** `frontend/src/components/PageBoundary.jsx` (new), new files in `frontend/src/components/`, your three pages
- **Do:**
  - `PageBoundary`: a React error boundary around each of your pages. A render error shows a message and a Reload button instead of a blank screen (the bug class fixed in `c514e16`).
  - Skeleton rows for the list and a skeleton for the detail page while the first request runs.
  - A "Cannot reach PrivMeet" banner when a request fails at the network level. It retries by itself every 5 s and disappears when the server answers.
  - A "Meeting not found" state for a wrong id, with a link to the list.
- **Done when:** stopping the backend shows the banner, starting it again clears it, and a thrown error in a row no longer blanks the page.

#### R2.15 · Print view
- **Branch:** `v2/kashish/R2.15-print`
- **Needs:** T2.4
- **Files:** `frontend/src/components/printMeeting.js` (new), `frontend/src/components/DownloadMenu.jsx` or `frontend/src/pages/MeetingDetail.jsx`
- **Do:**
  - "Print / Save as PDF" builds a print-only document from the meeting JSON and opens the browser's print dialog: title, date, participants, summary, key points, action items, notes, transcript.
  - Build it with DOM nodes and `textContent`. Never put meeting text into `innerHTML`.
  - Dark text on white, whatever the app theme, with sensible page breaks.
  - No new dependency.
- **Done when:** "Save as PDF" gives a clean document in Chrome and Firefox.

#### R2.16 · Launcher re-skin v2
- **Branch:** `v2/kashish/R2.16-launcher-v2`
- **Needs:** A2.3
- **Files:** `desktop/launcher/*`
- **Do:**
  - The launcher in the v2 look, with the Indigo values from "UI v2 spec" as CSS variables and the Slate values under `prefers-color-scheme: light`.
  - The "P" mark (inline copy of `docs/ui/logo.svg` when it is on `main`, the current mark until then), "PrivMeet" and the tagline "Your meetings. Your data. Your control."
  - The steps as a list with a state each (waiting, running, done, failed).
  - Still plain HTML, CSS and JS: no React and no build step.
- **Done when:** the launcher looks like one product with the web UI in dark and light.

#### R2.17 · System tray
- **Branch:** `v2/kashish/R2.17-tray`
- **Needs:** A2.3
- **Files:** `desktop/src-tauri/**`
- **Do:**
  - A tray icon using Tauri's `tray-icon` feature.
  - Menu: Open PrivMeet, a status line (Running / Stopped), Start or Stop PrivMeet, Quit.
  - With "Keep running in background" on, closing the window hides it to the tray. Quit from the tray follows the same stop rule as A2.3.
  - A left click shows the window.
- **Done when:** on Linux the tray starts, stops and reopens the app; the Windows result is documented.

#### R2.18 · First-run checks
- **Branch:** `v2/kashish/R2.18-first-run`
- **Needs:** A2.3
- **Files:** `desktop/src-tauri/src/*`, `desktop/launcher/*`
- **Do:** check before starting, each with a plain message and what to do:
  - Free disk space under about 6 GB: warn before the first download.
  - Port 8000: if PrivMeet already answers there, reuse it. If something else holds the port, say so and do not start.
  - Docker memory under 4 GB (`docker info`): warn that long meetings may fail.
  - During the first run, turn the compose pull output into "Downloading <n> of <m> parts" instead of raw log lines.
- **Done when:** each check can be triggered on purpose and shows its message.

#### R2.19 · Desktop settings
- **Branch:** `v2/kashish/R2.19-desktop-settings`
- **Needs:** A2.3
- **Files:** `desktop/launcher/*`, `desktop/src-tauri/**`
- **Do:** a settings panel behind a gear on the launcher, saved in the app data dir:
  - Keep running in background (the A2.3 setting moves here).
  - Start on login, with `tauri-plugin-autostart`.
  - GPU: Auto or Off (Off never adds `compose.gpu.yml`).
  - Version: latest, or a pinned `PRIVMEET_VERSION`.
  - Open data folder and Open logs folder.
  - "Delete all PrivMeet data" (`docker compose down -v`) only after the user types DELETE in a confirm box.
- **Done when:** each setting survives a restart and changes the next start of the stack.

#### R2.20 · Diagnostics and help
- **Branch:** `v2/kashish/R2.20-diagnostics`
- **Needs:** A2.3
- **Files:** `desktop/launcher/*`, `desktop/src-tauri/src/*`
- **Do:**
  - "Copy diagnostics": app version, OS, Docker and Compose versions, `docker compose ps` and the last 200 log lines. No meeting titles or text.
  - "Save logs to file".
  - "Check for updates" opens the GitHub releases page in the browser and shows the installed version next to it. The app itself makes no request.
  - "Report a problem" opens a new GitHub issue with the diagnostics template filled in.
- **Done when:** the copied text is enough to tell why a start failed, and nothing in it comes from a meeting.

---

## Day 6: testing (only after ALL Day 1–5 tasks and ALL R tasks are merged into `main`)

### Vinayak

**Task A**

#### T1.6 · Backend unit tests
- **Branch:** `d6/vinayak/T1.6-unit-tests`
- **Files:** `backend/pytest.ini`, `backend/requirements-dev.txt`, `backend/meetings/tests/test_*.py` (not `test_views.py`)
- **Do:** pytest + pytest-django on SQLite. Cover:
  - `hw.build_profile`: tiers, env overrides, settings overrides, forced high without CUDA.
  - `diarize.assign_speakers`: overlap, no overlap gives None.
  - `llm.parse_notes`: bad JSON, missing keys, wrong types, the `title` and `speakers` keys.
  - `llm.split` sizes.
  - `search.excerpts`: full vs. retrieval.
  - `settings_store`: unknown keys and wrong types rejected.
  - v2 endpoints with the pipeline mocked: templates, exports (SRT timing, HTML escaping), summarize, segment edit, speaker merge, cancel, backup and restore (including a `../` path).
  - A smoke test that runs real Whisper `base` on a short sample. Skip it when the sample file is absent.
- **Done when:** `pytest` passes, and any bugs found are fixed in this branch.

**Task B**

#### UT1.6 · UI test pass
- **Branch:** `d6/vinayak/UT1.6-ui-tests`
- **Files:** `docs/testing/ui.md`, plus fixes in your own UI files
- **Do:** with `seed_demo` data, compare every screen to `docs/ui/mockup.webp`:
  - In all four themes.
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
  - Run a manual checklist in Chrome and Firefox and record the results in `docs/testing/frontend.md`. Include every flag-gated control from the R2 tasks, now that the backend has the flags.
- **Done when:** the tests pass and the checklist is filled.

**Task B**

#### AT2.6 · Desktop app test
- **Branch:** `d6/kashish/AT2.6-desktop-test`
- **Files:** `docs/testing/desktop.md`, plus fixes in `desktop/**`
- **Do:**
  - Install the built `.deb`/AppImage on Linux and `.msi`/`.exe` on Windows if anyone has it.
  - Run: cold start, record with the mic, upload a file, quit, then reopen to check the "keep running" setting.
  - Check that a second instance focuses the window, and the Docker-missing path.
  - Check the tray, start on login, the first-run checks and Copy diagnostics.
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
