//! Map-reduce summaries and transcript Q&A sized to small local models: a port of
//! backend/meetings/pipeline/llm.py with the same prompts, budgets, parsing, de-duplication,
//! grounding, summary check and citations. LangChain's role (templates, splitter, chat) is
//! covered by plain functions here and providers::chat.

use std::collections::HashSet;
use std::sync::OnceLock;

use regex::Regex;
use serde_json::{json, Value};

use crate::hw::Profile;
use crate::providers;

// Token budget: qwen2.5 averages ~3.5 chars per token on English talk, less on names and
// numbers, so 3 is the safe side.
pub const CHARS_PER_TOKEN: i64 = 3;
pub const PROMPT_TOKENS: i64 = 450;
pub const MAP_REPLY_TOKENS: i64 = 500;
pub const REDUCE_REPLY_TOKENS: i64 = 900;
pub const QA_REPLY_TOKENS: i64 = 350;
pub const VERIFY_REPLY_TOKENS: i64 = 400;
pub const MAX_ROUNDS: usize = 4;
/// qwen2.5:1.5b fed ~3000 tokens kept the decisions of one topic in five; ~1500 keeps them all.
pub const MAP_CHUNK_TOKENS: i64 = 1500;

pub const MAP_SYSTEM: &str = "You take notes on one part of a meeting transcript. Lines look like \
\"[mm:ss] Name: words\" or \"[mm:ss] words\".\n\
For every topic discussed write these lines, in English:\n\
TOPIC: <topic> - <one sentence: the problem or point, with numbers as said>\n\
DECISION: <what was agreed, one sentence>   (only if something was agreed)\n\
TASK: <owner> | <task> | <due>   (one line per task someone agreed to do)\n\
Owner is the name of the person doing the task, only if that name is in the text; \
otherwise leave it empty. Due is the deadline only if one was said, else empty.\n\
A TASK line is only for work a speaker says will be done after this meeting. Never \
turn a fact, a plan already finished or a thing being described into a task. Many \
parts have no decision and no task: then write only TOPIC lines.\n\
If a speaker corrects an earlier number or claim, write the corrected one.\n\
Example:\n\
TOPIC: museum trip - transport is still open\n\
DECISION: take the 9 am bus\n\
TASK: Asha | book the bus | June 3\n\
TASK:  | collect consent forms | \n\
Never copy the example. Do not add anything that is not in the transcript.";

pub const REDUCE_SYSTEM: &str = "You write the final notes of one meeting from its transcript or from notes on its parts. \
Reply with one JSON object and nothing else:\n\
{\"summary\": \"...\", \"decisions\": [\"...\"], \"action_items\": [{\"owner\": \"...\", \"task\": \"...\", \"due\": \"...\"}]}\n\
Rules:\n\
- summary: 3 to 6 sentences in English: the purpose, the main points and the outcome. \
When the text lists many TOPIC lines, name every topic briefly.\n\
- When the text says two different things about the same point, the later one is \
right: a speaker correcting an earlier claim wins over the claim. Write the \
correction, not what was said first. If the text says \"we need 200 chairs\" and \
later \"correction, 120 chairs\", write 120, and never write 200 anywhere. If one \
line calls something the first or the best and a later line says it is the third, \
write the third.\n\
- decisions: things the group agreed or concluded, one short sentence each. [] if none.\n\
- action_items: concrete tasks someone will do after the meeting. task starts with a verb. \
owner is the person's name as spoken, or \"\" if nobody took it. due is the deadline as \
spoken (\"Friday\", \"next week\", \"Oct 30\"), or \"\" if none was said.\n\
- action_items is [] whenever nobody agreed to do anything, and [] is a correct \
answer. Many recordings are a talk, a lecture or a news report and hold no tasks at \
all. Write an item only when a speaker says work will be done after this meeting; \
never build one out of something that was merely described, and never think of \
work yourself.\n\
- Use only facts from the text. Never invent names, dates or tasks.\n\
Example, for a different meeting about a school trip:\n\
{\"summary\": \"The teachers planned the museum trip. Transport was the open issue. They chose \
the 9 am bus.\", \"decisions\": [\"Take the 9 am bus\"], \
\"action_items\": [{\"owner\": \"Asha\", \"task\": \"Book the bus\", \"due\": \"June 3\"}, \
{\"owner\": \"\", \"task\": \"Collect consent forms\", \"due\": \"\"}]}\n\
Never copy names, tasks or dates from this example.";

