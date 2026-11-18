//! Meeting exports (backend/meetings/export.py): one builder per format, each returning the
//! bytes, the content type and any extra headers. Builders read only stored fields, so a meeting
//! whose audio was deleted still exports.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use regex::Regex;
use serde_json::Value;

use crate::db;
use crate::meetings::{Meeting, Segment};

pub struct Export {
    pub body: Vec<u8>,
    pub ctype: &'static str,
    pub headers: Vec<(&'static str, String)>,
}

/// .ics with no action item whose due text names a day: the view answers 404.
pub struct NoDates;

/// The download name: the title with anything but letters, digits, '_', '-' and spaces removed.
pub fn filename(m: &Meeting, ext: &str) -> String {
    let safe: String = m.title.chars().filter(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | ' ')).collect();
    let safe = safe.trim();
    format!("{}.{ext}", if safe.is_empty() { "meeting" } else { safe })
}

/// models.mmss: "04:05", or "1:02:03" from an hour up.
pub fn mmss(seconds: f64) -> String {
    let s = seconds.max(0.0) as i64;
    if s >= 3600 { format!("{}:{:02}:{:02}", s / 3600, s / 60 % 60, s % 60) } else { format!("{:02}:{:02}", s / 60, s % 60) }
}

const MONTH_NAMES: [&str; 12] =
    ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_NAMES: [&str; 7] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/// (year, month, day, hour, minute, second) of an ISO timestamp; times are stored in UTC.
fn parts(iso: &str) -> (i64, u32, u32, u32, u32, u32) {
    let n = |a: usize, b: usize| iso.get(a..b).and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
    (n(0, 4) as i64, n(5, 7).max(1), n(8, 10).max(1), n(11, 13), n(14, 16), n(17, 19))
}

fn stamp_minutes(iso: &str) -> String {
    let (y, mo, d, h, mi, _) = parts(iso);
    format!("{y:04}-{mo:02}-{d:02} {h:02}:{mi:02}")
}

fn long_date(iso: &str) -> String {
    let (y, mo, d, ..) = parts(iso);
    format!("{} {d}, {y}", MONTH_NAMES[(mo - 1) as usize])
}

