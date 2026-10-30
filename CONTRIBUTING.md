# Contributing to PrivMeet

The work is planned in [docs/TASKS.md](docs/TASKS.md). Each person has two tasks per day: task A (main) and task B (second). AI agents (OpenCode, Claude Code) follow [AGENTS.md](AGENTS.md); people follow the same rules below.

## Workflow
1. Pick only your own task from `docs/TASKS.md`. Check that every task under "Needs" is already merged into `main`.
2. Branch from an up-to-date `main`, using the exact branch name from the task:
   ```
   git checkout main
   git pull --ff-only
   git checkout -b d3/kashish/T2.3-new-meeting
   ```
3. Touch only the files listed for the task. Ask the owner before editing their files.
4. Check the task's "Done when" before you finish.
5. Make **at least 4 commits per task**, one per logical step:
   1. Scaffold or model changes.
   2. Core logic.
   3. Wiring, UI or config.
   4. Checks, fixes and docs.

   Never squash a task into one commit. Never add empty or "wip" commits just to reach 4.
6. Push your branch yourself and open a pull request into `main`. Agents never push, open PRs or merge.

## Commit messages
Use a [Conventional Commits](https://www.conventionalcommits.org/) subject with the task id, then a body:
```
feat(T2.3): add drag-drop upload with progress bar

NewMeeting.jsx now accepts a dropped or picked audio/video file,
checks the extension against the backend's allowed list and
uploads it with upload() from api.js, showing a progress bar.

Why: users need to add recorded meetings without the recorder.
Checked: uploaded a 3 min MP3 and a 40 MB MP4 against runserver;
both reached status "queued" and the page moved to #/m/<id>.
```
- Subject: `feat`, `fix`, `docs`, `test` or `chore`, then `(task id)`, max 72 characters.
- Body: what changed, why, and how it was checked. Wrap at 72 columns.
- No `Co-Authored-By` lines and no AI or agent attribution. Commit with your own git identity.

## Project rules
- **Low-end first.** It must run on about 6 GB of RAM with no GPU.
- Do not add PyTorch, transformers, websockets, DRF, a router library, TypeScript or a UI kit. Ask before adding any dependency.
- The UI matches [docs/ui/mockup.webp](docs/ui/mockup.webp) and uses `frontend/src/ui/` components.
- [AGENTS.md](AGENTS.md) has the full list.

## Local setup
See "Running locally" in [AGENTS.md](AGENTS.md). Full setup docs arrive with task T3.5.
