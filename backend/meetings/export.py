"""Meeting exports (R1.13): one builder per format, each returning (bytes, content type).

views.meeting_export picks the builder from the URL's extension and names the download after
the meeting. Every builder takes the Meeting and reads only its stored fields, so a meeting
whose audio was deleted still exports.
"""

import json
import re

from .models import mmss


def filename(m, ext):
    """The download name: the title with anything but letters, digits, '-' and spaces removed."""
    safe = re.sub(r"[^\w\- ]", "", m.title).strip() or "meeting"
    return f"{safe}.{ext}"


def markdown(m):
    lines = [f"# {m.title}", "", f"_{m.created:%Y-%m-%d %H:%M} · {mmss(m.duration)}_", "", "## Summary", "", m.summary]
    if m.decisions:
        lines += ["", "## Decisions", ""] + [f"- {d}" for d in m.decisions]
    if m.action_items:
        lines += ["", "## Action items", ""]
        for i in m.action_items:
            extra = ", ".join(x for x in (i.get("owner"), i.get("due") and f"due {i['due']}") if x)
            lines.append(f"- [{'x' if i.get('done') else ' '}] {i.get('task')}{f' ({extra})' if extra else ''}")
    lines += ["", "## Transcript", "", m.transcript(timestamps=True).replace("\n", "  \n")]
    return ("\n".join(lines) + "\n").encode(), "text/markdown; charset=utf-8"


def plain_text(m):
    """The notes as plain text, for pasting anywhere."""
    lines = [m.title, f"{m.created:%Y-%m-%d %H:%M} · {mmss(m.duration)}", "", "SUMMARY", m.summary or "(none)"]
    if m.decisions:
        lines += ["", "KEY POINTS"] + [f"- {d}" for d in m.decisions]
    if m.action_items:
        lines += ["", "ACTION ITEMS"]
        for i in m.action_items:
            who = f" ({i['owner']})" if i.get("owner") else ""
            due = f", due {i['due']}" if i.get("due") else ""
            lines.append(f"[{'x' if i.get('done') else ' '}] {i.get('task', '')}{who}{due}")
    if m.notes:
        lines += ["", "NOTES", m.notes]
    lines += ["", "TRANSCRIPT", m.transcript(timestamps=True)]
    return ("\n".join(lines) + "\n").encode(), "text/plain; charset=utf-8"


def as_json(m):
    """The full meeting: the API's detail JSON, with every segment."""
    from .views import meeting_json

    return json.dumps(meeting_json(m, full=True), ensure_ascii=False, indent=2).encode(), "application/json"


def _stamp(seconds, sep):
    ms = int(round(seconds * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d}{sep}{ms % 1000:03d}"


def _cues(m):
    """(start, end, text) per segment, the speaker's name in front; end never before start."""
    for s in m.segments.all():
        who = m.speaker_label(s.speaker)
        yield s.start, max(s.end, s.start + 0.5), f"{who}: {s.text}" if who else s.text


def srt(m):
    """SubRip: one numbered cue per segment, comma before the milliseconds."""
    out = []
    for n, (a, b, text) in enumerate(_cues(m), 1):
        out.append(f"{n}\n{_stamp(a, ',')} --> {_stamp(b, ',')}\n{text}\n")
    return "\n".join(out).encode(), "application/x-subrip; charset=utf-8"


def vtt(m):
    """WebVTT: the header, then one cue per segment, a dot before the milliseconds."""
    out = ["WEBVTT", ""]
    for a, b, text in _cues(m):
        out += [f"{_stamp(a, '.')} --> {_stamp(b, '.')}", text, ""]
    return "\n".join(out).encode(), "text/vtt; charset=utf-8"


# extension -> builder; later commits add the other formats
BUILDERS = {"md": markdown, "txt": plain_text, "json": as_json, "srt": srt, "vtt": vtt}
