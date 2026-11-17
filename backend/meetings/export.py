"""Meeting exports (R1.13): one builder per format, each returning (bytes, content type).

views.meeting_export picks the builder from the URL's extension and names the download after
the meeting. Every builder takes the Meeting and reads only its stored fields, so a meeting
whose audio was deleted still exports.
"""

import calendar
import io
import subprocess
from pathlib import Path
import json
from datetime import date, timedelta
import re
import zipfile
from html import escape
from xml.sax.saxutils import escape as xml_escape

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


# characters XML 1.0 forbids: one in a transcript would make Word refuse the whole file
_XML_BAD = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]")


def _x(text):
    return xml_escape(_XML_BAD.sub("", str(text or "")))


def _blocks(m):
    """The notes as neutral blocks, shared by the Word and OpenDocument builders:
    ("title", text), ("meta", text), ("h", text), ("p", text), ("li", text), ("table", rows)."""
    who = participants(m)
    out = [("title", m.title), ("meta", f"{m.created:%B %-d, %Y} · {mmss(m.duration)}"
                                + (f" · Participants: {', '.join(who)}" if who else ""))]
    out += [("h", "Summary"), ("p", m.summary or "No summary.")]
    if m.decisions:
        out += [("h", "Key points")] + [("li", d) for d in m.decisions]
    if m.action_items:
        rows = [["Done", "Task", "Owner", "Due"]] + [
            ["Yes" if i.get("done") else "", i.get("task", ""), i.get("owner", ""), i.get("due", "")]
            for i in m.action_items
        ]
        out += [("h", "Action items"), ("table", rows)]
    if m.notes:
        out += [("h", "Notes")] + [("p", line) for line in m.notes.splitlines() if line.strip()]
    out.append(("h", "Transcript"))
    for s in m.segments.all():
        who = m.speaker_label(s.speaker)
        out.append(("p", f"[{mmss(s.start)}] {who + ': ' if who else ''}{s.text}"))
    return out