fn transcript(m: &Meeting, segs: &[Segment]) -> String {
    segs.iter()
        .map(|s| {
            let who = m.speaker_label(s.speaker, None);
            format!("[{}] {}{}", mmss(s.start), if who.is_empty() { String::new() } else { format!("{who}: ") }, s.text)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn list(v: &Value) -> Vec<Value> {
    v.as_array().cloned().unwrap_or_default()
}

fn field(i: &Value, k: &str) -> String {
    match i.get(k) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) | None => String::new(),
        Some(v) => v.to_string(),
    }
}

fn done(i: &Value) -> bool {
    i.get("done").and_then(Value::as_bool).unwrap_or(false)
}

fn text_items(v: &Value) -> Vec<String> {
    list(v).iter().map(|d| d.as_str().map(String::from).unwrap_or_else(|| d.to_string())).collect()
}

pub fn markdown(m: &Meeting, segs: &[Segment]) -> Export {
    let mut lines = vec![format!("# {}", m.title), String::new(), format!("_{} · {}_", stamp_minutes(&m.created), mmss(m.duration)), String::new(), "## Summary".into(), String::new(), m.summary.clone()];
    let decisions = text_items(&m.decisions);
    if !decisions.is_empty() {
        lines.extend(["".into(), "## Decisions".into(), "".into()]);
        lines.extend(decisions.iter().map(|d| format!("- {d}")));
    }
    let items = list(&m.action_items);
    if !items.is_empty() {
        lines.extend(["".into(), "## Action items".into(), "".into()]);
        for i in &items {
            let due = field(i, "due");
            let extra: Vec<String> = [field(i, "owner"), if due.is_empty() { due } else { format!("due {due}") }].into_iter().filter(|x| !x.is_empty()).collect();
            let extra = if extra.is_empty() { String::new() } else { format!(" ({})", extra.join(", ")) };
            lines.push(format!("- [{}] {}{extra}", if done(i) { "x" } else { " " }, field(i, "task")));
        }
    }
    lines.extend(["".into(), "## Transcript".into(), "".into(), transcript(m, segs).replace('\n', "  \n")]);
    Export { body: (lines.join("\n") + "\n").into_bytes(), ctype: "text/markdown; charset=utf-8", headers: vec![] }
}

pub fn plain_text(m: &Meeting, segs: &[Segment]) -> Export {
    let mut lines = vec![m.title.clone(), format!("{} · {}", stamp_minutes(&m.created), mmss(m.duration)), String::new(), "SUMMARY".into(), if m.summary.is_empty() { "(none)".into() } else { m.summary.clone() }];
    let decisions = text_items(&m.decisions);
    if !decisions.is_empty() {
        lines.extend(["".into(), "KEY POINTS".into()]);
        lines.extend(decisions.iter().map(|d| format!("- {d}")));
    }
    let items = list(&m.action_items);
    if !items.is_empty() {
        lines.extend(["".into(), "ACTION ITEMS".into()]);
        for i in &items {
            let (owner, due) = (field(i, "owner"), field(i, "due"));
            let who = if owner.is_empty() { String::new() } else { format!(" ({owner})") };
            let due = if due.is_empty() { String::new() } else { format!(", due {due}") };
            lines.push(format!("[{}] {}{who}{due}", if done(i) { "x" } else { " " }, field(i, "task")));
        }
    }
    if !m.notes.is_empty() {
        lines.extend(["".into(), "NOTES".into(), m.notes.clone()]);
    }
    lines.extend(["".into(), "TRANSCRIPT".into(), transcript(m, segs)]);
    Export { body: (lines.join("\n") + "\n").into_bytes(), ctype: "text/plain; charset=utf-8", headers: vec![] }
}

pub fn as_json(full: &Value) -> Export {
    Export { body: serde_json::to_vec_pretty(full).unwrap_or_default(), ctype: "application/json", headers: vec![] }
}

fn stamp(seconds: f64, sep: char) -> String {
    let ms = (seconds * 1000.0).round() as i64;
    format!("{:02}:{:02}:{:02}{sep}{:03}", ms / 3_600_000, ms / 60_000 % 60, ms / 1000 % 60, ms % 1000)
}

fn cues<'a>(m: &'a Meeting, segs: &'a [Segment]) -> impl Iterator<Item = (f64, f64, String)> + 'a {
    segs.iter().map(|s| {
        let who = m.speaker_label(s.speaker, None);
        (s.start, s.end.max(s.start + 0.5), if who.is_empty() { s.text.clone() } else { format!("{who}: {}", s.text) })
    })
}

pub fn srt(m: &Meeting, segs: &[Segment]) -> Export {
    let out: Vec<String> = cues(m, segs).enumerate().map(|(n, (a, b, t))| format!("{}\n{} --> {}\n{t}\n", n + 1, stamp(a, ','), stamp(b, ','))).collect();
    Export { body: out.join("\n").into_bytes(), ctype: "application/x-subrip; charset=utf-8", headers: vec![] }
}

pub fn vtt(m: &Meeting, segs: &[Segment]) -> Export {
    let mut out = vec!["WEBVTT".to_string(), String::new()];
    for (a, b, t) in cues(m, segs) {
        out.extend([format!("{} --> {}", stamp(a, '.'), stamp(b, '.')), t, String::new()]);
    }
    Export { body: out.join("\n").into_bytes(), ctype: "text/vtt; charset=utf-8", headers: vec![] }
}

const SHARE_CSS: &str = r#"
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
"#;

/// Distinct speaker names, in order of first speech.
pub fn participants(m: &Meeting, segs: &[Segment]) -> Vec<String> {
    let mut seen: Vec<String> = Vec::new();
    for s in segs {
        let name = m.speaker_label(s.speaker, None);
        if !name.is_empty() && !seen.contains(&name) {
            seen.push(name);
        }
    }
    seen
}

/// html.escape with quote=True.
fn esc(v: &str) -> String {
    v.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&#x27;")
}

/// One self-contained page: inline CSS, no script, no outside request, every value escaped.
pub fn share_html(m: &Meeting, segs: &[Segment]) -> Export {
    let who = participants(m, segs);
    let mut p = vec![
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">".to_string(),
        r#"<meta name="viewport" content="width=device-width,initial-scale=1">"#.into(),
        r#"<meta name="color-scheme" content="light dark">"#.into(),
        format!("<title>{}</title><style>{SHARE_CSS}</style></head><body><main>", esc(&m.title)),
        format!("<h1>{}</h1>", esc(&m.title)),
        format!(
            "<p class=\"meta\">{} · {}{}</p>",
            long_date(&m.created),
            esc(&mmss(m.duration)),
            if who.is_empty() { String::new() } else { format!(" · {} participant{}: {}", who.len(), if who.len() != 1 { "s" } else { "" }, esc(&who.join(", "))) }
        ),
        format!("<section><h2>Summary</h2><p>{}</p>", if m.summary.is_empty() { "No summary.".into() } else { esc(&m.summary) }),
    ];
    let decisions = text_items(&m.decisions);
    if !decisions.is_empty() {
        p.push(format!("<h2>Key points</h2><ul>{}</ul>", decisions.iter().map(|d| format!("<li>{}</li>", esc(d))).collect::<String>()));
    }
    p.push("</section>".into());
    let items = list(&m.action_items);
    if !items.is_empty() {
        let rows: String = items
            .iter()
            .map(|i| {
                format!(
                    "<tr class=\"{}\"><td>{}</td><td>{}</td><td>{}</td><td>{}</td></tr>",
                    if done(i) { "done" } else { "" },
                    if done(i) { "✓" } else { "○" },
                    esc(&field(i, "task")),
                    esc(&field(i, "owner")),
                    esc(&field(i, "due"))
                )
            })
            .collect();
        p.push(format!("<section><h2>Action items</h2><table><tr><th></th><th>Task</th><th>Owner</th><th>Due</th></tr>{rows}</table></section>"));
    }
    if !m.notes.is_empty() {
        p.push(format!("<section><h2>Notes</h2><p class=\"notes\">{}</p></section>", esc(&m.notes)));
    }
    let lines: String = segs
        .iter()
        .map(|s| {
            let who = if s.speaker.is_some() { format!("<span class=\"who\">{}:</span> ", esc(&m.speaker_label(s.speaker, None))) } else { String::new() };
            format!("<div class=\"line\"><span class=\"t\">{}</span><span>{who}{}</span></div>", esc(&mmss(s.start)), esc(&s.text))
        })
        .collect();
    p.push(format!("<section><h2>Transcript</h2>{}</section>", if lines.is_empty() { "<p>No transcript.</p>".into() } else { lines }));
    p.push("<footer>Made with PrivMeet, self-hosted AI meeting notes.</footer></main></body></html>".into());
    Export { body: p.concat().into_bytes(), ctype: "text/html; charset=utf-8", headers: vec![] }
}

/// XML-escaped, without the characters XML 1.0 forbids (one would make Word refuse the file).
fn x(text: &str) -> String {
    let clean: String = text
        .chars()
        .filter(|&c| !(matches!(c, '\u{0}'..='\u{8}' | '\u{b}' | '\u{c}' | '\u{e}'..='\u{1f}' | '\u{fffe}' | '\u{ffff}')))
        .collect();
    clean.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

enum Block {
    Title(String),
    Meta(String),
    H(String),
    P(String),
    Li(String),
    Table(Vec<Vec<String>>),
}

/// The notes as neutral blocks, shared by the Word and OpenDocument builders.
fn blocks(m: &Meeting, segs: &[Segment]) -> Vec<Block> {
    let who = participants(m, segs);
    let mut out = vec![
        Block::Title(m.title.clone()),
        Block::Meta(format!("{} · {}{}", long_date(&m.created), mmss(m.duration), if who.is_empty() { String::new() } else { format!(" · Participants: {}", who.join(", ")) })),
        Block::H("Summary".into()),
        Block::P(if m.summary.is_empty() { "No summary.".into() } else { m.summary.clone() }),
    ];
    let decisions = text_items(&m.decisions);
    if !decisions.is_empty() {
        out.push(Block::H("Key points".into()));
        out.extend(decisions.into_iter().map(Block::Li));
    }
    let items = list(&m.action_items);
    if !items.is_empty() {
        let mut rows = vec![vec!["Done".to_string(), "Task".into(), "Owner".into(), "Due".into()]];
        rows.extend(items.iter().map(|i| vec![if done(i) { "Yes".into() } else { String::new() }, field(i, "task"), field(i, "owner"), field(i, "due")]));
        out.push(Block::H("Action items".into()));
        out.push(Block::Table(rows));
    }
    if !m.notes.is_empty() {
        out.push(Block::H("Notes".into()));
        out.extend(m.notes.lines().filter(|l| !l.trim().is_empty()).map(|l| Block::P(l.to_string())));
    }
    out.push(Block::H("Transcript".into()));
    for s in segs {
        let who = m.speaker_label(s.speaker, None);
        out.push(Block::P(format!("[{}] {}{}", mmss(s.start), if who.is_empty() { String::new() } else { format!("{who}: ") }, s.text)));
    }
    out
}

fn crc32(data: &[u8]) -> u32 {
    !crc32_update(!0u32, data)
}

/// CRC-32 over one more piece: start with !0 and invert at the end (backup.rs reads in pieces).
pub fn crc32_update(mut crc: u32, data: &[u8]) -> u32 {
    for &b in data {
        crc ^= b as u32;
        for _ in 0..8 {
            crc = if crc & 1 != 0 { (crc >> 1) ^ 0xEDB8_8320 } else { crc >> 1 };
        }
    }
    crc
}

/// A zip of stored (uncompressed) entries, in the given order. Office and ODF readers accept
/// stored entries, and ODF needs its mimetype first and stored anyway.
// shortcut: no compression (a transcript docx is a few hundred kB), add deflate if size matters.
pub fn zip(files: &[(&str, &[u8])]) -> Vec<u8> {
    let (mut out, mut central) = (Vec::new(), Vec::new());
    let le16 = |v: &mut Vec<u8>, n: u16| v.extend_from_slice(&n.to_le_bytes());
    let le32 = |v: &mut Vec<u8>, n: u32| v.extend_from_slice(&n.to_le_bytes());
    for (name, data) in files {
        let (crc, size, offset) = (crc32(data), data.len() as u32, out.len() as u32);
        le32(&mut out, 0x0403_4b50);
        for n in [20u16, 0x0800, 0, 0, 0x21] { le16(&mut out, n) } // version, UTF-8 names, stored, time, date 1980-01-01
        for n in [crc, size, size] { le32(&mut out, n) }
        le16(&mut out, name.len() as u16);
        le16(&mut out, 0);
        out.extend_from_slice(name.as_bytes());
        out.extend_from_slice(data);
        le32(&mut central, 0x0201_4b50);
        for n in [20u16, 20, 0x0800, 0, 0, 0x21] { le16(&mut central, n) }
        for n in [crc, size, size] { le32(&mut central, n) }
        for n in [name.len() as u16, 0, 0, 0, 0] { le16(&mut central, n) }
        le32(&mut central, 0);
        le32(&mut central, offset);
        central.extend_from_slice(name.as_bytes());
    }
    let (cd_offset, cd_size) = (out.len() as u32, central.len() as u32);
    out.extend_from_slice(&central);
    le32(&mut out, 0x0605_4b50);
    for n in [0u16, 0, files.len() as u16, files.len() as u16] { le16(&mut out, n) }
    le32(&mut out, cd_size);
    le32(&mut out, cd_offset);
    le16(&mut out, 0);
    out
}

pub fn docx(m: &Meeting, segs: &[Segment]) -> Export {
    let para = |text: &str, size: Option<u32>, bold: bool, color: Option<&str>, bullet: bool| {
        let rpr = format!("{}{}{}", if bold { "<w:b/>" } else { "" }, color.map(|c| format!("<w:color w:val=\"{c}\"/>")).unwrap_or_default(), size.map(|s| format!("<w:sz w:val=\"{s}\"/>")).unwrap_or_default());
        let ppr = if bullet { r#"<w:pPr><w:ind w:left="360" w:hanging="240"/></w:pPr>"# } else { "" };
        let text = format!("{}{text}", if bullet { "• " } else { "" });
        format!("<w:p>{ppr}<w:r>{}<w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>", if rpr.is_empty() { String::new() } else { format!("<w:rPr>{rpr}</w:rPr>") }, x(&text))
    };
    let mut body = String::new();
    for b in blocks(m, segs) {
        match b {
            Block::Title(v) => body += &para(&v, Some(40), true, None, false),
            Block::Meta(v) => body += &para(&v, None, false, Some("5C6487"), false),
            Block::H(v) => body += &para(&v, Some(28), true, Some("3A33C4"), false),
            Block::Li(v) => body += &para(&v, None, false, None, true),
            Block::P(v) => body += &para(&v, None, false, None, false),
            Block::Table(rows) => {
                let border: String = ["top", "left", "bottom", "right", "insideH", "insideV"].iter().map(|e| format!("<w:{e} w:val=\"single\" w:sz=\"4\" w:color=\"DEE0F1\"/>")).collect();
                let rows: String = rows
                    .iter()
                    .enumerate()
                    .map(|(r, row)| {
                        let cells: String = row.iter().map(|c| format!("<w:tc><w:p><w:r>{}<w:t xml:space=\"preserve\">{}</w:t></w:r></w:p></w:tc>", if r == 0 { "<w:rPr><w:b/></w:rPr>" } else { "" }, x(c))).collect();
                        format!("<w:tr>{cells}</w:tr>")
                    })
                    .collect();
                body += &format!("<w:tbl><w:tblPr><w:tblW w:w=\"5000\" w:type=\"pct\"/><w:tblBorders>{border}</w:tblBorders></w:tblPr>{rows}</w:tbl><w:p/>");
            }
        }
    }
    let document = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>{body}<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/><w:pgMar w:top=\"1134\" w:right=\"1134\" w:bottom=\"1134\" w:left=\"1134\"/></w:sectPr></w:body></w:document>"
    );
    let types = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>";
    let rels = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>";
    Export {
        body: zip(&[("[Content_Types].xml", types.as_bytes()), ("_rels/.rels", rels.as_bytes()), ("word/document.xml", document.as_bytes())]),
        ctype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers: vec![],
    }
}

const ODT_MIME: &str = "application/vnd.oasis.opendocument.text";

pub fn odt(m: &Meeting, segs: &[Segment]) -> Export {
    let mut body = String::new();
    for b in blocks(m, segs) {
        match b {
            Block::Title(v) => body += &format!("<text:h text:outline-level=\"1\" text:style-name=\"Title\">{}</text:h>", x(&v)),
            Block::Meta(v) => body += &format!("<text:p text:style-name=\"Meta\">{}</text:p>", x(&v)),
            Block::H(v) => body += &format!("<text:h text:outline-level=\"2\" text:style-name=\"Heading\">{}</text:h>", x(&v)),
            Block::Li(v) => body += &format!("<text:list><text:list-item><text:p>{}</text:p></text:list-item></text:list>", x(&v)),
            Block::P(v) => body += &format!("<text:p>{}</text:p>", x(&v)),
            Block::Table(rows) => {
                let cols = rows[0].len();
                let rows: String = rows
                    .iter()
                    .enumerate()
                    .map(|(r, row)| {
                        let cells: String = row.iter().map(|c| format!("<table:table-cell table:style-name=\"Cell\" office:value-type=\"string\"><text:p{}>{}</text:p></table:table-cell>", if r == 0 { " text:style-name=\"Bold\"" } else { "" }, x(c))).collect();
                        format!("<table:table-row>{cells}</table:table-row>")
                    })
                    .collect();
                body += &format!("<table:table table:name=\"ActionItems\"><table:table-column table:number-columns-repeated=\"{cols}\"/>{rows}</table:table>");
            }
        }
    }
    let content = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><office:document-content xmlns:office=\"urn:oasis:names:tc:opendocument:xmlns:office:1.0\" xmlns:text=\"urn:oasis:names:tc:opendocument:xmlns:text:1.0\" xmlns:table=\"urn:oasis:names:tc:opendocument:xmlns:table:1.0\" xmlns:style=\"urn:oasis:names:tc:opendocument:xmlns:style:1.0\" xmlns:fo=\"urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0\" office:version=\"1.2\"><office:automatic-styles>\
<style:style style:name=\"Title\" style:family=\"paragraph\"><style:text-properties fo:font-size=\"20pt\" fo:font-weight=\"bold\"/></style:style>\
<style:style style:name=\"Heading\" style:family=\"paragraph\"><style:paragraph-properties fo:margin-top=\"0.4cm\"/><style:text-properties fo:font-size=\"14pt\" fo:font-weight=\"bold\" fo:color=\"#3a33c4\"/></style:style>\
<style:style style:name=\"Meta\" style:family=\"paragraph\"><style:text-properties fo:color=\"#5c6487\"/></style:style>\
<style:style style:name=\"Bold\" style:family=\"paragraph\"><style:text-properties fo:font-weight=\"bold\"/></style:style>\
<style:style style:name=\"Cell\" style:family=\"table-cell\"><style:table-cell-properties fo:border=\"0.5pt solid #dee0f1\" fo:padding=\"0.1cm\"/></style:style>\
</office:automatic-styles><office:body><office:text>{body}</office:text></office:body></office:document-content>"
    );
    let manifest = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><manifest:manifest xmlns:manifest=\"urn:oasis:names:tc:opendocument:xmlns:manifest:1.0\" manifest:version=\"1.2\"><manifest:file-entry manifest:full-path=\"/\" manifest:version=\"1.2\" manifest:media-type=\"{ODT_MIME}\"/><manifest:file-entry manifest:full-path=\"content.xml\" manifest:media-type=\"text/xml\"/></manifest:manifest>"
    );
    Export {
        body: zip(&[("mimetype", ODT_MIME.as_bytes()), ("META-INF/manifest.xml", manifest.as_bytes()), ("content.xml", content.as_bytes())]),
        ctype: ODT_MIME,
        headers: vec![],
    }
}