pub const QA_SYSTEM: &str = "You answer questions about one meeting using only the transcript excerpts given. \
Lines look like \"[mm:ss] Name: words\".\n\
- Answer the question directly in your own words, in 1 to 3 sentences. Do not just \
repeat transcript lines.\n\
- End each sentence with the timestamp of the line it comes from, in square brackets, \
copied exactly, for example [12:34]. Never make up a timestamp.\n\
- If the excerpts do not contain the answer, reply: The meeting does not say.\n\
Example: Question: Who books the bus? Answer: Asha books the bus by June 3 [04:12].";

pub const VERIFY_SYSTEM: &str = "You check one summary against the transcript it was written from. Reply with the \
corrected summary and nothing else: no heading, no comment, no quotes.\n\
- Keep the same language, length and style: 3 to 6 sentences of plain prose.\n\
- Change only what the transcript contradicts: a number, a name, a date, a ranking or \
a claim that a later line corrects. When two lines disagree, the later one is right.\n\
- Example: the transcript says \"it is the fastest ever\" and later \"it is the third \
fastest\"; a summary saying \"the fastest\" has to say \"the third fastest\".\n\
- Drop a claim the transcript does not support. Never add a fact of your own.\n\
- If nothing is wrong, reply with the summary exactly as it is.";

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("valid regex"))
}

/// How much text fits in one call next to the prompt and a reply of `reply_tokens`.
pub fn input_chars(p: &Profile, reply_tokens: i64) -> usize {
    ((p.num_ctx - PROMPT_TOKENS - reply_tokens) * CHARS_PER_TOKEN).max(1000) as usize
}

pub fn map_chars(p: &Profile) -> usize {
    input_chars(p, MAP_REPLY_TOKENS).min((MAP_CHUNK_TOKENS * CHARS_PER_TOKEN) as usize)
}

pub fn qa_chars(p: &Profile) -> usize {
    input_chars(p, QA_REPLY_TOKENS)
}

// ---------------------------------------------------------------- splitting

fn len(s: &str) -> usize {
    s.chars().count()
}

/// LangChain's RecursiveCharacterTextSplitter: split on transcript lines first, then
/// sentences, words, characters, so a chunk never starts mid-sentence or loses its timestamp.
/// Separators stay at the start of the piece they split off; overlap is size / 20.
pub fn split(text: &str, size: usize) -> Vec<String> {
    split_with(text, size, size / 20, &["\n", ". ", " ", ""])
}

fn split_with(text: &str, size: usize, overlap: usize, seps: &[&str]) -> Vec<String> {
    let (sep, rest) = match seps.iter().position(|s| s.is_empty() || text.contains(s)) {
        Some(i) => (seps[i], &seps[i + 1..]),
        None => ("", &[][..]),
    };
    let pieces: Vec<String> = if sep.is_empty() {
        text.chars().map(String::from).collect()
    } else {
        let mut out = Vec::new();
        for (i, part) in text.split(sep).enumerate() {
            out.push(if i == 0 { part.to_string() } else { format!("{sep}{part}") });
        }
        out.into_iter().filter(|p| !p.is_empty()).collect()
    };
    let (mut chunks, mut good): (Vec<String>, Vec<String>) = (Vec::new(), Vec::new());
    for piece in pieces {
        if len(&piece) < size {
            good.push(piece);
            continue;
        }
        if !good.is_empty() {
            chunks.extend(merge(&good, size, overlap));
            good.clear();
        }
        if rest.is_empty() {
            chunks.push(piece);
        } else {
            chunks.extend(split_with(&piece, size, overlap, rest));
        }
    }
    if !good.is_empty() {
        chunks.extend(merge(&good, size, overlap));
    }
    chunks.into_iter().map(|c| c.trim().to_string()).filter(|c| !c.is_empty()).collect()
}

