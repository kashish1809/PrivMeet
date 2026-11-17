import json
import logging
import mimetypes
import os
import re
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

from django.conf import settings
from django.db.models import Count, Q
from django.http import FileResponse, Http404, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_http_methods, require_POST

from . import export, hw, note_templates, settings_store, tasks
from .models import PROCESSING, Meeting, NoteTemplate, Question, Segment, mmss
from .pipeline import audio
from .search import search_segments

log = logging.getLogger(__name__)

ALLOWED_EXT = {".mp3", ".wav", ".mp4", ".m4a", ".webm", ".ogg", ".opus", ".flac", ".mkv", ".mov"}

# What this server supports beyond the v1 API; GET /api/system/ returns it so the frontend
# shows a control only when its endpoint exists (docs/TASKS.md "Feature flags").
FEATURES = ["settings", "notes", "tags", "filters", "providers", "templates", "models"]

MAX_TAGS, MAX_TAG_LEN, MAX_NOTES = 10, 30, 20000
# ?status= also takes the list page's filter names, so the UI does not have to know the stages.
STATUS_GROUPS = {"processing": PROCESSING, "ready": [Meeting.Status.DONE]}


def bad(msg, status=400):
    return JsonResponse({"error": msg}, status=status)


class Invalid(ValueError):
    """A request field failed validation; the message goes back as the 400 error."""


def clean_tags(value):
    """Tags from a JSON list, a JSON string of a list (multipart upload) or "a, b".
    Trimmed, empty ones dropped, duplicates (ignoring case) dropped, max 10 x 30 chars."""
    if isinstance(value, str):
        text = value.strip()
        if text.startswith("["):
            try:
                value = json.loads(text)
            except json.JSONDecodeError:
                raise Invalid("tags must be a list of strings.") from None
        else:
            value = text.split(",") if text else []
    if not isinstance(value, list) or not all(isinstance(t, str) for t in value):
        raise Invalid("tags must be a list of strings.")
    tags, seen = [], set()
    for t in (t.strip() for t in value):
        if not t or t.lower() in seen:
            continue
        if len(t) > MAX_TAG_LEN:
            raise Invalid(f"A tag can be at most {MAX_TAG_LEN} characters.")
        seen.add(t.lower())
        tags.append(t)
    if len(tags) > MAX_TAGS:
        raise Invalid(f"A meeting can have at most {MAX_TAGS} tags.")
    return tags


def clean_notes(value):
    if not isinstance(value, str):
        raise Invalid("notes must be a string.")
    if len(value) > MAX_NOTES:
        raise Invalid(f"Notes can be at most {MAX_NOTES} characters.")
    return value


STALE_ERROR = (
    "Processing stopped before it finished: the worker was killed or crashed. "
    "Press Retry to run it again."
)


def reap(m):
    """Turn a processing meeting whose worker is gone into a failed one, so the page offers
    Retry instead of showing "transcribing" and a 409 forever (bug B4)."""
    if m.is_stale():
        log.warning("meeting %s stale in %s since %s, marking failed", m.pk, m.status, m.heartbeat)
        m.error, m.status, m.progress = STALE_ERROR, Meeting.Status.FAILED, 0
        m.save(update_fields=["error", "status", "progress", "heartbeat"])
    return m


def speaker_count(m):
    """Distinct speakers; uses the list query's annotation when there is one."""
    n = getattr(m, "speaker_count", None)
    return n if n is not None else m.segments.exclude(speaker=None).values("speaker").distinct().count()


def meeting_json(m, full=False):
    d = {
        "id": str(m.id), "title": m.title, "status": m.status, "progress": m.progress,
        "duration": m.duration, "created": m.created.isoformat(), "error": m.error,
        "speakers": speaker_count(m), "has_summary": bool(m.summary.strip()), "tags": m.tags,
    }
    if full:
        d.update(
            notes=m.notes, language=m.language, summary=m.summary, decisions=m.decisions,
            action_items=m.action_items, speaker_names=m.speaker_names, tier_used=m.tier_used,
            template=m.template,
            device_used=m.device_used,
            segments=[
                {"start": s.start, "end": s.end, "speaker": s.speaker, "text": s.text}
                for s in m.segments.all()
            ],
        )
    return d


