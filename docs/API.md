# PrivMeet HTTP API

All endpoints are under `/api/`. The Rust server (`native/server`, routes in `src/web.rs`) answers them with JSON in the shapes the earlier Django backend used.

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
| `vocabulary` | string | at most 500 chars, comma separated: names and terms transcripts should spell right. Together with `display_name` and the speaker names saved on recent meetings they are sent to Whisper as a hint, and near-miss spellings of them are corrected after transcription |
| `default_template` | string | a template id (R1.9); `general` when unset |
| `llm_model` | string | Ollama model name, `^[\w.\-/:]+$` |
| `ollama_url` | string | `http://` or `https://` URL |
| `whisper_model` | string | faster-whisper size or repo, `^[\w.\-/:]+$` |
| `num_ctx` | int | 512 to 131072 |
| `diarize` | bool | |
| `cpu_threads` | int | 1 to 256 |
| `llm_provider` | string | `ollama` (default), `openai`, `anthropic`, `gemini`, `groq`, `openrouter`, `custom` (flag `providers`) |
| `api_base_url` | string | `http(s)://` URL of an OpenAI-compatible API, for `custom` |
| `api_key` | string | at most 300 chars; **never returned**: GET and PATCH show `api_key_set: true/false` instead |
| `api_model` | string | the provider's model id, `^[\w.\-/:]+$` |
| `<provider>_api_key` | string | one linked account per provider: `openai_api_key`, `anthropic_api_key`, `gemini_api_key`, `groq_api_key`, `openrouter_api_key`. Same 300-char rule, and each is **never returned**: GET shows `<provider>_api_key_set` |
| `<provider>_model` | string | that provider's own model id: `openai_model`, `anthropic_model`, `gemini_model`, `groq_model`, `openrouter_model` |

The key and model of the provider in `llm_provider` win over the plain `api_key` / `api_model`,
which stay for `custom` and for settings saved before per-provider accounts existed. So linking
a Claude account and then a ChatGPT one keeps both, and switching provider loses neither.

Set a key to `null` to unlink that account. A consumer subscription (ChatGPT Plus, Claude Pro,
Gemini Advanced) cannot be used: every provider needs an API key of its own.

With a cloud provider, the transcript text is sent to that provider for the summary and Q&A. Audio, Whisper and diarization always stay on this machine.

An unknown key or a wrong type gives 400 (e.g. `{"error": "num_ctx must be a whole number."}`), and nothing is saved.

### `POST /api/settings/test` (flag `providers`)
Tries an LLM server before you save it. The body takes any provider settings. Values you send win over the saved ones, and an empty `api_key` keeps the saved key.
- Ollama is asked for `/api/tags`.
- Cloud providers are asked for `/models`.

```json
{"connected": true, "provider": "ollama", "models": ["qwen2.5:1.5b", "qwen2.5:3b"],
 "expires_at": null, "error": ""}
```
When it fails, `connected` is false and `error` says why (e.g. `Could not reach Ollama at http://...`, or `401 from the provider: ...`).

`expires_at` is when the key stops working, as an ISO timestamp, or `null` when nothing reports
one, which is the usual answer. It is read only after the key has proved it works, and never
fails the test:
- a key that is a JWT is decoded locally for its `exp` claim, so nothing is sent anywhere;
- otherwise the provider's key endpoint is asked, which only OpenRouter has (`GET /key` →
  `expires_at`). OpenAI, Anthropic, Gemini and Groq publish nothing about their own keys.

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
- `queue_position` (flag `cancel`): for a `queued` meeting, how many queued meetings are ahead
  of it (0 = next); `null` otherwise.

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
The list row plus `notes`, `language`, `summary`, `decisions` (strings), `action_items` (`[{"owner", "task", "due", "done"}]`), `speaker_names` (`{"0": "Rohan"}`), `tier_used` and `segments` (`[{"id", "start", "end", "speaker", "text"}]`; `id` with flag `transcript-edit`). Poll it every 2 s while the status is in progress.

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