/// Join small pieces into chunks of at most `size`, carrying the last `overlap` characters'
/// worth of pieces into the next chunk (LangChain's _merge_splits).
fn merge(pieces: &[String], size: usize, overlap: usize) -> Vec<String> {
    let (mut docs, mut cur, mut total) = (Vec::new(), std::collections::VecDeque::<&String>::new(), 0usize);
    for p in pieces {
        let l = len(p);
        if total + l > size && !cur.is_empty() {
            docs.push(cur.iter().map(|s| s.as_str()).collect::<String>());
            while total > overlap || (total + l > size && total > 0) {
                total -= len(cur.pop_front().unwrap());
            }
        }
        cur.push_back(p);
        total += l;
    }
    if !cur.is_empty() {
        docs.push(cur.iter().map(|s| s.as_str()).collect::<String>());
    }
    docs
}

// ---------------------------------------------------------------- parsing

const EMPTY: &[&str] = &[
    "", "none", "n/a", "na", "unknown", "unassigned", "not specified", "not mentioned", "tbd", "-", "null",
    "no fixed date", "no date", "no deadline", "not set",
];

/// The first JSON object in a reply: small models sometimes wrap it in ``` or add a line.
fn json_object(raw: &str) -> Option<Value> {
    static FENCE: OnceLock<Regex> = OnceLock::new();
    let text = re(&FENCE, r"(?i)^```(?:json)?\s*|\s*```$").replace_all(raw.trim(), "").to_string();
    if let Ok(v) = serde_json::from_str::<Value>(&text) {
        return Some(v);
    }
    let (s, e) = (text.find('{')?, text.rfind('}')?);
    (s < e).then(|| serde_json::from_str(&text[s..=e]).ok()).flatten()
}

fn norm_key(k: &str) -> String {
    k.to_lowercase().chars().filter(|c| !c.is_whitespace() && *c != '_' && *c != '-').collect()
}

fn pick<'a>(d: &'a serde_json::Map<String, Value>, keys: &[&str]) -> Option<&'a Value> {
    keys.iter().filter_map(|k| d.get(*k)).find(|v| !v.is_null() && v.as_str() != Some(""))
}

fn as_text(v: Option<&Value>) -> String {
    match v {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Bool(false)) => String::new(),
        Some(Value::Number(n)) if n.as_f64() == Some(0.0) => String::new(),
        Some(other) => other.to_string(),
    }
}

fn clean(v: Option<&Value>, limit: usize) -> String {
    let s = as_text(v).trim().to_string();
    if EMPTY.contains(&s.to_lowercase().as_str()) { String::new() } else { s.chars().take(limit).collect() }
}

fn as_list(v: Option<&Value>) -> Vec<Value> {
    match v {
        None | Some(Value::Null) => vec![],
        Some(Value::Array(a)) => a.clone(),
        Some(other) => vec![other.clone()],
    }
}

/// The notes: {summary, decisions, action_items[{owner, task, due, done}]}.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Notes {
    pub summary: String,
    pub decisions: Vec<String>,
    pub action_items: Vec<Item>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Item {
    pub owner: String,
    pub task: String,
    pub due: String,
}

impl Notes {
    pub fn items_json(&self) -> Value {
        Value::Array(self.action_items.iter().map(|i| json!({"owner": i.owner, "task": i.task, "due": i.due, "done": false})).collect())
    }
}