@require_http_methods(["GET", "POST"])
def meetings(request):
    if request.method == "POST":
        return create_meeting(request)
    try:
        qs = filtered(Meeting.objects.all(), request.GET)
    except Invalid as e:
        return bad(str(e))
    qs = qs.annotate(speaker_count=Count("segments__speaker", distinct=True))
    tag = request.GET.get("tag", "").strip().lower()
    q = request.GET.get("q", "").strip()
    if not q:
        rows = [reap(m) for m in qs[:200] if not tag or tag in (t.lower() for t in m.tags)]
        return JsonResponse({"meetings": [meeting_json(m) for m in rows]})
    results = {}
    text_match = Q(title__icontains=q) | Q(notes__icontains=q) | Q(summary__icontains=q)
    for m in qs.filter(text_match)[:50]:
        results[m.id] = {**meeting_json(m), "hits": []}
    ids = qs.values("id")
    for s in search_segments(Segment.objects.filter(meeting__in=ids).select_related("meeting"), q)[:100]:
        r = results.setdefault(s.meeting_id, {**meeting_json(s.meeting), "hits": []})
        r["hits"].append({"start": s.start, "text": s.text})
    rows = [r for r in results.values() if not tag or tag in (t.lower() for t in r["tags"])]
    return JsonResponse({"meetings": rows})


def _day(value, name):
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise Invalid(f"{name} must be a date like 2026-10-28.") from None


def filtered(qs, params):
    """?status= (a Meeting status, "processing" or "ready"; comma list allowed) and
    ?from= / ?to= (inclusive dates). ?tag= is applied by the caller: SQLite has no JSON
    "contains" lookup and the list is capped at 200 rows anyway."""
    status = [x.strip().lower() for x in params.get("status", "").split(",") if x.strip()]
    if status:
        wanted = set()
        for x in status:
            if x in STATUS_GROUPS:
                wanted.update(STATUS_GROUPS[x])
            elif x in Meeting.Status.values:
                wanted.add(x)
            else:
                raise Invalid(f"Unknown status {x!r}.")
        qs = qs.filter(status__in=wanted)
    if params.get("from"):
        qs = qs.filter(created__date__gte=_day(params["from"], "from"))
    if params.get("to"):
        qs = qs.filter(created__date__lte=_day(params["to"], "to"))
    return qs


def create_meeting(request):
    limit = settings.MAX_UPLOAD_MB * 1024 * 1024
    too_big = f"File is larger than {settings.MAX_UPLOAD_MB} MB."
    # Refuse on the header alone when it is clearly over the limit: the size
    # check below only runs after Django has streamed the body to a temp file,
    # so a huge upload could fill the disk before the 413. 1 MB covers the
    # multipart overhead. The file-size check stays authoritative.
    try:
        length = int(request.META.get("CONTENT_LENGTH") or 0)
    except ValueError:
        length = 0
    if length > limit + 1024 * 1024:
        return bad(too_big, 413)
    f = request.FILES.get("file")
    if not f:
        return bad("No file uploaded.")
    if Path(f.name).suffix.lower() not in ALLOWED_EXT:
        return bad(f"Unsupported file type. Allowed: {', '.join(sorted(ALLOWED_EXT))}")
    if f.size > limit:
        return bad(too_big, 413)
    title = (request.POST.get("title") or Path(f.name).stem)[:200]
    try:
        notes = clean_notes(request.POST.get("notes", ""))
        tags = clean_tags(request.POST.get("tags", ""))
        template = request.POST.get("template", "").strip()
        if template and not note_templates.get(template):
            raise Invalid(f"No template with id {template!r}.")
    except Invalid as e:
        return bad(str(e))
    # the template is fixed at upload: changing the default later does not rewrite old notes
    m = Meeting.objects.create(
        title=title, file=f, notes=notes, tags=tags, template=template or note_templates.default_id()
    )
    duration = audio.probe(m.file.path)
    if duration is None:
        m.file.delete(save=False)
        m.delete()
        return bad("No audio stream found in this file.")
    m.duration = duration
    m.save(update_fields=["duration"])
    tasks.process_meeting.delay(str(m.id))
    return JsonResponse(meeting_json(m), status=201)


