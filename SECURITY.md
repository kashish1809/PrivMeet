# Security

## Supported versions
Only the latest release on `main` gets fixes.

## Threat model
- PrivMeet is **single-user and has no login**. Anyone who can reach port 8000 can read, upload and delete every meeting.
- `compose.yml` binds to `127.0.0.1` only. **Do not expose the port to a LAN or the internet** without putting authentication (e.g. a reverse proxy with auth) in front of it.
- Audio, transcripts and models stay on your machine. Nothing is sent to external services; Ollama runs locally.
- Uploads are checked by extension, size (`MAX_UPLOAD_MB`) and `ffprobe` before processing. CSRF protection is on for all writes.
- Set your own `SECRET_KEY` in `.env` and keep `DEBUG` off outside development.

## Reporting a vulnerability
Do not open a public issue. Contact a maintainer listed in [AUTHORS.md](AUTHORS.md) privately, for example through a GitHub private vulnerability report on the repository. Include steps to reproduce. You will get a reply within 7 days.
