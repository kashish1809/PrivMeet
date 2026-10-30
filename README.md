# PrivMeet

Self-hosted meeting notes: upload or record a meeting, get a transcript with speaker labels, a summary, decisions, action items, search and Q&A. Runs fully offline on low-end laptops (CPU, ~6 GB RAM) and uses an NVIDIA GPU when present.

Stack: Django + Celery, React + Tailwind, PostgreSQL, Docker, OpenAI Whisper (faster-whisper), sherpa-onnx diarization, LangChain + Ollama.

- Design: [docs/PLAN.md](docs/PLAN.md)
- Team task split (6 days): [docs/TASKS.md](docs/TASKS.md)
- Rules for AI agents and contributors: [AGENTS.md](AGENTS.md)
- How to contribute: [CONTRIBUTING.md](CONTRIBUTING.md) · Security: [SECURITY.md](SECURITY.md) · Authors: [AUTHORS.md](AUTHORS.md) · [CHANGELOG.md](CHANGELOG.md) · License: [MIT](LICENSE)

Full setup instructions arrive with task T3.5.