@require_http_methods(["GET", "PATCH", "DELETE"])
def meeting_detail(request, pk):
    m = reap(get_object_or_404(Meeting, pk=pk))
    if request.method == "DELETE":
        m.file.delete(save=False)
        m.delete()
        return HttpResponse(status=204)
    if request.method == "PATCH":
        try:
            data = json.loads(request.body)
        except json.JSONDecodeError:
            return bad("Invalid JSON.")
        if not isinstance(data, dict):
            return bad("Expected a JSON object.")
        if isinstance(data.get("title"), str) and data["title"].strip():
            m.title = data["title"].strip()[:200]
        try:
            if "notes" in data:
                m.notes = clean_notes(data["notes"])
            if "tags" in data:
                m.tags = clean_tags(data["tags"])
        except Invalid as e:
            return bad(str(e))
        names = data.get("speaker_names")
        if isinstance(names, dict):
            m.speaker_names = {str(k): str(v)[:60] for k, v in names.items() if str(k).isdigit()}
        items = data.get("action_items")
        if isinstance(items, list):
            m.action_items = [
                {k: (bool(i.get(k)) if k == "done" else str(i.get(k) or "")[:500])
                 for k in ("owner", "task", "due", "done")}
                for i in items if isinstance(i, dict)
            ]
        m.save()
    return JsonResponse(meeting_json(m, full=True))


@require_POST
def meeting_retry(request, pk):
    """Run the pipeline again. A meeting whose worker died mid-run (no heartbeat for
    STALE_AFTER seconds) is taken over instead of refused: before this, such a row stayed
    "transcribing" forever and could only be cleared in the database (bug B4)."""
    m = get_object_or_404(Meeting, pk=pk)
    if m.status not in (Meeting.Status.FAILED, Meeting.Status.DONE) and not m.is_stale():
        return bad("Meeting is still processing.", 409)
    if m.is_stale():
        log.warning("retry takes over meeting %s, stale in %s since %s", m.pk, m.status, m.heartbeat)
    m.set_status(Meeting.Status.QUEUED, 0)
    tasks.process_meeting.delay(str(m.id))
    return JsonResponse(meeting_json(m))


RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")


@require_GET
def meeting_audio(request, pk):
    """Serve the original file with HTTP Range support so the player can seek."""
    m = get_object_or_404(Meeting, pk=pk)
    path = m.file.path
    if not os.path.exists(path):
        raise Http404
    size = os.path.getsize(path)
    ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
    match = RANGE_RE.fullmatch(request.headers.get("Range", "").strip())
    if not match or not any(match.groups()):
        resp = FileResponse(open(path, "rb"), content_type=ctype)
        resp["Accept-Ranges"] = "bytes"
        return resp
    a, b = match.groups()
    if a:
        start, end = int(a), min(int(b) if b else size - 1, size - 1)
    else:  # suffix range: last N bytes
        start, end = max(size - int(b), 0), size - 1
    if start > end or start >= size:
        resp = HttpResponse(status=416)
        resp["Content-Range"] = f"bytes */{size}"
        return resp
    with open(path, "rb") as fh:
        fh.seek(start)
        data = fh.read(min(end - start + 1, 4 * 1024 * 1024))  # cap chunk; browser asks for the rest
    resp = HttpResponse(data, status=206, content_type=ctype)
    resp["Content-Range"] = f"bytes {start}-{start + len(data) - 1}/{size}"
    resp["Accept-Ranges"] = "bytes"
    return resp


@require_POST
def meeting_ask(request, pk):
    m = get_object_or_404(Meeting, pk=pk)
    if m.status != Meeting.Status.DONE:
        return bad("Meeting is not processed yet.", 409)
    try:
        question = str(json.loads(request.body).get("question", "")).strip()
    except (json.JSONDecodeError, AttributeError):
        return bad("Invalid JSON.")
    if not question:
        return bad("Question is empty.")
    q = Question.objects.create(meeting=m, question=question[:1000])
    tasks.answer_question.delay(q.id)
    return JsonResponse(question_json(q), status=201)


def question_json(q):
    return {"id": q.id, "question": q.question, "answer": q.answer, "status": q.status}


