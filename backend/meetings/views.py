import json
import mimetypes
import os
import re
from pathlib import Path

from django.conf import settings
from django.http import FileResponse, Http404, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_http_methods, require_POST

from . import hw, tasks
from .models import Meeting, Question, Segment, mmss
from .pipeline import audio
from .search import search_segments

ALLOWED_EXT = {".mp3", ".wav", ".mp4", ".m4a", ".webm", ".ogg", ".opus", ".flac", ".mkv", ".mov"}


def bad(msg, status=400):
    return JsonResponse({"error": msg}, status=status)


def meeting_json(m, full=False):
    d = {
        "id": str(m.id), "title": m.title, "status": m.status, "progress": m.progress,
        "duration": m.duration, "created": m.created.isoformat(), "error": m.error,
    }
    if full:
        d.update(
            language=m.language, summary=m.summary, decisions=m.decisions,
            action_items=m.action_items, speaker_names=m.speaker_names, tier_used=m.tier_used,
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
    q = request.GET.get("q", "").strip()
    if not q:
        return JsonResponse({"meetings": [meeting_json(m) for m in Meeting.objects.all()[:200]]})
    results = {}
    for m in Meeting.objects.filter(title__icontains=q)[:50]:
        results[m.id] = {**meeting_json(m), "hits": []}
    for s in search_segments(Segment.objects.select_related("meeting"), q)[:100]:
        r = results.setdefault(s.meeting_id, {**meeting_json(s.meeting), "hits": []})
        r["hits"].append({"start": s.start, "text": s.text})
    return JsonResponse({"meetings": list(results.values())})


def create_meeting(request):
    f = request.FILES.get("file")
    if not f:
        return bad("No file uploaded.")
    if Path(f.name).suffix.lower() not in ALLOWED_EXT:
        return bad(f"Unsupported file type. Allowed: {', '.join(sorted(ALLOWED_EXT))}")
    if f.size > settings.MAX_UPLOAD_MB * 1024 * 1024:
        return bad(f"File is larger than {settings.MAX_UPLOAD_MB} MB.", 413)
    title = (request.POST.get("title") or Path(f.name).stem)[:200]
    m = Meeting.objects.create(title=title, file=f)
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
    m = get_object_or_404(Meeting, pk=pk)
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
    m = get_object_or_404(Meeting, pk=pk)
    if m.status not in (Meeting.Status.FAILED, Meeting.Status.DONE):
        return bad("Meeting is still processing.", 409)
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
def meeting_export(request, pk):
    m = get_object_or_404(Meeting, pk=pk)
    lines = [f"# {m.title}", "", f"_{m.created:%Y-%m-%d %H:%M} · {mmss(m.duration)}_", "", "## Summary", "", m.summary]
    if m.decisions:
        lines += ["", "## Decisions", ""] + [f"- {d}" for d in m.decisions]
    if m.action_items:
        lines += ["", "## Action items", ""]
        for i in m.action_items:
            extra = ", ".join(x for x in (i.get("owner"), i.get("due") and f"due {i['due']}") if x)
            lines.append(f"- [{'x' if i.get('done') else ' '}] {i.get('task')}{f' ({extra})' if extra else ''}")
    lines += ["", "## Transcript", "", m.transcript(timestamps=True).replace("\n", "  \n")]
    resp = HttpResponse("\n".join(lines) + "\n", content_type="text/markdown; charset=utf-8")
    safe = re.sub(r"[^\w\- ]", "", m.title).strip() or "meeting"
    resp["Content-Disposition"] = f'attachment; filename="{safe}.md"'
    return resp


@require_GET
@ensure_csrf_cookie
def system(request):
    try:
        prof = json.loads(tasks.WORKER_PROFILE.read_text())
    except (OSError, ValueError):
        prof = hw.profile()
    return JsonResponse({k: prof[k] for k in ("tier", "whisper_model", "llm_model", "device", "diarize")})


@ensure_csrf_cookie
def spa(request):
    index = settings.FRONTEND_DIST / "index.html"
    if not index.is_file():
        return HttpResponse("Frontend not built. Run `npm run build` in frontend/ or use the Vite dev server.", status=404)
    return HttpResponse(index.read_bytes(), content_type="text/html")