/// Turn the model's reply into notes. Never fails: bad JSON keeps the text as the summary,
/// and JSON cut off mid-way keeps the summary string if it got that far.
pub fn parse_notes(raw: &str) -> Notes {
    static SUMMARY_FIELD: OnceLock<Regex> = OnceLock::new();
    let mut data = json_object(raw);
    if data.is_none() && (raw.trim_start().starts_with('{') || raw.trim_start().starts_with("```")) {
        let summary = re(&SUMMARY_FIELD, r#"(?i)"summary"\s*:\s*"((?:[^"\\]|\\.)*)""#)
            .captures(raw)
            .and_then(|c| serde_json::from_str::<String>(&format!("\"{}\"", &c[1])).ok())
            .unwrap_or_default();
        data = Some(json!({ "summary": summary }));
    } else if data.is_none() {
        data = Some(json!({ "summary": raw }));
    }
    let obj = match data {
        Some(Value::Object(o)) => o,
        _ => serde_json::Map::new(),
    };
    let norm: serde_json::Map<String, Value> = obj.into_iter().map(|(k, v)| (norm_key(&k), v)).collect();

    let summary = match pick(&norm, &["summary", "overview"]) {
        Some(Value::Array(a)) => a.iter().map(|x| as_text(Some(x))).collect::<Vec<_>>().join(" "),
        other => as_text(other),
    };
    let mut decisions: Vec<String> = Vec::new();
    for d in as_list(pick(&norm, &["decisions", "keypoints", "decision"])) {
        let d = match &d {
            Value::Object(o) => clean(pick(o, &["decision", "text", "point", "description"]), 500),
            other => clean(Some(other), 500),
        };
        if !d.is_empty() && !decisions.contains(&d) {
            decisions.push(d);
        }
    }
    let mut items = Vec::new();
    for i in as_list(pick(&norm, &["actionitems", "actions", "tasks", "todos"])) {
        let obj = match i {
            Value::String(s) => {
                let mut m = serde_json::Map::new();
                m.insert("task".into(), Value::String(s));
                m
            }
            Value::Object(o) => o.into_iter().map(|(k, v)| (norm_key(&k), v)).collect(),
            _ => continue,
        };
        let task = clean(pick(&obj, &["task", "action", "item", "description", "what"]), 500);
        if task.is_empty() {
            continue;
        }
        items.push(Item {
            owner: clean(pick(&obj, &["owner", "assignee", "who", "person", "responsible"]), 60),
            task,
            due: clean(pick(&obj, &["due", "duedate", "deadline", "when", "by"]), 60),
        });
    }
    Notes { summary: summary.trim().to_string(), decisions, action_items: items }
}

// ---------------------------------------------------------------- harvest, dedupe, merge

const PER_CHUNK: usize = 6;
const MAX_DECISIONS: usize = 15;
const MAX_ITEMS: usize = 20;

fn strip_md(t: &str) -> String {
    t.trim().trim_matches(|c| c == '*' || c == '_' || c == '`').trim().trim_end_matches('.').trim().to_string()
}

/// DECISION: and TASK: lines from the map step, in meeting order (at most 6 of each per chunk:
/// a looping model can write dozens for one chunk).
pub fn harvest(parts: &[String]) -> Notes {
    static LINE: OnceLock<Regex> = OnceLock::new();
    static LEAD: OnceLock<Regex> = OnceLock::new();
    static NO: OnceLock<Regex> = OnceLock::new();
    static DUE: OnceLock<Regex> = OnceLock::new();
    let line = re(&LINE, r"(?im)^\W*(DECISION|TASK)\s*:\s*(.+)$");
    let lead = re(&LEAD, r"(?i)^(?:so\s+)?(?:the\s+)?decision\s+(?:is|was)\s*(?:to|that)?\s*:?\s*");
    let no = re(&NO, r"(?i)^(?:none|no\b|n/a|nothing\b)");
    let due_lead = re(&DUE, r"(?i)^due\s*:\s*");
    let (mut decisions, mut items) = (Vec::new(), Vec::new());
    for part in parts {
        let (mut d_n, mut t_n) = (0, 0);
        for c in line.captures_iter(part) {
            let rest = strip_md(&c[2]);
            if c[1].eq_ignore_ascii_case("DECISION") {
                let rest = lead.replace(&rest, "").trim().to_string();
                if !rest.is_empty() && !no.is_match(&rest) && d_n < PER_CHUNK {
                    let mut ch = rest.chars();
                    decisions.push(ch.next().map(|f| f.to_uppercase().collect::<String>() + ch.as_str()).unwrap_or_default());
                    d_n += 1;
                }
                continue;
            }
            if t_n >= PER_CHUNK {
                continue;
            }
            let (owner, task, due) = if rest.contains('|') {
                let mut p: Vec<String> = rest.split('|').map(strip_md).collect();
                p.resize(3, String::new());
                (p[0].clone(), p[1].clone(), p[2].clone())
            } else {
                (String::new(), rest.clone(), String::new())
            };
            items.push(json!({"owner": owner, "task": task, "due": due_lead.replace(&due, "").to_string()}));
            t_n += 1;
        }
    }
    parse_notes(&json!({"decisions": decisions, "action_items": items}).to_string())
}

fn key(text: &str) -> String {
    words_list(text).join(" ").chars().take(60).collect()
}

fn words_list(text: &str) -> Vec<String> {
    text.to_lowercase().split(|c: char| !(c.is_alphanumeric() || c == '_')).filter(|w| !w.is_empty()).map(String::from).collect()
}

fn words(text: &str) -> HashSet<String> {
    words_list(text).into_iter().collect()
}

const FILLER: &[&str] = &["a", "an", "the", "and", "or", "to", "of", "for", "on", "in", "by", "with", "it", "its", "be", "new", "up"];

fn synonym(w: &str) -> &str {
    match w {
        "move" | "change" | "migrate" | "replace" => "switch",
        "install" | "set" | "add" | "configure" => "setup",
        "share" | "email" | "forward" => "send",
        "repair" | "resolve" | "patch" => "fix",
        "release" | "ship" | "publish" => "launch",
        "update" | "revise" => "rewrite",
        other => other,
    }
}

/// Content words: lower case, ordinals as numbers ("28th" -> "28"), synonyms folded.
fn content_words(text: &str) -> HashSet<String> {
    words_list(text)
        .into_iter()
        .map(|w| {
            let digits: String = w.chars().take_while(char::is_ascii_digit).collect();
            let tail = &w[digits.len()..];
            if !digits.is_empty() && matches!(tail, "st" | "nd" | "rd" | "th") { digits } else { w }
        })
        .map(|w| synonym(&w).to_string())
        .filter(|w| !FILLER.contains(&w.as_str()))
        .collect()
}

/// Two lines say the same thing when 75 % of the shorter one's content words are in the other.
fn same(a: &HashSet<String>, b: &HashSet<String>) -> bool {
    !a.is_empty() && !b.is_empty() && a.intersection(b).count() as f64 / a.len().min(b.len()) as f64 >= 0.75
}

/// Drop repeats, exact or re-worded, keeping the first (the map step's line).
pub fn dedupe<T: Clone>(values: &[T], text: impl Fn(&T) -> String) -> Vec<T> {
    let (mut kept, mut out): (Vec<(String, HashSet<String>)>, Vec<T>) = (Vec::new(), Vec::new());
    for v in values {
        let t = text(v);
        let (k, w) = (key(&t), content_words(&t));
        if k.is_empty() || kept.iter().any(|(kk, ww)| *kk == k || same(&w, ww)) {
            continue;
        }
        kept.push((k, w));
        out.push(v.clone());
    }
    out
}

/// Decisions and tasks from the map step, the summary from the reduce call. When the reduce
/// call read the whole transcript (`union`) its lists are added after the map lines.
pub fn merge_notes(found: &Notes, notes: Notes, union: bool) -> Notes {
    let pick_list = |a: &Vec<String>, b: &Vec<String>| if union { [a.clone(), b.clone()].concat() } else if a.is_empty() { b.clone() } else { a.clone() };
    let decisions = pick_list(&found.decisions, &notes.decisions);
    let items = if union {
        [found.action_items.clone(), notes.action_items.clone()].concat()
    } else if found.action_items.is_empty() {
        notes.action_items.clone()
    } else {
        found.action_items.clone()
    };
    let mut d = dedupe(&decisions, |s| s.clone());
    d.truncate(MAX_DECISIONS);
    let mut i = dedupe(&items, |x| x.task.clone());
    i.truncate(MAX_ITEMS);
    Notes { summary: notes.summary, decisions: d, action_items: i }
}

// ---------------------------------------------------------------- grounding

const GENERIC: &[&str] = &["the", "next", "this", "end", "of", "by", "on", "before", "after", "week", "day", "until", "and", "or", "a", "an", "in", "at", "to"];

fn meaning(text: &str) -> HashSet<String> {
    words(text).into_iter().filter(|w| !GENERIC.contains(&w.as_str())).collect()
}

/// Whether a model-written owner or due was actually said: every meaningful word occurs in the
/// transcript; for only-common words ("next week") the phrase itself must be there.
fn said(value: &str, source: &HashSet<String>, source_text: &str) -> bool {
    let m = meaning(value);
    if !m.is_empty() {
        return m.is_subset(source);
    }
    let phrase = words_list(value).join(" ");
    !phrase.is_empty() && format!(" {source_text} ").contains(&format!(" {phrase} "))
}

/// More than half the content words of a task or decision occur in the transcript.
fn on_topic(text: &str, source: &HashSet<String>) -> bool {
    let content: HashSet<String> = meaning(text).into_iter().filter(|w| w.chars().count() > 2).collect();
    content.len() < 2 || content.intersection(source).count() * 2 > content.len()
}

/// Whether anyone in an English transcript said they would do something.
fn has_commitment(transcript: &str, language: &str) -> bool {
    static C: OnceLock<Regex> = OnceLock::new();
    if !language.to_lowercase().starts_with("en") {
        return true;
    }
    re(&C, r"(?i)i'll|i will|we'll|we will|let's|can you|could you|going to|need to|needs to|have to|has to|should |make sure|follow up|action item|take care of|i'm on it|assign|deadline|send (?:you|me|over|the)|take that|owns? this|by (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week|end of)")
        .is_match(transcript)
}

/// Drop what the transcript does not support: tasks in a recording where nobody took on
/// work, lines about another meeting, owners and dues nobody said. English only: other
/// languages get English notes, so word checks would drop everything.
pub fn ground(mut notes: Notes, transcript: &str, language: &str) -> Notes {
    if !notes.action_items.is_empty() && !has_commitment(transcript, language) {
        eprintln!("dropping {} action items: nobody in this recording took on work", notes.action_items.len());
        notes.action_items.clear();
    }
    if !(if language.is_empty() { "en" } else { language }).to_lowercase().starts_with("en") {
        return notes;
    }
    let source = words(transcript);
    let text = words_list(transcript).join(" ");
    notes.decisions.retain(|d| on_topic(d, &source));
    notes.action_items.retain(|i| on_topic(&i.task, &source));
    for item in &mut notes.action_items {
        if !item.owner.is_empty() && !said(&item.owner, &source, &text) {
            item.owner.clear();
        }
        if !item.due.is_empty() && !said(&item.due, &source, &text) {
            item.due.clear();
        }
    }
    notes
}

// ---------------------------------------------------------------- summary check

/// Keep the start and the end when `text` does not fit: outcomes and corrections come late.
pub fn trim_to(text: &str, room: usize) -> String {
    if len(text) <= room {
        return text.to_string();
    }
    let half = room / 2;
    let chars: Vec<char> = text.chars().collect();
    format!("{}\n...\n{}", chars[..half].iter().collect::<String>(), chars[chars.len() - half..].iter().collect::<String>())
}

fn ranks(text: &str) -> HashSet<String> {
    static R: OnceLock<Regex> = OnceLock::new();
    re(&R, r"(?i)(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th))")
        .find_iter(text)
        .map(|m| m.as_str().to_lowercase())
        .collect()
}

fn check_once(summary: &str, text: &str, p: &Profile) -> String {
    static FENCE: OnceLock<Regex> = OnceLock::new();
    let reply = match providers::chat(p, VERIFY_SYSTEM, &format!("Transcript:\n{text}\n\nSummary:\n{summary}"), false, Some(VERIFY_REPLY_TOKENS)) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("summary check failed ({e}), keeping the original");
            return String::new();
        }
    };
    let reply = re(&FENCE, r"(?i)^```(?:json)?\s*|\s*```$").replace_all(reply.trim(), "").trim().trim_matches('"').trim().to_string();
    let (rl, sl) = (len(&reply), len(summary));
    if reply.is_empty() || rl < sl / 3 || rl > 2 * sl + 200 {
        return String::new();
    }
    let low = reply.to_lowercase();
    if ["the summary", "corrected summary", "here", "i ", "note"].iter().any(|s| low.starts_with(s)) {
        return String::new();
    }
    reply
}