// ---- calendar

fn valid(y: i64, m: u32, d: u32) -> bool {
    d >= 1 && (1..=12).contains(&m) && db::civil_from_days(db::days_from_civil(y, m, d)) == (y, m, d)
}

/// Monday = 0, as Python's date.weekday().
fn weekday(days: i64) -> i64 {
    (days + 3).rem_euclid(7) // 1970-01-01 was a Thursday
}

/// A due text ("Friday", "tomorrow", "next week", "Oct 30", "30 October", "the 14th") as days
/// since 1970, counted from the meeting's day `anchor`; None when it names no day.
pub fn resolve_due(text: &str, anchor: i64) -> Option<i64> {
    let t = text.trim().to_lowercase().replace(',', " ");
    if t.is_empty() {
        return None;
    }
    let has = |p: &str| Regex::new(p).map(|r| r.is_match(&t)).unwrap_or(false);
    if has(r"\btoday\b") {
        return Some(anchor);
    }
    if has(r"\btomorrow\b") {
        return Some(anchor + 1);
    }
    if has(r"\bnext week\b") {
        return Some(anchor + 7 - weekday(anchor)); // the Monday after
    }
    // full names first, then abbreviations: Python's dict order
    let names = DAY_NAMES.iter().map(|n| n.to_string()).chain(DAY_NAMES.iter().map(|n| n[..3].to_string()));
    for (k, name) in names.enumerate() {
        if has(&format!(r"\b{name}\b")) {
            let wd = (k % 7) as i64;
            return Some(anchor + (wd - weekday(anchor) - 1).rem_euclid(7) + 1); // strictly after
        }
    }
    let month = |s: &str| -> Option<u32> {
        MONTH_NAMES.iter().position(|n| n.to_lowercase() == s || n[..3].to_lowercase() == s).map(|i| i as u32 + 1)
    };
    let (ay, am, _) = db::civil_from_days(anchor);
    const DAY: &str = r"(\d{1,2})(?:st|nd|rd|th)?";
    for (pat, md) in [(format!(r"\b([a-z]+)\.?\s+{DAY}\b"), true), (format!(r"\b{DAY}\s+(?:of\s+)?([a-z]+)\b"), false)] {
        for c in Regex::new(&pat).ok()?.captures_iter(&t) {
            let (mon, day) = if md { (&c[1], &c[2]) } else { (&c[2], &c[1]) };
            if let (Some(mo), Ok(d)) = (month(mon), day.parse::<u32>()) {
                for y in [ay, ay + 1] {
                    if !valid(y, mo, d) {
                        break;
                    }
                    let n = db::days_from_civil(y, mo, d);
                    if n >= anchor {
                        return Some(n);
                    }
                }
            }
        }
    }
    if let Some(c) = Regex::new(&format!(r"\bthe\s+{DAY}\b")).ok()?.captures(&t) {
        let d: u32 = c[1].parse().ok()?;
        let (mut y, mut mo) = (ay, am);
        for _ in 0..13 {
            if valid(y, mo, d) && db::days_from_civil(y, mo, d) >= anchor {
                return Some(db::days_from_civil(y, mo, d));
            }
            (y, mo) = if mo == 12 { (y + 1, 1) } else { (y, mo + 1) };
        }
    }
    None
}