@require_GET
def question_detail(request, pk):
    return JsonResponse(question_json(get_object_or_404(Question, pk=pk)))


@require_GET
def meeting_export(request, pk, fmt="md"):
    """GET /api/meetings/<id>/export.<fmt>: the meeting as a download (export.py)."""
    m = get_object_or_404(Meeting, pk=pk)
    build = export.BUILDERS.get(fmt)
    if build is None:
        raise Http404
    body, ctype = build(m)
    resp = HttpResponse(body, content_type=ctype)
    resp["Content-Disposition"] = f'attachment; filename="{export.filename(m, fmt)}"'
    return resp


@require_GET
@ensure_csrf_cookie
def system(request):
    try:
        prof = json.loads(tasks.WORKER_PROFILE.read_text())
    except (OSError, ValueError):
        prof = hw.base_profile()
    prof = hw.apply_overrides(prof, settings_store.load())
    data = {k: prof[k] for k in ("tier", "whisper_model", "llm_model", "device", "diarize", "llm_provider")}
    if prof["llm_provider"] != "ollama":
        data["llm_model"] = prof.get("api_model") or ""  # the model that will write the notes
    # A GPU that failed a real run: the device above is already "cpu", and cuda_error says why,
    # so "GPU present but unusable" is visible instead of silent (bug B1).
    error = hw.cuda_error()
    if error:
        data["device"] = "cpu"
        data["cuda_error"] = error
    return JsonResponse({**data, "features": FEATURES})


@require_http_methods(["GET", "PATCH"])
def user_settings(request):
    """The saved overrides. PATCH merges; a key set to null goes back to the tier default."""
    if request.method == "GET":
        return JsonResponse(settings_store.public(settings_store.load()))
    try:
        data = json.loads(request.body or b"{}")
    except json.JSONDecodeError:
        return bad("Invalid JSON.")
    try:
        return JsonResponse(settings_store.public(settings_store.save(data)))
    except settings_store.SettingsError as e:
        return bad(str(e))


@require_POST
def settings_test(request):
    """Try an LLM server before saving it. Body: any of the provider settings (unsaved values
    win over saved ones; an empty api_key keeps the saved key). Returns
    {connected, provider, models, expires_at, error}. Ollama is asked for /api/tags, others for
    /models. expires_at is when the key stops working, when anything says so, else null."""
    import urllib.error
    import urllib.request

    from .pipeline import providers

    try:
        body = json.loads(request.body or b"{}")
        if not isinstance(body, dict):
            raise ValueError
        cfg = {**settings_store.load(), **settings_store.validate({k: v for k, v in body.items() if v not in ("", None)})}
    except ValueError as e:
        return bad(str(e) or "Expected a JSON object.")
    # Resolve the linked account the same way a real run does, so a key sent as
    # <provider>_api_key is the one tested. Without this the test ran with no key at all and
    # the provider answered "401 Invalid API Key" for a key that was never sent.
    cfg = hw.apply_overrides(cfg, cfg)
    provider = cfg.get("llm_provider", "ollama")
    if provider == "ollama":
        url = (cfg.get("ollama_url") or settings.OLLAMA_URL).rstrip("/")
        try:
            with urllib.request.urlopen(f"{url}/api/tags", timeout=5) as r:
                tags = json.load(r)
            names = sorted(m.get("name") for m in tags.get("models", []) if m.get("name"))
            return JsonResponse(
                {"connected": True, "provider": provider, "models": names, "expires_at": None, "error": ""}
            )
        except (urllib.error.URLError, OSError, ValueError) as e:
            reason = getattr(e, "reason", e)
            return JsonResponse({"connected": False, "provider": provider, "models": [], "expires_at": None,
                                 "error": f"Could not reach Ollama at {url}: {reason}"})
    try:
        models = providers.list_models(cfg)
    except providers.ProviderError as e:
        return JsonResponse({"connected": False, "provider": provider, "models": [], "expires_at": None, "error": str(e)})
    # Only asked once the key is known to work, and never allowed to fail the test.
    return JsonResponse(
        {"connected": True, "provider": provider, "models": models,
         "expires_at": providers.key_expiry(cfg), "error": ""}
    )