/// One extra call that checks the summary against the transcript and fixes what a later line
/// corrects (bug B5). Fail-safe: an unusable reply keeps the original; a reply that invents a
/// rank the transcript never said is retried once, then dropped.
pub fn verify(summary: &str, transcript: &str, p: &Profile) -> String {
    if summary.trim().is_empty() || transcript.trim().is_empty() {
        return summary.to_string();
    }
    let text = trim_to(transcript, input_chars(p, VERIFY_REPLY_TOKENS));
    let said = ranks(transcript);
    for _ in 0..2 {
        let reply = check_once(summary, &text, p);
        if reply.is_empty() {
            break;
        }
        if !ranks(&reply).is_subset(&said) {
            continue;
        }
        return reply;
    }
    summary.to_string()
}

/// The map-reduce summary. `on_progress` gets 0..1 over the map step; `focus` is the note
/// template's instructions.
pub fn summarize(transcript: &str, p: &Profile, on_progress: &dyn Fn(f64), language: &str, focus: &str) -> Result<Notes, String> {
    if transcript.trim().is_empty() {
        return Ok(parse_notes("{}"));
    }
    let focus = focus.trim();
    let reduce_room = input_chars(p, REDUCE_REPLY_TOKENS).saturating_sub(len(focus));
    let (mut notes, mut found): (String, Option<Notes>) = (transcript.to_string(), None);
    for round in 0..MAX_ROUNDS {
        if round > 0 && len(&notes) <= reduce_room {
            break;
        }
        let chunks = split(&notes, map_chars(p));
        let mut parts = Vec::new();
        for (i, c) in chunks.iter().enumerate() {
            parts.push(providers::chat(p, MAP_SYSTEM, c, false, Some(MAP_REPLY_TOKENS))?.trim().to_string());
            on_progress((i + 1) as f64 / chunks.len() as f64);
        }
        let mapped = parts.iter().filter(|x| !x.is_empty()).cloned().collect::<Vec<_>>().join("\n\n");
        if found.is_none() {
            found = Some(harvest(&parts));
        }
        if len(&notes) <= reduce_room {
            break; // short meeting: the reduce call reads the transcript itself
        }
        notes = mapped;
    }
    let union = notes == transcript;
    if len(&notes) > reduce_room {
        eprintln!("notes still {} chars after {MAX_ROUNDS} rounds, trimming to {reduce_room}", len(&notes));
        notes = trim_to(&notes, reduce_room);
    }
    let system = if focus.is_empty() { REDUCE_SYSTEM.to_string() } else { format!("{REDUCE_SYSTEM}\nWhat these notes should focus on: {focus}") };
    let raw = providers::chat(p, &system, &notes, true, Some(REDUCE_REPLY_TOKENS))?;
    let mut result = parse_notes(&raw);
    if let Some(f) = &found {
        result = merge_notes(f, result, union);
    }
    result.summary = verify(&result.summary, transcript, p);
    Ok(ground(result, transcript, language))
}