fn ical_text(v: &str) -> String {
    v.replace('\\', "\\\\").replace(';', "\\;").replace(',', "\\,").replace('\r', "").replace('\n', "\\n")
}

/// RFC 5545: lines of at most 75 octets, continued with a leading space, never inside a character.
fn fold(line: &str) -> String {
    let mut b = line.as_bytes();
    let mut out: Vec<&str> = Vec::new();
    while b.len() > 75 {
        let mut cut = if out.is_empty() { 75 } else { 74 };
        while cut > 0 && (b[cut] & 0xC0) == 0x80 {
            cut -= 1;
        }
        out.push(std::str::from_utf8(&b[..cut]).unwrap_or(""));
        b = &b[cut..];
    }
    out.push(std::str::from_utf8(b).unwrap_or(""));
    out.join("\r\n ")
}

/// The action items with a resolvable due date as VTODOs; X-Skipped-Items counts the rest.
pub fn ics(m: &Meeting) -> Result<Export, NoDates> {
    let (y, mo, d, h, mi, s) = parts(&m.created);
    let anchor = db::days_from_civil(y, mo, d);
    let dtstamp = format!("{y:04}{mo:02}{d:02}T{h:02}{mi:02}{s:02}Z");
    let (mut todos, mut skipped) = (Vec::new(), 0);
    for (n, item) in list(&m.action_items).iter().enumerate() {
        let Some(due) = resolve_due(&field(item, "due"), anchor) else {
            skipped += 1;
            continue;
        };
        let (dy, dm, dd) = db::civil_from_days(due);
        let owner = field(item, "owner");
        let desc: Vec<String> = [if owner.is_empty() { String::new() } else { format!("Owner: {owner}") }, format!("Meeting: {}", m.title), format!("Due as said: {}", field(item, "due"))]
            .into_iter()
            .filter(|x| !x.is_empty())
            .collect();
        todos.extend([
            "BEGIN:VTODO".to_string(),
            format!("UID:{}-{n}@privmeet", m.id),
            format!("DTSTAMP:{dtstamp}"),
            format!("SUMMARY:{}", ical_text(&field(item, "task"))),
            format!("DUE;VALUE=DATE:{dy:04}{dm:02}{dd:02}"),
            format!("DESCRIPTION:{}", ical_text(&desc.join("\n"))),
            format!("STATUS:{}", if done(item) { "COMPLETED" } else { "NEEDS-ACTION" }),
            "END:VTODO".to_string(),
        ]);
    }
    if todos.is_empty() {
        return Err(NoDates);
    }
    let mut lines = vec!["BEGIN:VCALENDAR".to_string(), "VERSION:2.0".into(), "PRODID:-//PrivMeet//Action items//EN".into(), "CALSCALE:GREGORIAN".into()];
    lines.extend(todos);
    lines.push("END:VCALENDAR".into());
    let body = lines.iter().map(|l| fold(l)).collect::<Vec<_>>().join("\r\n") + "\r\n";
    Ok(Export { body: body.into_bytes(), ctype: "text/calendar; charset=utf-8", headers: vec![("X-Skipped-Items", skipped.to_string())] })
}