@require_GET
def tags(request):
    """Every tag in use with its meeting count, most used first."""
    counts = {}
    for tag_list in Meeting.objects.exclude(tags=[]).values_list("tags", flat=True):
        for t in tag_list:
            key = t.lower()
            name, n = counts.get(key, (t, 0))
            counts[key] = (name, n + 1)
    rows = sorted(counts.values(), key=lambda x: (-x[1], x[0].lower()))
    return JsonResponse({"tags": [{"name": n, "count": c} for n, c in rows]})


@require_GET
def action_items(request):
    """Action items of every meeting, newest meeting first. ?open=1 leaves out done ones.
    index is the item's position in its meeting, for a PATCH of that meeting's list."""
    only_open = request.GET.get("open") == "1"
    rows = []
    for m in Meeting.objects.exclude(action_items=[]).only("id", "title", "created", "action_items"):
        for i, item in enumerate(m.action_items):
            if only_open and item.get("done"):
                continue
            rows.append({
                "meeting": str(m.id), "meeting_title": m.title, "meeting_created": m.created.isoformat(),
                "index": i, "task": item.get("task", ""), "owner": item.get("owner", ""),
                "due": item.get("due", ""), "done": bool(item.get("done")),
            })
    return JsonResponse({"action_items": rows})


def _ollama_models(prof):
    """Installed Ollama models as [{name, size}], or None when Ollama does not answer."""
    from .pipeline import llm

    try:
        with urllib.request.urlopen(f"{llm.ollama_url(prof).rstrip('/')}/api/tags", timeout=5) as r:
            data = json.load(r)
    except (urllib.error.URLError, OSError, ValueError):
        return None
    return sorted(
        ({"name": m["name"], "size": m.get("size", 0)} for m in data.get("models", []) if m.get("name")),
        key=lambda m: m["name"],
    )


def _profile():
    """The profile the worker runs with (it may see a GPU the web side does not), plus the
    saved settings: the same one /api/system/ reports."""
    try:
        prof = json.loads(tasks.WORKER_PROFILE.read_text())
    except (OSError, ValueError):
        prof = hw.base_profile()
    return hw.apply_overrides(prof, settings_store.load())


@require_GET
def models(request):
    """Everything the Models page shows: hardware, Whisper sizes, Ollama models, diarization
    and the running pull."""
    from .pipeline import diarize

    prof = _profile()
    # Recommend for the hardware, not the profile's tier: with a cloud provider the tier
    # reads "high" (hw.apply_overrides), and a 6 GB laptop must not be told to run 7b here.
    hw_tier = hw.detect_tier(prof.get("ram_gb") or 0, bool(prof.get("cuda")))
    rec = hw.recommended(hw_tier)
    installed = _ollama_models(prof)
    return JsonResponse({
        "hardware": {"tier": hw_tier, "ram_gb": prof.get("ram_gb"), "device": prof["device"],
                     "gpu": bool(prof.get("cuda")), "cuda_error": hw.cuda_error()},
        "whisper": {
            "current": prof["whisper_model"], "recommended": rec["whisper_model"],
            "sizes": [{**w, "downloaded": hw.whisper_downloaded(w["name"])} for w in hw.WHISPER_SIZES],
        },
        "ollama": {
            "reachable": installed is not None, "installed": installed or [],
            "current": prof["llm_model"], "recommended": rec["llm_model"],
            "provider": prof.get("llm_provider", "ollama"),
        },
        "diarization": {"enabled": bool(prof["diarize"]), "available": diarize.available()},
        "pull": tasks.pull_state(),
    })


@require_POST
def models_pull(request):
    """Start downloading an Ollama model: {model}. One pull at a time (409 otherwise)."""
    try:
        name = _body(request).get("model", "")
    except (Invalid, AttributeError):
        return bad("Expected a JSON object with a model name.")
    if not isinstance(name, str) or not settings_store.MODEL_NAME.match(name.strip()) or len(name) > 100:
        return bad("That is not a valid model name.")
    state = tasks.pull_state()
    if state and state["running"]:
        return bad(f"Already downloading {state['model']}. Wait for it to finish.", 409)
    # shortcut: with CELERY_EAGER the pull runs inside this request and it returns when done;
    # the page still works (it polls from another request). A real worker returns at once.
    tasks.pull_model.delay(name.strip())
    return JsonResponse({"pull": tasks.pull_state()}, status=202)


