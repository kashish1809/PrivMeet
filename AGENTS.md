# PrivMeet: agent rules

These rules apply to every AI coding agent working in this repo (OpenCode, Claude Code, others).

PrivMeet is a self-hosted meeting notes app. You upload or record audio and get back a transcript, speaker labels, a summary, decisions, action items, search and Q&A. Everything runs locally.
- Design: `docs/PLAN.md`
- Tasks (two per person per day): `docs/TASKS.md`
- UI mockup: `docs/ui/mockup.webp`

## Team
| Person | Name | Task A (main) | Task B (second) |
|---|---|---|---|
| Person 1 | Vinayak | Backend pipeline + AI (`T1.x`) | Heavy UI per mockup (`U1.x`) |
| Person 2 | Kashish | React frontend pages (`T2.x`) | Tauri desktop app + launcher (`A2.x`) |
| Person 3 | Karthik | Docker, Postgres, security, notes UI, docs (`T3.x`) | GitHub workflows, packaging, CLI launchers (`W3.x`) |

Each day every person has task A and task B. They are separate branches and separate commits.

## Task protocol (follow exactly)
1. **Wait for "start".** Never start, continue or pick a task on your own. Begin only when the person says something like "start T2.3" or "I'm Kashish, start my day 3 task".
2. **Know who is speaking.** If the person has not said their name, ask: "Are you Vinayak, Kashish or Karthik?" If the task belongs to someone else, say whose it is and ask for confirmation before going on.
3. **Read the task** in `docs/TASKS.md`. Check that every task under "Needs" is merged into `main`: its files exist on `main`, or `git log main` shows it. If one is missing, stop and tell the person which one. Day 6 tasks need **all** Day 1–5 tasks (A and B) merged.
4. **Branch from fresh main:**
   ```
   git checkout main
   git pull --ff-only   # skip if there is no remote; never push
   git checkout -b <branch name from TASKS.md>
   ```
   If the working tree is dirty, stop and ask the person what to do. Never stash, reset or discard their changes yourself.
5. **Stay in scope.** Edit only the files listed for the task. Ask before touching any other file, especially another person's area.
6. **Check your work** against the task's "Done when". Run what you can, and report what you could not check.
7. **Commit only, at least 4 commits per task:**
   - Split the work into **at least 4 commits**, one per logical step. Never squash a task into one commit. Typical steps:
     1. Scaffold or model changes.
     2. Core logic.
     3. Wiring, UI or config.
     4. Checks, fixes and docs.
   - Every commit is a real step that builds or runs on its own. No empty, whitespace-only or "wip" commits just to reach 4.
   - `git add <the specific files>`. Never add `.env`, `data/`, `node_modules/` or model files.
   - **Every message fully describes the commit.**
     - A subject line `feat(T2.3): short description` (or `fix`/`docs`/`test`/`chore`), max 72 characters.
     - A blank line.
     - A body saying **what** changed (files and behavior), **why**, and **how it was checked**.
     - Wrap the body at 72 columns. Example:
       ```
       feat(T2.3): add drag-drop upload with progress bar

       NewMeeting.jsx now accepts a dropped or picked audio/video file,
       checks the extension against the backend's allowed list and
       uploads it with upload() from api.js, showing a progress bar.

       Why: users need to add recorded meetings without the recorder.
       Checked: uploaded a 3 min MP3 and a 40 MB MP4 against runserver;
       both reached status "queued" and the page moved to #/m/<id>.
       ```
   - The commit uses the person's own git identity. Do not change git config.
   - **No `Co-Authored-By`**, no "Generated with" line, no AI or agent attribution of any kind in the commit.
   - **Never `git push`**, never open a PR, never merge into `main`. The person reviews, pushes and merges.
8. **Report** the branch name, every commit hash with its subject, what changed, what you verified, and anything left for the person.

## Project rules
- **Low-end first.** The app must run on about 6 GB of RAM with no GPU, and use an NVIDIA GPU when one exists.
  - Do not add PyTorch, transformers, websockets/Channels, DRF, a router library, TypeScript or any UI kit.
  - The only allowed UI dependency is `lucide-react` for icons. Shared components live in `frontend/src/ui/`.
  - The desktop app is Tauri 2 in `desktop/`, never Electron. Its launcher page is plain HTML/JS.
  - Ask before adding any dependency.
- **UI** must match `docs/ui/mockup.webp` in light and dark themes, using `frontend/src/ui/` components.
- **One heavy model in RAM at a time.** The Celery worker uses concurrency 1 and one task per child. Keep stages sequential: ffmpeg, Whisper, diarization, then the LLM.
- Model sizes come from `backend/meetings/hw.py` tiers. Never hard-code a model name elsewhere.
- **Backend:** plain Django views returning `JsonResponse`, with config from env vars in `settings.py`. Run subprocesses with list args, never `shell=True`.
- **Frontend:** plain JSX + Tailwind. Use the `api.js` helpers for every request (they send the CSRF token). Poll every 2 s while processing.
- **Security:** no login exists, so the app binds to `127.0.0.1` only. Validate uploads (extension, size, ffprobe), and do not weaken CSRF.
- A known shortcut gets a comment: `# shortcut: <limit>, <when to upgrade>`.

## Running locally (no Docker)
```
cd backend && uv venv -p 3.12 .venv && uv pip install -p .venv -r requirements.txt
CELERY_EAGER=1 .venv/bin/python manage.py migrate
CELERY_EAGER=1 .venv/bin/python manage.py runserver      # needs ffmpeg; Ollama at localhost:11434
cd frontend && npm install && npm run dev                 # http://localhost:5173
```
- `CELERY_EAGER=1` runs tasks inside the web process, so you do not need Redis or a worker.
- Without `POSTGRES_HOST`, the app uses SQLite.
