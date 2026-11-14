# PrivMeet HTTP API

All endpoints are under `/api/`. They are plain Django views that return JSON.

**Writes and CSRF:**
- Every write (`POST`, `PATCH`, `DELETE`) needs the `X-CSRFToken` header set to the `csrftoken` cookie. `GET /api/system/` sets that cookie.
- The frontend's `api()` and `upload()` helpers in `frontend/src/api.js` add the header.

**Errors:** an error is `{"error": "<message>"}` with a 4xx status. 400 means invalid input, 404 an unknown id, 409 the wrong state, 413 a file too large.

**Feature flags:**
- A feature newer than v1 is listed in `features` from `GET /api/system/`. The frontend shows its control only when the flag is there.
- Each section below names its flag.

## System

### `GET /api/system/`
The hardware tier and the models the next meeting will use: the worker's tier with the saved settings applied. It also sets the CSRF cookie.
```json
{"tier": "mid", "whisper_model": "small", "llm_model": "qwen2.5:3b", "device": "cpu", "diarize": true,
 "llm_provider": "ollama", "features": ["settings", "notes", "tags", "filters", "providers"]}
```
When `llm_provider` is not `ollama`, `llm_model` is the cloud model (`api_model`) that writes the notes.

## Settings (flag `settings`)
The settings are stored in `DATA_DIR/settings.json`, written atomically. They override the tier defaults and the env vars, and the worker re-reads them at the start of every task, so a change applies to the next meeting without a restart.

### `GET /api/settings/`
The saved values only. A key that is missing uses the tier default.
```json
{"display_name": "Vinayak", "llm_model": "qwen2.5:3b"}
```

### `PATCH /api/settings/`
Merges the keys you send into the saved settings and returns them all. Sending `null` or `""` for a key removes it, so the tier default applies again.

| Key | Type | Rule |
|---|---|---|
| `display_name` | string | at most 60 chars; shown on Home and as the avatar initials |
| `llm_model` | string | Ollama model name, `^[\w.\-/:]+$` |
| `ollama_url` | string | `http://` or `https://` URL |
| `whisper_model` | string | faster-whisper size or repo, `^[\w.\-/:]+$` |
| `num_ctx` | int | 512 to 131072 |
| `diarize` | bool | |
| `cpu_threads` | int | 1 to 256 |
| `llm_provider` | string | `ollama` (default), `openai`, `openrouter`, `anthropic`, `custom` (flag `providers`) |
| `api_base_url` | string | `http(s)://` URL of an OpenAI-compatible API, for `custom` |
| `api_key` | string | at most 300 chars; **never returned**: GET and PATCH show `api_key_set: true/false` instead |
| `api_model` | string | the provider's model id, `^[\w.\-/:]+$` |

With a cloud provider, the transcript text is sent to that provider for the summary and Q&A. Audio, Whisper and diarization always stay on this machine.

An unknown key or a wrong type gives 400 (e.g. `{"error": "num_ctx must be a whole number."}`), and nothing is saved.

### `POST /api/settings/test` (flag `providers`)
Tries an LLM server before you save it. The body takes any provider settings. Values you send win over the saved ones, and an empty `api_key` keeps the saved key.
- Ollama is asked for `/api/tags`.
- Cloud providers are asked for `/models`.

```json
{"connected": true, "provider": "ollama", "models": ["qwen2.5:1.5b", "qwen2.5:3b"], "error": ""}
```
When it fails, `connected` is false and `error` says why (e.g. `Could not reach Ollama at http://...`, or `401 from the provider: ...`).

## Meetings

### `GET /api/meetings/`
Newest first, at most 200.
```json
{"meetings": [{"id": "uuid", "title": "Project Sync", "status": "done", "progress": 100,
  "duration": 2520.0, "created": "2026-10-28T10:00:00+00:00", "error": "",
  "speakers": 4, "has_summary": true, "tags": ["Development"]}]}
```
- `speakers` is the number of distinct speakers (0 before diarization or on the low tier).
- `has_summary` is false for a `done` meeting whose summary is empty; show "Processed".

**Query parameters:**
- `q`: searches title, notes, summary and transcript. Matching rows add `"hits": [{"start": 12.5, "text": "..."}]` (transcript lines).
- `status` (flag `filters`): a status, `processing` (any in-progress one) or `ready` (`done`). A comma list works too. An unknown value gives 400.
- `from`, `to` (flag `filters`): `YYYY-MM-DD`, inclusive, compared with the creation date (UTC). A bad date gives 400.
- `tag` (flag `tags`): meetings that have this tag; case is ignored.

Statuses: `queued`, `converting`, `transcribing`, `diarizing`, `summarizing`, `done`, `failed`.

### `POST /api/meetings/`
`multipart/form-data`:
- `file` (required): `.mp3 .wav .mp4 .m4a .webm .ogg .opus .flac .mkv .mov`, at most `MAX_UPLOAD_MB`.
- `title`: defaults to the file name.
- `notes` (flag `notes`): text, at most 20000 chars.
- `tags` (flag `tags`): a JSON list (`["API","Sprint"]`) or `"API, Sprint"`.

Returns 201 with the list row and queues processing. Errors:
- 400: a bad extension, no audio stream, or invalid notes or tags.
- 413: the file is too big.

### `GET /api/meetings/<id>/`
The list row plus `notes`, `language`, `summary`, `decisions` (strings), `action_items` (`[{"owner", "task", "due", "done"}]`), `speaker_names` (`{"0": "Rohan"}`), `tier_used` and `segments` (`[{"start", "end", "speaker", "text"}]`). Poll it every 2 s while the status is in progress.

### `PATCH /api/meetings/<id>/`
JSON with any of:
- `title`
- `speaker_names`
- `action_items`
- `notes` (flag `notes`): a string, at most 20000 chars.
- `tags` (flag `tags`): a list of strings, at most 10 tags of 30 chars each. They are trimmed, and duplicates are dropped ignoring case.

Returns the full meeting. Invalid notes or tags give 400, and nothing is saved.

### `DELETE /api/meetings/<id>/`
Deletes the meeting and its audio file. Returns 204.

### `GET /api/meetings/<id>/audio`
The original file. It supports `Range` (206 for a range, 416 when the range is out of bounds).

### `POST /api/meetings/<id>/retry`
Runs the whole pipeline again. Returns 409 while the meeting is still processing.

### `GET /api/meetings/<id>/export.md`
The notes and transcript as a Markdown download.

### `POST /api/meetings/<id>/ask`
`{"question": "..."}`. Returns 201 with `{"id", "question", "answer": "", "status": "pending"}`. Returns 409 unless the meeting is `done`.

### `GET /api/questions/<id>/`
`{"id", "question", "answer", "status"}` with status `pending`, `done` or `failed`. The answer cites `[mm:ss]`.

## Tags (flag `tags`)

### `GET /api/tags/`
Every tag in use, most used first:
```json
{"tags": [{"name": "Development", "count": 3}, {"name": "API", "count": 1}]}
```

## Action items

### `GET /api/action-items/`
The action items of all meetings, newest meeting first. `?open=1` leaves out the done ones.
```json
{"action_items": [{"meeting": "uuid", "meeting_title": "Project Sync", "meeting_created": "2026-10-28T10:00:00+00:00",
  "index": 0, "task": "Push latest API changes", "owner": "Aryan", "due": "Oct 29", "done": false}]}
```
To change an item, `PATCH` its meeting's whole `action_items` list. `index` is the item's position in that list.