@require_http_methods(["DELETE"])
def models_delete(request, name):
    """Remove an installed Ollama model. Refuses the one notes are written with."""
    from .pipeline import llm

    if not settings_store.MODEL_NAME.match(name) or len(name) > 100:
        return bad("That is not a valid model name.")
    prof = _profile()
    current = prof["llm_model"]
    # "qwen2.5:1.5b" and "qwen2.5:1.5b:latest" style names: compare without a ":latest" tail
    same = lambda a, b: a.removesuffix(":latest") == b.removesuffix(":latest")  # noqa: E731
    if prof.get("llm_provider", "ollama") == "ollama" and same(name, current):
        return bad(f"{name} writes your notes now. Pick another model first.", 409)
    req = urllib.request.Request(
        f"{llm.ollama_url(prof).rstrip('/')}/api/delete", data=json.dumps({"model": name}).encode(),
        headers={"Content-Type": "application/json"}, method="DELETE",
    )
    try:
        with urllib.request.urlopen(req, timeout=30):
            pass
    except urllib.error.HTTPError as e:
        return bad("That model is not installed." if e.code == 404 else f"Ollama refused: {e.code}", 404 if e.code == 404 else 502)
    except (urllib.error.URLError, OSError) as e:
        return bad(f"Could not reach Ollama: {getattr(e, 'reason', e)}", 502)
    return HttpResponse(status=204)


TEMPLATE_LIMITS = {"name": 60, "description": 200, "instructions": 2000}


def clean_template(data, partial=False):
    """Validated {name, description, instructions} from a request body. Raises Invalid."""
    if not isinstance(data, dict):
        raise Invalid("Expected a JSON object.")
    out = {}
    for key, limit in TEMPLATE_LIMITS.items():
        if key not in data:
            if not partial and key != "description":
                raise Invalid(f"{key} is required.")
            continue
        v = data[key]
        if not isinstance(v, str):
            raise Invalid(f"{key} must be a string.")
        v = v.strip()
        if len(v) > limit:
            raise Invalid(f"{key} can be at most {limit} characters.")
        if not v and key != "description":
            raise Invalid(f"{key} cannot be empty.")
        out[key] = v
    return out


def _body(request):
    try:
        return json.loads(request.body or b"{}")
    except json.JSONDecodeError:
        raise Invalid("Invalid JSON.") from None


@require_http_methods(["GET", "POST"])
def templates(request):
    """The built-in templates, then the user's own, each marked builtin and is_default."""
    if request.method == "POST":
        try:
            t = NoteTemplate.objects.create(**clean_template(_body(request)))
        except Invalid as e:
            return bad(str(e))
        return JsonResponse(note_templates.as_json(t, note_templates.default_id()), status=201)
    default = note_templates.default_id()
    rows = list(note_templates.BUILTINS) + list(NoteTemplate.objects.all())
    return JsonResponse({"templates": [note_templates.as_json(t, default) for t in rows]})


@require_http_methods(["GET", "PATCH", "DELETE"])
def template_detail(request, tid):
    t = note_templates.get(tid)
    if t is None:
        raise Http404
    if request.method != "GET" and isinstance(t, dict):
        return bad("Built-in templates cannot be changed. Make your own instead.", 403)
    if request.method == "DELETE":
        if note_templates.default_id() == t.key:
            settings_store.save({"default_template": None})  # back to General
        t.delete()
        return HttpResponse(status=204)
    if request.method == "PATCH":
        try:
            for k, v in clean_template(_body(request), partial=True).items():
                setattr(t, k, v)
        except Invalid as e:
            return bad(str(e))
        t.save()
    return JsonResponse(note_templates.as_json(t, note_templates.default_id()))


@ensure_csrf_cookie
def spa(request):
    index = settings.FRONTEND_DIST / "index.html"
    if not index.is_file():
        return HttpResponse("Frontend not built. Run `npm run build` in frontend/ or use the Vite dev server.", status=404)
    return HttpResponse(index.read_bytes(), content_type="text/html")
