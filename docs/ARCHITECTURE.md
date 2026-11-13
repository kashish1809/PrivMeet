# PrivMeet architecture

How the pieces fit together, why they are split that way, and what the code guarantees.
For the task split and the current state see [TASKS.md](TASKS.md); for the original design
notes see [PLAN.md](PLAN.md). This file is written to be quotable in the project report.

## Shape of the system

One Docker Compose stack on one machine. There is no server-side worker outside it, no
external API and no login: the browser talks to Django on `127.0.0.1:8000`, and everything
expensive happens in a single Celery worker that runs one job at a time.

```mermaid
flowchart TB
  User["You<br/>browser or Tauri desktop app"]

  subgraph Host["Host machine - all ports on 127.0.0.1"]
    subgraph Web["web container"]
      Gunicorn["gunicorn + Django<br/>JSON views, no DRF"]
      React["React build<br/>served by whitenoise"]
    end

    subgraph WorkerBox["worker container<br/>concurrency 1, one task per child"]
      Pipe["process_meeting()<br/>ffmpeg, Whisper, diarization, LLM"]
      Answer["answer_question()"]
    end

    Redis["Redis<br/>Celery broker"]
    DB["Postgres 17<br/>meetings, segments, questions"]
    Llm["Ollama<br/>qwen2.5 chat model"]
    Data["data volume<br/>uploads, Whisper cache, worker profile"]
    OllamaVol["ollama volume<br/>pulled models"]
  end

  User -->|"HTTP, multipart upload, poll every 2 s"| Gunicorn
  Gunicorn --> React
  Gunicorn --> DB
  Gunicorn -->|"enqueue task"| Redis
  Redis --> Pipe
  Redis --> Answer
  Pipe --> DB
  Answer --> DB
  Pipe -->|"/api/chat"| Llm
  Answer -->|"/api/chat"| Llm
  Pipe --> Data
  Gunicorn --> Data
  Gunicorn -->|"progress for the UI"| User
  Llm --> OllamaVol
```

What each part is responsible for:

| Part | Responsibility | Not responsible for |
|---|---|---|
| React UI | Upload or record, poll progress, show transcript, notes, Q&A, search | Any processing |
| Django views | Validate uploads, persist rows, enqueue tasks, serve JSON and audio | Running the pipeline |
| Celery worker | The pipeline and Q&A, one job at a time | Serving HTTP |
| Postgres | Meetings, segments with the full-text index, questions | Anything the RAG stage needs |
| Redis | Task queue only, `maxmemory 32mb`, no persistence | Data storage |
| Ollama | The summary and Q&A model, one loaded model at a time | Whisper |

The UI holds no state that matters. `GET /api/meetings/<id>/` is the single source of truth
and the page polls it every 2 s while the meeting is processing, which is why no websocket
or Channels layer exists.

## The pipeline

`tasks.process_meeting(meeting_id)` runs four stages in strict sequence inside one worker
process. Each stage frees its model before the next one loads, so two heavy models are
never resident together.

```mermaid
sequenceDiagram
  autonumber
  participant U as Browser
  participant W as Django web
  participant Q as Redis
  participant C as Celery worker
  participant P as Postgres
  participant O as Ollama

  U->>W: POST /api/meetings/ (multipart)
  W->>W: size cap, extension, ffprobe audio stream
  W->>P: Meeting(status=queued)
  W->>Q: process_meeting.delay(id)
  W-->>U: 201 {id}
  loop every 2 s while processing
    U->>W: GET /api/meetings/<id>/
    W-->>U: status, progress, segments when done
  end
  Q->>C: process_meeting
  C->>P: status=converting
  C->>C: ffmpeg -ac 1 -ar 16000 -f wav (temp file)
  C->>P: status=transcribing 2%
  C->>C: WhisperModel(...).transcribe(vad_filter=True), batch insert segments
  C->>P: progress follows seg.end / duration up to 70%
  C->>P: status=diarizing 70% (skipped when off or models missing)
  C->>C: sherpa-onnx turns, assign speakers by overlap
  C->>P: status=summarizing 80%
  C->>O: pull model if missing, map-reduce summary
  O-->>C: {summary, decisions[], action_items[]}
  C->>P: status=done 100%, notes saved
  C->>C: delete the temp WAV
```

| Stage | Status | Progress | What happens | Model in RAM |
|---|---|---|---|---|
| 0 | `queued` | 0 | Row created, task enqueued | none |
| 1 | `converting` | 0 | `ffmpeg -i in -ac 1 -ar 16000 -f wav` into a temp file; fails fast on a broken container | ffmpeg only |
| 2 | `transcribing` | 2 to 70 | faster-whisper streams segments; they are bulk-inserted every 20 rows; progress follows `seg.end / duration` | Whisper |
| 3 | `diarizing` | 70 | sherpa-onnx speaker turns, assigned to the Whisper segments by maximum time overlap. Skipped when the tier has it off or the ONNX models are missing | diarization ONNX |
| 4 | `summarizing` | 80 to 95 | Ollama pulls the tier's model on first use, then a LangChain map-reduce summarises chunks sized to `num_ctx` | chat model |
| 5 | `done` | 100 | Summary, decisions and action items saved on the meeting row | none |

Any exception sets `failed` and stores the message in `Meeting.error`, which the UI shows
with a Retry button. The temporary WAV is deleted in a `finally` block, so a failed job
never leaves a 60 MB file behind. Retry deletes the old segments and runs the whole pipeline
again.

**Q&A** is a second task, `answer_question(question_id)`, on the same queue.
It is deliberately not a view: a question asked while a transcription runs waits its turn
instead of loading a second model. `search.py` builds the prompt from the whole transcript
when it fits the context window, and otherwise from the best-matching segments plus their
neighbours. The answer cites `[mm:ss]`, and the UI turns each citation into a seek.