def _zip(files, first_stored=None):
    """A zip from [(name, text)]; `first_stored` is written first and uncompressed (ODF needs
    its mimetype that way)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        if first_stored:
            z.writestr(zipfile.ZipInfo(first_stored[0]), first_stored[1], compress_type=zipfile.ZIP_STORED)
        for name, text in files:
            z.writestr(name, text)
    return buf.getvalue()


def docx(m):
    """A minimal valid Word file: content types, the package relationship and one document."""
    x = _x

    def para(text, size=None, bold=False, color=None, bullet=False):
        rpr = "".join([
            "<w:b/>" if bold else "",
            f'<w:color w:val="{color}"/>' if color else "",
            f'<w:sz w:val="{size}"/>' if size else "",
        ])
        ppr = '<w:pPr><w:ind w:left="360" w:hanging="240"/></w:pPr>' if bullet else ""
        text = ("• " if bullet else "") + text
        return f'<w:p>{ppr}<w:r>{f"<w:rPr>{rpr}</w:rPr>" if rpr else ""}<w:t xml:space="preserve">{x(text)}</w:t></w:r></w:p>'

    body = []
    for kind, v in _blocks(m):
        if kind == "title":
            body.append(para(v, size=40, bold=True))
        elif kind == "meta":
            body.append(para(v, color="5C6487"))
        elif kind == "h":
            body.append(para(v, size=28, bold=True, color="3A33C4"))
        elif kind == "li":
            body.append(para(v, bullet=True))
        elif kind == "p":
            body.append(para(v))
        elif kind == "table":
            border = "".join(f'<w:{e} w:val="single" w:sz="4" w:color="DEE0F1"/>' for e in ("top", "left", "bottom", "right", "insideH", "insideV"))
            rows = "".join(
                "<w:tr>" + "".join(
                    f'<w:tc><w:p><w:r>{"<w:rPr><w:b/></w:rPr>" if r == 0 else ""}<w:t xml:space="preserve">{x(c)}</w:t></w:r></w:p></w:tc>'
                    for c in row
                ) + "</w:tr>"
                for r, row in enumerate(v)
            )
            body.append(f'<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>{border}</w:tblBorders></w:tblPr>{rows}</w:tbl>')
            body.append("<w:p/>")
    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
        + "".join(body)
        + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>'
        "</w:body></w:document>"
    )
    files = [
        ("[Content_Types].xml",
         '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
         '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
         '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
         '<Default Extension="xml" ContentType="application/xml"/>'
         '<Override PartName="/word/document.xml" '
         'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
        ("_rels/.rels",
         '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
         '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
         '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
         'Target="word/document.xml"/></Relationships>'),
        ("word/document.xml", document),
    ]
    return _zip(files), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


ODT_MIME = "application/vnd.oasis.opendocument.text"


def odt(m):
    """A minimal valid OpenDocument Text file: mimetype (stored, first), manifest, content."""
    x = _x
    body = []
    for kind, v in _blocks(m):
        if kind == "title":
            body.append(f'<text:h text:outline-level="1" text:style-name="Title">{x(v)}</text:h>')
        elif kind == "meta":
            body.append(f'<text:p text:style-name="Meta">{x(v)}</text:p>')
        elif kind == "h":
            body.append(f'<text:h text:outline-level="2" text:style-name="Heading">{x(v)}</text:h>')
        elif kind == "li":
            body.append(f"<text:list><text:list-item><text:p>{x(v)}</text:p></text:list-item></text:list>")
        elif kind == "p":
            body.append(f"<text:p>{x(v)}</text:p>")
        elif kind == "table":
            cols = len(v[0])
            rows = "".join(
                "<table:table-row>" + "".join(
                    f'<table:table-cell table:style-name="Cell" office:value-type="string"><text:p{" text:style-name=\"Bold\"" if r == 0 else ""}>{x(c)}</text:p></table:table-cell>'
                    for c in row
                ) + "</table:table-row>"
                for r, row in enumerate(v)
            )
            body.append(f'<table:table table:name="ActionItems"><table:table-column table:number-columns-repeated="{cols}"/>{rows}</table:table>')
    content = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
        'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" '
        'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" '
        'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" '
        'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.2">'
        "<office:automatic-styles>"
        '<style:style style:name="Title" style:family="paragraph"><style:text-properties fo:font-size="20pt" fo:font-weight="bold"/></style:style>'
        '<style:style style:name="Heading" style:family="paragraph"><style:paragraph-properties fo:margin-top="0.4cm"/>'
        '<style:text-properties fo:font-size="14pt" fo:font-weight="bold" fo:color="#3a33c4"/></style:style>'
        '<style:style style:name="Meta" style:family="paragraph"><style:text-properties fo:color="#5c6487"/></style:style>'
        '<style:style style:name="Bold" style:family="paragraph"><style:text-properties fo:font-weight="bold"/></style:style>'
        '<style:style style:name="Cell" style:family="table-cell"><style:table-cell-properties fo:border="0.5pt solid #dee0f1" fo:padding="0.1cm"/></style:style>'
        "</office:automatic-styles><office:body><office:text>"
        + "".join(body)
        + "</office:text></office:body></office:document-content>"
    )
    manifest = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">'
        f'<manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="{ODT_MIME}"/>'
        '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>'
        "</manifest:manifest>"
    )
    return _zip([("META-INF/manifest.xml", manifest), ("content.xml", content)], first_stored=("mimetype", ODT_MIME)), ODT_MIME


class NoDates(Exception):
    """No action item has a due date that resolves to a day: the .ics export answers 404."""


WEEKDAYS = {name: i for i, name in enumerate(calendar.day_name)} | {
    name[:3]: i for i, name in enumerate(calendar.day_name)
}
MONTHS = {name.lower(): i for i, name in enumerate(calendar.month_name) if name} | {
    name.lower(): i for i, name in enumerate(calendar.month_abbr) if name
}
_DAY = r"(\d{1,2})(?:st|nd|rd|th)?"


def resolve_due(text, anchor):
    """A due text ("Friday", "tomorrow", "next week", "Oct 30", "30 October", "the 14th") as a
    date, counted from the meeting's day `anchor`; None when it names no day."""
    t = (text or "").strip().lower().replace(",", " ")
    if not t:
        return None
    if re.search(r"\btoday\b", t):
        return anchor
    if re.search(r"\btomorrow\b", t):
        return anchor + timedelta(days=1)
    if re.search(r"\bnext week\b", t):
        return anchor + timedelta(days=7 - anchor.weekday())  # the Monday after
    for name, wd in WEEKDAYS.items():
        if re.search(rf"\b{name.lower()}\b", t):
            return anchor + timedelta(days=(wd - anchor.weekday() - 1) % 7 + 1)  # strictly after
    for pat, order in ((rf"\b([a-z]+)\.?\s+{_DAY}\b", "md"), (rf"\b{_DAY}\s+(?:of\s+)?([a-z]+)\b", "dm")):
        for mt in re.finditer(pat, t):
            mon, day = (mt.group(1), mt.group(2)) if order == "md" else (mt.group(2), mt.group(1))
            if mon in MONTHS:
                for year in (anchor.year, anchor.year + 1):  # the next one on or after the meeting
                    try:
                        d = date(year, MONTHS[mon], int(day))
                    except ValueError:
                        break
                    if d >= anchor:
                        return d
    mt = re.search(rf"\bthe\s+{_DAY}\b", t)
    if mt:
        y, mo = anchor.year, anchor.month
        for _ in range(13):  # the next month that has that day, from this one
            try:
                d = date(y, mo, int(mt.group(1)))
                if d >= anchor:
                    return d
            except ValueError:
                pass
            y, mo = (y + 1, 1) if mo == 12 else (y, mo + 1)
    return None