### `POST /api/meetings/<id>/cancel` (flag `cancel`)
Stops processing. A queued meeting leaves the queue and fails with the error `Cancelled.` at
once. The running one stops at its next check: before each stage, and during transcription
within a few seconds (whisper.cpp's abort callback); it then fails with `Cancelled.` and its
temporary WAV is removed. No new status value is used. Returns the list row; 409 when the
meeting is not processing. Retry clears the request.

### `POST /api/meetings/<id>/summarize` (flag `summarize`)
Writes the summary, key points and action items again from the stored transcript: only the LLM
stage runs, no ffmpeg, Whisper or diarization. Optional JSON `{"template": "<id>"}` uses that
note template (and saves it on the meeting); without it the meeting's own template is used.

Returns the list row with status `summarizing`; poll the meeting until it is `done`. Errors:
- 400: an unknown template.
- 409: the meeting is still processing, or it has no transcript.

On failure the old notes stay, the meeting goes back to the status it had, and `error` says why.

### `PATCH /api/segments/<id>/` (flag `transcript-edit`)
Edits one transcript line. JSON with any of:
- `text`: trimmed, not empty, at most 2000 chars.
- `speaker`: a speaker number of the meeting (in its transcript or `speaker_names`), the next
  unused number (to give the line to a new person), or `null`.

Returns the line `{"id", "start", "end", "speaker", "text"}`. Search and every export use the
new text at once. 400 for an invalid value, 404 for an unknown id, 409 while the meeting is
processing.

### `POST /api/meetings/<id>/speakers/merge` (flag `speaker-merge`)
`{"from": 2, "to": 0}`: every line of speaker `from` moves to `to`, and the name saved for
`from` is dropped. Returns the full meeting. 400 unless both are different speakers of the
meeting; 409 while it is processing.

### `GET /api/meetings/<id>/export.<fmt>`
The meeting as a download named after its title. 404 for an unknown format.

| `fmt` | Flag | What |
|---|---|---|
| `md` | (always) | notes and transcript as Markdown |
| `txt` | `exports` | the same as plain text, with notes |
| `json` | `exports` | the full meeting, as `GET /api/meetings/<id>/` |
| `srt`, `vtt` | `exports` | one subtitle cue per segment, the speaker's name in front |
| `html` | `share-page` | one self-contained page: inline CSS, no script, no outside request, every value escaped |
| `docx`, `odt` | `exports-office` | the notes as a Word / OpenDocument file (title, date, participants, summary, key points, an action-items table, notes, transcript) |
| `ics` | `exports-ics` | action items with a resolvable due date as `VTODO`s (see below) |

`ics`: a due text resolves from the meeting's day: `today`, `tomorrow`, `next week` (the Monday
after), a weekday (the next one after the meeting), a month and day (`Oct 30`, `30 October`) or
`the 14th`. Others are left out and counted in the `X-Skipped-Items` header. When none
resolves: 404 `{"error": "No action item has a date."}`.

### `GET /api/meetings/<id>/audio.mp3` and `audio.opus` (flag `audio-exports`)
The recording converted for sharing, mono: MP3 at 64 kb/s, Opus in Ogg at 32 kb/s. Made on the
first request and cached next to the upload (deleted with the meeting). 404 when the audio was
deleted.

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

## Note templates (flag `templates`)

A template says what a meeting's summary should focus on. Six built-ins are read-only
(`general`, `standup`, `one-on-one`, `client-call`, `interview`, `lecture`); own templates
have ids `u<n>`. Every template has the shape:
```json
{"id": "standup", "name": "Stand-up", "description": "Yesterday, today and blockers, per person.",
 "instructions": "This is a daily stand-up. ...", "builtin": true, "is_default": false}
```

### `GET /api/templates/`
`{"templates": [...]}`: the built-ins, then own templates by name.

### `POST /api/templates/`
`{"name", "instructions", "description"?}` (60, 2000 and 200 characters). Returns 201 with the
template. 400 when a field is missing, empty or too long.

### `GET|PATCH|DELETE /api/templates/<id>/`
PATCH takes any of the three fields. Built-ins answer 403 to PATCH and DELETE. Deleting the
default template makes General the default again. 404 for an unknown id.

### Using a template
- Upload (`POST /api/meetings/`) accepts `template`; without it the meeting gets the default.
  400 for an unknown id.
- The default is the settings key `default_template` (`PATCH /api/settings/`), `general`
  when unset.
- The full meeting JSON carries `template`. The summary prompt adds the template's
  instructions; the output shape does not change.

## Models (flag `models`)

### `GET /api/models/`
Everything the Models page shows:
```json
{"hardware": {"tier": "low", "ram_gb": 5.7, "device": "cpu", "gpu": false, "cuda_error": ""},
 "whisper": {"current": "base", "recommended": "base",
             "sizes": [{"name": "base", "ram_gb": 0.7, "download_mb": 145, "downloaded": true}, ...]},
 "ollama": {"reachable": true, "installed": [{"name": "qwen2.5:1.5b", "size": 986061892}],
            "current": "qwen2.5:1.5b", "recommended": "qwen2.5:1.5b", "provider": "ollama"},
 "diarization": {"enabled": false, "available": true},
 "pull": {"model": "qwen2.5:3b", "percent": 42, "status": "pulling", "running": true, "updated": 1794904153.6}}
```
- `hardware.tier` and the `recommended` names follow the hardware (`hw.TIERS`), even when a
  cloud provider makes `/api/system/` report `high`.
- `pull` is the running or last download, or `null`. `running` turns false when it ends with
  `status` `success` or `error` (then with `error`), or after 120 s without progress.

### `POST /api/models/pull`
`{"model": "qwen2.5:3b"}`. 202 with `{"pull": ...}`. 400 for a name not matching
`^[\w.\-/:]+$`, 409 while another pull runs. The download goes through the worker queue, so it
never runs beside a transcription. Poll `GET /api/models/` for progress.

### `DELETE /api/models/<name>`
Removes an installed Ollama model. 204; 404 when it is not installed; 409 for the model that
writes the notes now; 502 when Ollama cannot be reached.