// ---- the recording, converted for sharing: mono, small, speech stays clear

pub fn audio_format(fmt: &str) -> Option<(&'static [&'static str], &'static str)> {
    match fmt {
        "mp3" => Some((&["-c:a", "libmp3lame", "-b:a", "64k", "-f", "mp3"], "audio/mpeg")),
        "opus" => Some((&["-c:a", "libopus", "-b:a", "32k", "-f", "ogg"], "audio/ogg")),
        _ => None,
    }
}

/// The cached conversion of the meeting's audio, made on first request; Ok(None) when the
/// meeting has no audio file any more.
pub fn audio_copy(src: &Path, fmt: &str) -> Result<Option<PathBuf>, String> {
    let Some((args, _)) = audio_format(fmt) else { return Ok(None) };
    if !src.is_file() {
        return Ok(None);
    }
    let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("audio");
    let dst = src.with_file_name(format!("{stem}.share.{fmt}"));
    let mtime = |p: &Path| p.metadata().and_then(|m| m.modified()).ok();
    if !dst.is_file() || mtime(&dst) < mtime(src) {
        let tmp = dst.with_file_name(format!("{stem}.share.{fmt}.part"));
        let mut cmd = Command::new("ffmpeg");
        cmd.args(["-nostdin", "-y", "-loglevel", "error", "-i"]).arg(src).args(["-vn", "-ac", "1"]).args(args).arg(&tmp);
        crate::audio::run(&mut cmd, Duration::from_secs(3 * 3600))?; // the pipeline's timeout rule
        std::fs::rename(&tmp, &dst).map_err(|e| e.to_string())?; // a half-written file is never served
    }
    Ok(Some(dst))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(y: i64, m: u32, d: u32) -> i64 {
        db::days_from_civil(y, m, d)
    }

    #[test]
    fn due_dates_like_python() {
        let a = day(2026, 10, 28); // a Wednesday
        assert_eq!(weekday(a), 2);
        assert_eq!(resolve_due("Friday", a), Some(day(2026, 10, 30)));
        assert_eq!(resolve_due("wed", a), Some(day(2026, 11, 4))); // strictly after
        assert_eq!(resolve_due("tomorrow", a), Some(a + 1));
        assert_eq!(resolve_due("next week", a), Some(day(2026, 11, 2)));
        assert_eq!(resolve_due("Oct 30", a), Some(day(2026, 10, 30)));
        assert_eq!(resolve_due("30 of October", a), Some(day(2026, 10, 30)));
        assert_eq!(resolve_due("Jan 5", a), Some(day(2027, 1, 5)));
        assert_eq!(resolve_due("the 14th", a), Some(day(2026, 11, 14)));
        assert_eq!(resolve_due("end of quarter", a), None);
        assert_eq!(resolve_due("Feb 30", a), None);
    }

    #[test]
    fn zip_crc_and_fold() {
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
        let z = zip(&[("a.txt", b"hi")]);
        assert_eq!(&z[..4], b"PK\x03\x04");
        let long = "x".repeat(80) + "é".repeat(40).as_str();
        assert!(fold(&long).split("\r\n").all(|l| l.len() <= 75));
        assert_eq!(fold(&long).replace("\r\n ", ""), long);
    }

    #[test]
    fn stamps_and_names() {
        assert_eq!(stamp(3725.5, ','), "01:02:05,500");
        assert_eq!(mmss(65.9), "01:05");
        assert_eq!(mmss(3723.0), "1:02:03");
        assert_eq!(long_date("2026-11-07T10:00:00+00:00"), "November 7, 2026");
        assert_eq!(esc("<a href='x'>&\"</a>"), "&lt;a href=&#x27;x&#x27;&gt;&amp;&quot;&lt;/a&gt;");
    }
}