def _ical_text(v):
    return re.sub(r"([\\;,])", r"\\\1", str(v or "")).replace("\r", "").replace("\n", "\\n")


def _fold(line):
    """RFC 5545: lines of at most 75 octets, continued with a leading space."""
    b = line.encode()
    out = []
    while len(b) > 75:
        cut = 75 if not out else 74
        while cut and (b[cut] & 0xC0) == 0x80:  # never split a UTF-8 character
            cut -= 1
        out.append(b[:cut].decode())
        b = b[cut:]
    out.append(b.decode())
    return "\r\n ".join(out)


def ics(m):
    """The action items with a resolvable due date as calendar to-dos (VTODO). Raises NoDates
    when none resolves; returns the skipped count in X-Skipped-Items."""
    anchor = m.created.date()
    todos, skipped = [], 0
    stamp = m.created.strftime("%Y%m%dT%H%M%SZ")
    for n, item in enumerate(m.action_items):
        due = resolve_due(item.get("due"), anchor)
        if not due:
            skipped += 1
            continue
        desc = "\n".join(x for x in (
            f"Owner: {item['owner']}" if item.get("owner") else "",
            f"Meeting: {m.title}",
            f"Due as said: {item.get('due')}",
        ) if x)
        todos += [
            "BEGIN:VTODO",
            f"UID:{m.id}-{n}@privmeet",
            f"DTSTAMP:{stamp}",
            f"SUMMARY:{_ical_text(item.get('task'))}",
            f"DUE;VALUE=DATE:{due:%Y%m%d}",
            f"DESCRIPTION:{_ical_text(desc)}",
            f"STATUS:{'COMPLETED' if item.get('done') else 'NEEDS-ACTION'}",
            "END:VTODO",
        ]
    if not todos:
        raise NoDates
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PrivMeet//Action items//EN", "CALSCALE:GREGORIAN",
             *todos, "END:VCALENDAR"]
    body = "\r\n".join(_fold(x) for x in lines) + "\r\n"
    return body.encode(), "text/calendar; charset=utf-8", {"X-Skipped-Items": str(skipped)}


# extension -> builder; later commits add the other formats
BUILDERS = {"md": markdown, "txt": plain_text, "json": as_json, "srt": srt, "vtt": vtt, "html": share_html, "docx": docx, "odt": odt, "ics": ics}


# ---- the recording, converted for sharing: mono, small, speech stays clear
AUDIO = {
    # the format is named, not guessed: the file is written as .part, then renamed
    "mp3": (["-c:a", "libmp3lame", "-b:a", "64k", "-f", "mp3"], "audio/mpeg"),
    "opus": (["-c:a", "libopus", "-b:a", "32k", "-f", "ogg"], "audio/ogg"),
}


def audio_copy(m, fmt):
    """The cached conversion of the meeting's audio (made on first request), or None when the
    meeting has no audio file any more."""
    if not m.file or not Path(m.file.path).is_file():
        return None
    src = Path(m.file.path)
    dst = src.with_name(f"{src.stem}.share.{fmt}")
    if not dst.is_file() or dst.stat().st_mtime < src.stat().st_mtime:
        tmp = dst.with_name(dst.name + ".part")
        args, _ = AUDIO[fmt]
        # list args, never a shell; the pipeline's timeout rule (3 h)
        subprocess.run(
            ["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-i", str(src), "-vn", "-ac", "1", *args, str(tmp)],
            check=True, capture_output=True, timeout=3 * 3600,
        )
        tmp.replace(dst)  # a half-written file is never served
    return dst


def audio_copies(m):
    """Every cached conversion of the meeting's audio, to delete with it."""
    if not m.file:
        return []
    src = Path(m.file.path)
    return [p for p in src.parent.glob(f"{src.stem}.share.*") if p.is_file()]
