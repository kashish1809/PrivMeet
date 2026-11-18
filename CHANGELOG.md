# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]
### Added
- Backend rewritten in Rust (`native/server`, `privmeet-server`): the same API and feature flags, the pipeline on whisper.cpp and sherpa-onnx, SQLite with FTS5, and `seed-demo`, `import-django` and `process-file` commands. The Docker stack is now `web` + `ollama`; Django, Celery, Redis and Postgres are removed. Idle memory 20 MB instead of 263 MB (`docs/BENCHMARKS.md`).
- Day-0 backend scaffold: Django models, hardware tiers, Whisper (faster-whisper) / sherpa-onnx diarization / LangChain + Ollama pipeline, Celery tasks, JSON API.
- 6-day task split with two tasks per person per day (`docs/TASKS.md`), agent rules (`AGENTS.md`, `CLAUDE.md`, `opencode.json`) and a `/start-task` command.
- UI mockup (`docs/ui/mockup.webp`) and design plan (`docs/PLAN.md`).
- `AUTHORS.md`, `CONTRIBUTING.md`, `SECURITY.md`, this changelog and a pull request template.

### Changed
- The UI mockup is replaced by the v2 design (`docs/ui/mockup.webp`): a five-item sidebar, a top bar, a Home hero, and the Indigo, Teal, Amber and Slate themes. The old mockup stays as `docs/ui/mockup-v1.webp` for the layout of screens v2 does not draw.
- `docs/TASKS.md` adds a v2 track of 20 tasks each for Vinayak (`R1.x`) and Kashish (`R2.x`), a file ownership table and feature flags, so the two can work without waiting for each other. Days 3–5 are adapted to the v2 design; the History and Tools pages are dropped.
- LICENSE now names Kashish R Shetty, K Vinayak Kamath and HM Karthik.
