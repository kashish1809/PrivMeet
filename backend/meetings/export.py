"""Meeting exports (R1.13): one builder per format, each returning (bytes, content type).

views.meeting_export picks the builder from the URL's extension and names the download after
the meeting. Every builder takes the Meeting and reads only its stored fields, so a meeting
whose audio was deleted still exports.
"""

import json
import re
from html import escape

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


SHARE_CSS = """
body{margin:0;background:#f6f6fc;color:#121831;font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:40px 20px 60px}
h1{font-size:28px;line-height:1.25;margin:0 0 4px}
.meta{color:#5c6487;margin:0 0 28px}
h2{font-size:15px;text-transform:uppercase;letter-spacing:.06em;color:#3a33c4;margin:32px 0 10px}
section{background:#fff;border:1px solid #dee0f1;border-radius:14px;padding:4px 22px 18px;margin-bottom:16px}
ul{padding-left:20px}li{margin:4px 0}
table{width:100%;border-collapse:collapse;font-size:15px}
th,td{text-align:left;padding:8px 6px;border-bottom:1px solid #eceef8;vertical-align:top}
th{color:#5c6487;font-weight:600;font-size:13px}
.done{text-decoration:line-through;color:#8a90b3}
.notes{white-space:pre-wrap}
.line{display:flex;gap:12px;padding:6px 0;border-bottom:1px solid #f0f1fa}
.t{color:#8a90b3;font-variant-numeric:tabular-nums;min-width:52px}
.who{font-weight:600;color:#3a33c4}
footer{color:#8a90b3;font-size:13px;margin-top:28px;text-align:center}
@media (prefers-color-scheme:dark){body{background:#080c1a;color:#ecedf8}section{background:#121831;border-color:#1e2647}
th,td,.line{border-color:#1e2647}h2,.who{color:#afa1fc}.meta,th,.t,footer{color:#9aa0c6}}
"""


def participants(m):
    """Distinct speaker names, in order of first speech."""
    seen = []
    for s in m.segments.all():
        name = m.speaker_label(s.speaker)
        if name and name not in seen:
            seen.append(name)
    return seen


def share_html(m):
    """One self-contained page to send someone: inline CSS, no script, no outside request.
    Every value from the meeting is escaped."""
    e = lambda v: escape(str(v or ""))  # noqa: E731
    who = participants(m)
    parts = [
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">",
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        '<meta name="color-scheme" content="light dark">',
        f"<title>{e(m.title)}</title><style>{SHARE_CSS}</style></head><body><main>",
        f"<h1>{e(m.title)}</h1>",
        f'<p class="meta">{m.created:%B %-d, %Y} · {e(mmss(m.duration))}'
        + (f" · {len(who)} participant{'s' if len(who) != 1 else ''}: {e(', '.join(who))}" if who else "")
        + "</p>",
        f"<section><h2>Summary</h2><p>{e(m.summary) or 'No summary.'}</p>",
    ]
    if m.decisions:
        parts.append("<h2>Key points</h2><ul>" + "".join(f"<li>{e(d)}</li>" for d in m.decisions) + "</ul>")
    parts.append("</section>")
    if m.action_items:
        rows = "".join(
            f'<tr class="{"done" if i.get("done") else ""}"><td>{"✓" if i.get("done") else "○"}</td>'
            f"<td>{e(i.get('task'))}</td><td>{e(i.get('owner'))}</td><td>{e(i.get('due'))}</td></tr>"
            for i in m.action_items
        )
        parts.append(
            "<section><h2>Action items</h2><table><tr><th></th><th>Task</th><th>Owner</th><th>Due</th></tr>"
            f"{rows}</table></section>"
        )
    if m.notes:
        parts.append(f'<section><h2>Notes</h2><p class="notes">{e(m.notes)}</p></section>')
    lines = "".join(
        f'<div class="line"><span class="t">{e(mmss(s.start))}</span><span>'
        + (f'<span class="who">{e(m.speaker_label(s.speaker))}:</span> ' if s.speaker is not None else "")
        + f"{e(s.text)}</span></div>"
        for s in m.segments.all()
    )
    parts.append(f"<section><h2>Transcript</h2>{lines or '<p>No transcript.</p>'}</section>")
    parts.append("<footer>Made with PrivMeet, self-hosted AI meeting notes.</footer></main></body></html>")
    return "".join(parts).encode(), "text/html; charset=utf-8"


# extension -> builder; later commits add the other formats
BUILDERS = {"md": markdown, "txt": plain_text, "json": as_json, "srt": srt, "vtt": vtt, "html": share_html}
