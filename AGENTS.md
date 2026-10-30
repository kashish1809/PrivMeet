# PrivMeet: agent rules

These rules apply to every AI coding agent working in this repo (OpenCode, Claude Code, others).

PrivMeet is a self-hosted meeting notes app. You upload or record audio and get back a transcript, speaker labels, a summary, decisions, action items, search and Q&A. Everything runs locally.
- Design: `docs/PLAN.md`
- Task split: `docs/TASKS.md`

## Team
| Person | Name | Owns |
|---|---|---|
| Person 1 | Vinayak | Backend pipeline + AI (`T1.x`) |
| Person 2 | Kashish | React frontend (`T2.x`) |
| Person 3 | Karthik | Docker, Postgres, security, notes/Q&A UI, docs (`T3.x`) |

## Task protocol (follow exactly)
1. **Wait for "start".** Never start, continue or pick a task on your own. Begin only when the person says something like "start T2.3" or "I'm Kashish, start my day 3 task".
2. **Know who is speaking.** If the person has not said their name, ask: "Are you Vinayak, Kashish or Karthik?" If the task belongs to someone else, say whose it is and ask for confirmation before going on.
3. **Read the task** in `docs/TASKS.md`. Check that every task under "Needs" is merged into `main`: its files exist on `main`, or `git log main` shows it. If one is missing, stop and tell the person which one. Day 6 tasks need **all** Day 1–5 tasks merged.
4. **Branch from fresh main:**
   ```
   git checkout main
   git pull --ff-only   # skip if there is no remote; never push
   git checkout -b <branch name from TASKS.md>
   ```
   If the working tree is dirty, stop and ask the person what to do. Never stash, reset or discard their changes yourself.
5. **Stay in scope.** Edit only the files listed for the task. Ask before touching any other file, especially another person's area.
6. **Check your work** against the task's "Done when". Run what you can, and report what you could not check.
7. **Commit only:**
   - `git add <the specific files>`. Never add `.env`, `data/`, `node_modules/` or model files.
   - Message format `feat(T2.3): short description` (or `fix`/`docs`/`test`/`chore`).
   - The commit uses the person's own git identity. Do not change git config.
   - **No `Co-Authored-By`**, no "Generated with" line, no AI or agent attribution of any kind in the commit.
   - **Never `git push`**, never open a PR, never merge into `main`. The person reviews, pushes and merges.
8. **Report** the branch name, the commit hash, what changed, what you verified, and anything left for the person.

## Project rules
- **Low-end first.** The app must run on about 6 GB of RAM with no GPU, and use an NVIDIA GPU when one exists.
  - Do not add PyTorch, transformers, websockets/Channels, DRF, a router library, TypeScript or any UI kit.
  - Ask before adding any dependency.
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