// ---------------------------------------------------------------- Q&A

/// Make sure an answer points at the transcript: when the model left out the [mm:ss], add
/// the stamps of the excerpt lines that share the most words with the answer and question;
/// with no such line at all the answer was made up.
pub fn cite(reply: &str, excerpts: &str, question: &str) -> String {
    static STAMP: OnceLock<Regex> = OnceLock::new();
    static AT_START: OnceLock<Regex> = OnceLock::new();
    let stamp = re(&STAMP, r"\[(\d{1,2}(?::\d{2}){1,2})\]");
    if stamp.is_match(reply) || reply.to_lowercase().starts_with("the meeting does not say") {
        return reply.to_string();
    }
    const SKIP: &[&str] = &["the", "and", "will", "was", "were", "that", "this", "with", "for", "they", "said", "meeting"];
    let content = |t: &str| -> HashSet<String> { words(t).into_iter().filter(|w| w.chars().count() > 2 && !SKIP.contains(&w.as_str())).collect() };
    let (ws, asked) = (content(reply), content(question));
    let start = re(&AT_START, r"^\[(\d{1,2}(?::\d{2}){1,2})\]");
    let mut scored: Vec<(usize, usize, String)> = Vec::new();
    for (n, line) in excerpts.lines().enumerate() {
        if let Some(m) = start.find(line) {
            let said = content(&line[m.end()..]);
            let overlap = ws.intersection(&said).count();
            if overlap >= 2 || (overlap > 0 && ws.len() <= 3) {
                scored.push((overlap + asked.intersection(&said).count(), n, m.as_str().to_string()));
            }
        }
    }
    scored.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    let mut stamps: Vec<String> = Vec::new();
    for (.., s) in scored {
        if !stamps.contains(&s) {
            stamps.push(s);
        }
    }
    if stamps.is_empty() {
        return "The meeting does not say.".into();
    }
    format!("{reply} {}", stamps[..stamps.len().min(2)].join(" "))
}

