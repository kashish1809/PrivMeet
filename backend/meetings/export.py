"""Meeting exports (R1.13): one builder per format, each returning (bytes, content type).

views.meeting_export picks the builder from the URL's extension and names the download after
the meeting. Every builder takes the Meeting and reads only its stored fields, so a meeting
whose audio was deleted still exports.
"""

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


# extension -> builder; later commits add the other formats
BUILDERS = {"md": markdown}