pub fn answer(excerpts: &str, question: &str, p: &Profile) -> Result<String, String> {
    let reply = providers::chat(p, QA_SYSTEM, &format!("Excerpts:\n{excerpts}\n\nQuestion: {question}"), false, Some(QA_REPLY_TOKENS))?;
    Ok(cite(reply.trim(), excerpts, question))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_like_python() {
        let n = parse_notes("```json\n{\"Summary\": \"S\", \"key points\": [\"A\", \"A\", \"none\"], \"Action-Items\": [{\"Task\": \"Fix it\", \"Owner\": \"N/A\", \"due date\": \"Friday\"}, \"Write docs\", {\"task\": \"\"}]}\n```");
        assert_eq!(n.summary, "S");
        assert_eq!(n.decisions, vec!["A"]);
        assert_eq!(n.action_items, vec![Item { owner: "".into(), task: "Fix it".into(), due: "Friday".into() }, Item { owner: "".into(), task: "Write docs".into(), due: "".into() }]);
        assert_eq!(parse_notes("{\"summary\": \"cut off he").summary, "");
        assert_eq!(parse_notes("{\"summary\": \"kept\", \"action_items\": [{\"tas").summary, "kept");
        assert_eq!(parse_notes("plain words").summary, "plain words");
    }

    #[test]
    fn harvests_and_dedupes() {
        let n = harvest(&["TOPIC: x\nDECISION: so the decision is to launch on Friday.\nDECISION: none\nTASK: Asha | **book the bus** | due: June 3\nTASK: collect forms".into()]);
        assert_eq!(n.decisions, vec!["Launch on Friday"]);
        assert_eq!(n.action_items[0], Item { owner: "Asha".into(), task: "book the bus".into(), due: "June 3".into() });
        assert_eq!(n.action_items[1].task, "collect forms");
        let d = dedupe(&["Move to the new mail provider".to_string(), "Switch to the new mail provider".into(), "Update the docs".into(), "Update the tests".into()], |s| s.clone());
        assert_eq!(d.len(), 3);
    }

    #[test]
    fn grounds_and_cites() {
        let t = "Asha: I will book the bus by Friday.";
        let n = Notes { summary: "s".into(), decisions: vec!["Take the 9 am bus to the museum".into()], action_items: vec![Item { owner: "Team X".into(), task: "Book the bus".into(), due: "Friday".into() }] };
        let g = ground(n.clone(), t, "English");
        assert!(g.decisions.is_empty());
        assert_eq!((g.action_items[0].owner.as_str(), g.action_items[0].due.as_str()), ("", "Friday"));
        assert_eq!(ground(n.clone(), "We talked about the weather.", "en").action_items.len(), 0);
        assert_eq!(ground(n, "Sab theek hai.", "Hindi").decisions.len(), 1);
        let ex = "[00:10] Asha: I will book the bus by Friday.\n[00:20] Ravi: Good.";
        assert_eq!(cite("Asha books the bus by Friday.", ex, "Who books the bus?"), "Asha books the bus by Friday. [00:10]");
        assert_eq!(cite("The budget is ten thousand.", ex, "budget?"), "The meeting does not say.");
    }

    #[test]
    fn splits_on_lines_with_overlap() {
        let text: String = (0..40).map(|i| format!("[00:{i:02}] Speaker {i}: some words here\n")).collect();
        let chunks = split(&text, 200);
        assert!(chunks.len() > 3 && chunks.iter().all(|c| c.chars().count() <= 200));
        assert!(chunks.iter().all(|c| c.starts_with('[')));
        assert_eq!(trim_to("abcdefghij", 4), "ab\n...\nij");
    }
}
