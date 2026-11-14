"""LangChain + Ollama: map-reduce summaries and transcript Q&A sized to small local models.

Tuned for qwen2.5:1.5b (low tier) and qwen2.5:3b (mid). Small models follow short, concrete
instructions with one worked example far better than long rules, so every prompt is a system
message with the rules plus a human message with the text. Every call also caps its reply
(`num_predict`) so prompt + reply always fit inside `num_ctx`: Ollama silently drops the
*start* of a prompt that is too long, which used to cut the first part of long meetings.
"""

import json
import logging
import re

from django.conf import settings
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_text_splitters import RecursiveCharacterTextSplitter

log = logging.getLogger(__name__)

# Token budget. qwen2.5 averages ~3.5 chars per token on English meeting talk and less on
# names, numbers and other languages, so 3 is the safe side.
CHARS_PER_TOKEN = 3
PROMPT_TOKENS = 450  # the longest system prompt below plus chat-template overhead
MAP_REPLY_TOKENS = 500
REDUCE_REPLY_TOKENS = 900
QA_REPLY_TOKENS = 350
MAX_ROUNDS = 4
# Small models lose track of a long chunk: qwen2.5:1.5b fed ~3000 tokens of a planning
# meeting kept the decisions of one topic in five. ~1500 tokens per map call keeps them all.
MAP_CHUNK_TOKENS = 1500

MAP_SYSTEM = (
    "You take notes on one part of a meeting transcript. Lines look like "
    '"[mm:ss] Name: words" or "[mm:ss] words".\n'
    "For every topic discussed write these lines, in English:\n"
    "TOPIC: <topic> - <one sentence: the problem or point, with numbers as said>\n"
    "DECISION: <what was agreed, one sentence>   (only if something was agreed)\n"
    "TASK: <owner> | <task> | <due>   (one line per task someone agreed to do)\n"
    "Owner is the name of the person doing the task, only if that name is in the text; "
    "otherwise leave it empty. Due is the deadline only if one was said, else empty.\n"
    "Example:\n"
    "TOPIC: museum trip - transport is still open\n"
    "DECISION: take the 9 am bus\n"
    "TASK: Asha | book the bus | June 3\n"
    "TASK:  | collect consent forms | \n"
    "Never copy the example. Do not add anything that is not in the transcript."
)
MAP_PROMPT = ChatPromptTemplate.from_messages([("system", MAP_SYSTEM), ("human", "{text}")])

REDUCE_SYSTEM = (
    "You write the final notes of one meeting from its transcript or from notes on its parts. "
    "Reply with one JSON object and nothing else:\n"
    '{{"summary": "...", "decisions": ["..."], '
    '"action_items": [{{"owner": "...", "task": "...", "due": "..."}}]}}\n'
    "Rules:\n"
    "- summary: 3 to 6 sentences in English: the purpose, the main points and the outcome. "
    "When the text lists many TOPIC lines, name every topic briefly.\n"
    "- decisions: things the group agreed or concluded, one short sentence each. "
    "[] if none.\n"
    "- action_items: concrete tasks someone will do after the meeting. task starts with a verb. "
    "owner is the person's name as spoken, or \"\" if nobody took it. due is the deadline as "
    "spoken (\"Friday\", \"next week\", \"Oct 30\"), or \"\" if none was said. [] if none.\n"
    "- Use only facts from the text. Never invent names, dates or tasks.\n"
    "Example, for a different meeting about a school trip:\n"
    '{{"summary": "The teachers planned the museum trip. Transport was the open issue. They chose '
    'the 9 am bus.", "decisions": ["Take the 9 am bus"], '
    '"action_items": [{{"owner": "Asha", "task": "Book the bus", "due": "June 3"}}, '
    '{{"owner": "", "task": "Collect consent forms", "due": ""}}]}}\n'
    "Never copy names, tasks or dates from this example."
)
REDUCE_PROMPT = ChatPromptTemplate.from_messages([("system", REDUCE_SYSTEM), ("human", "{text}")])

QA_SYSTEM = (
    "You answer questions about one meeting using only the transcript excerpts given. "
    "Lines look like \"[mm:ss] Name: words\".\n"
    "- Answer the question directly in your own words, in 1 to 3 sentences. Do not just "
    "repeat transcript lines.\n"
    "- End each sentence with the timestamp of the line it comes from, in square brackets, "
    "copied exactly, for example [12:34]. Never make up a timestamp.\n"
    "- If the excerpts do not contain the answer, reply: The meeting does not say.\n"
    "Example: Question: Who books the bus? Answer: Asha books the bus by June 3 [04:12]."
)
QA_PROMPT = ChatPromptTemplate.from_messages(
    [("system", QA_SYSTEM), ("human", "Excerpts:\n{text}\n\nQuestion: {question}")]
)


def ollama_url(prof):
    """The server set in Settings, else OLLAMA_URL from the environment."""
    return prof.get("ollama_url") or settings.OLLAMA_URL


def chat(prof, json_mode=False, num_predict=None):
    if prof.get("llm_provider", "ollama") != "ollama":
        from . import providers

        return providers.chat(prof, json_mode=json_mode, num_predict=num_predict)
    from langchain_ollama import ChatOllama

    return ChatOllama(
        model=prof["llm_model"],
        base_url=ollama_url(prof),
        num_ctx=prof["num_ctx"],
        num_predict=num_predict,
        keep_alive=prof["keep_alive"],
        num_thread=None if prof["device"] == "cuda" else prof["cpu_threads"],
        temperature=0.1,
        format="json" if json_mode else None,
    )


def ensure_model(prof):
    """Pull the tier's model on first use; a no-op when it is already present. Cloud
    providers host their own models, so there is nothing to pull."""
    if prof.get("llm_provider", "ollama") != "ollama":
        return
    import ollama

    ollama.Client(host=ollama_url(prof)).pull(prof["llm_model"])


def input_chars(prof, reply_tokens):
    """How much text fits in one call next to the prompt and a reply of `reply_tokens`."""
    return max(1000, (prof["num_ctx"] - PROMPT_TOKENS - reply_tokens) * CHARS_PER_TOKEN)


def map_chars(prof):
    """Map-step chunk size: what fits the context, capped at what a small model reads well."""
    return min(input_chars(prof, MAP_REPLY_TOKENS), MAP_CHUNK_TOKENS * CHARS_PER_TOKEN)


def qa_chars(prof):
    """Excerpt budget for one Q&A call."""
    return input_chars(prof, QA_REPLY_TOKENS)


# tasks.answer_question sizes its excerpts with this name.
chunk_chars = qa_chars


def split(text, prof, size=None):
    size = size or map_chars(prof)
    # Split on transcript lines first so a chunk never starts mid-sentence or loses its timestamp.
    return RecursiveCharacterTextSplitter(
        chunk_size=size, chunk_overlap=size // 20, separators=["\n", ". ", " ", ""]
    ).split_text(text)


FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)
SUMMARY_FIELD = re.compile(r'"summary"\s*:\s*"((?:[^"\\]|\\.)*)"', re.IGNORECASE)
EMPTY = {"", "none", "n/a", "na", "unknown", "unassigned", "not specified", "not mentioned", "tbd", "-", "null",
         "no fixed date", "no date", "no deadline", "not set"}


def _json_object(raw):
    """The first JSON object in a reply. Small models sometimes wrap it in ``` or add a line."""
    text = FENCE.sub("", (raw or "").strip())
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start, end = text.find("{"), text.rfind("}")
    if 0 <= start < end:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pass
    return None


def _pick(d, *keys):
    for k in keys:
        if k in d and d[k] not in (None, ""):
            return d[k]
    return None


def _clean(value, limit=500):
    s = str(value or "").strip()
    return "" if s.lower() in EMPTY else s[:limit]


def _as_list(value):
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def parse_notes(raw):
    """Turn the model's reply into {summary, decisions, action_items}. Never raises."""
    data = _json_object(raw)
    if data is None and (raw or "").lstrip().startswith(("{", "```")):
        # JSON cut off by num_predict (a model listing tasks forever): keep the summary
        # string if it got that far, never the raw JSON as the summary.
        log.warning("LLM returned truncated JSON, salvaging the summary")
        m = SUMMARY_FIELD.search(raw)
        data = {"summary": json.loads(f'"{m.group(1)}"') if m else ""}
    elif data is None:
        log.warning("LLM returned invalid JSON, keeping raw text")
        data = {"summary": raw}
    if not isinstance(data, dict):
        data = {}
    norm = {re.sub(r"[\s_-]", "", str(k).lower()): v for k, v in data.items()}

    summary = _pick(norm, "summary", "overview")
    if isinstance(summary, list):
        summary = " ".join(str(s) for s in summary)

    decisions = []
    for d in _as_list(_pick(norm, "decisions", "keypoints", "decision")):
        if isinstance(d, dict):
            d = _pick(d, "decision", "text", "point", "description")
        d = _clean(d)
        if d and d not in decisions:
            decisions.append(d)

    items = []
    for i in _as_list(_pick(norm, "actionitems", "actions", "tasks", "todos")):
        if isinstance(i, str):
            i = {"task": i}
        if not isinstance(i, dict):
            continue
        i = {re.sub(r"[\s_-]", "", str(k).lower()): v for k, v in i.items()}
        task = _clean(_pick(i, "task", "action", "item", "description", "what"))
        if not task:
            continue
        items.append({
            "owner": _clean(_pick(i, "owner", "assignee", "who", "person", "responsible"), 60),
            "task": task,
            "due": _clean(_pick(i, "due", "duedate", "deadline", "when", "by"), 60),
            "done": False,
        })

    return {"summary": str(summary or "").strip(), "decisions": decisions, "action_items": items}


GENERIC = {"the", "next", "this", "end", "of", "by", "on", "before", "after", "week", "day", "until",
           "and", "or", "a", "an", "in", "at", "to"}


def _words(text):
    return set(re.findall(r"\w+", text.lower()))


def _grounded(value, source_words):
    """Whether a model-written owner or due date was actually said. Small models fill an
    empty slot with a plausible name ("Team X") or a date from the prompt's example
    ("June 3"); a blank is better than a wrong deadline. Every word that carries meaning
    has to occur in the transcript as a whole word."""
    tokens = _words(value) - GENERIC
    return bool(tokens) and tokens <= source_words


def _said(value, source_words, source_text):
    if _words(value) - GENERIC:
        return _grounded(value, source_words)
    # Only common words ("next week", "this week"): the phrase itself has to be in the text.
    phrase = " ".join(re.findall(r"\w+", value.lower()))
    return bool(phrase) and re.search(rf"\b{re.escape(phrase)}\b", source_text) is not None


def _on_topic(text, source_words):
    """More than half the content words of a task or decision occur in the transcript. Catches
    lines lifted from a prompt example ("book the 9 am bus") in a meeting about something else."""
    content = {w for w in _words(text) - GENERIC if len(w) > 2}
    return len(content) < 2 or len(content & source_words) * 2 > len(content)


def ground(notes, transcript):
    source = _words(transcript)
    text = " ".join(re.findall(r"\w+", transcript.lower()))
    for kind, key in (("decisions", str), ("action_items", lambda i: i["task"])):
        kept = [v for v in notes[kind] if _on_topic(key(v), source)]
        if len(kept) < len(notes[kind]):
            log.info("dropping %d %s not about this meeting", len(notes[kind]) - len(kept), kind)
        notes[kind] = kept
    for item in notes["action_items"]:
        for key in ("owner", "due"):
            if item[key] and not _said(item[key], source, text):
                log.info("dropping %s %r: not in the transcript", key, item[key])
                item[key] = ""
    return notes


LINE = re.compile(r"^\W*(DECISION|TASK)\s*:\s*(.+)$", re.IGNORECASE | re.MULTILINE)
MAX_DECISIONS, MAX_ITEMS = 15, 20


PER_CHUNK = 6
DECISION_LEAD = re.compile(r"^(?:so\s+)?(?:the\s+)?decision\s+(?:is|was)\s*(?:to|that)?\s*:?\s*", re.IGNORECASE)
NO_DECISION = re.compile(r"^(?:none|no\b|n/a|nothing\b)", re.IGNORECASE)


def _strip_md(text):
    """Drop the markdown a model wraps a line in: **bold**, `code`, a trailing period."""
    return text.strip().strip("*_`").strip().rstrip(".").strip()


def harvest(parts):
    """DECISION: and TASK: lines from the map step, in meeting order.

    A 1.5b model asked to fold 20 topics into one JSON keeps three or four of them. The map
    step already found every decision and task chunk by chunk, so they are read straight
    from its notes and only the summary paragraph is left to the reduce call.
    """
    decisions, items = [], []
    for part in parts:
        # A looping model can write dozens of TASK lines for one chunk; a ~1500 token stretch
        # of talk never holds more than a handful, so only the first few count.
        d_n = t_n = 0
        for kind, rest in LINE.findall(part):
            rest = _strip_md(rest)
            if kind.upper() == "DECISION":
                rest = DECISION_LEAD.sub("", rest).strip()
                if rest and not NO_DECISION.match(rest) and d_n < PER_CHUNK:
                    decisions.append(rest[:1].upper() + rest[1:])
                    d_n += 1
                continue
            if t_n >= PER_CHUNK:
                continue
            owner, task, due = ([*(_strip_md(p) for p in rest.split("|")), "", ""])[:3] if "|" in rest else ("", rest, "")
            due = re.sub(r"^due\s*:\s*", "", due, flags=re.IGNORECASE)
            items.append({"owner": owner, "task": task, "due": due})
            t_n += 1
    return parse_notes(json.dumps({"decisions": decisions, "action_items": items}))


def _key(text):
    return " ".join(re.findall(r"\w+", text.lower()))[:60]


def dedupe(values, key):
    seen, out = set(), []
    for v in values:
        k = _key(key(v))
        if k and k not in seen:
            seen.add(k)
            out.append(v)
    return out


def merge(found, notes, union=False):
    """Decisions and tasks from the map step, the summary from the reduce call.

    When the reduce call read only map notes (a long meeting), its own lists are used only if
    the map step found nothing: given notes, small models re-word every decision (so nothing
    dedupes) and invent follow-up tasks. When it read the whole transcript (`union`), its
    lists are as trustworthy as the map lines and are added after them.
    """
    if union:
        decisions = found["decisions"] + notes["decisions"]
        items = found["action_items"] + notes["action_items"]
    else:
        decisions = found["decisions"] or notes["decisions"]
        items = found["action_items"] or notes["action_items"]
    return {
        **notes,
        "decisions": dedupe(decisions, str)[:MAX_DECISIONS],
        "action_items": dedupe(items, lambda i: i["task"])[:MAX_ITEMS],
    }


def summarize(transcript, prof, on_progress=lambda frac: None):
    if not transcript.strip():
        return parse_notes("{}")
    chain = MAP_PROMPT | chat(prof, num_predict=MAP_REPLY_TOKENS) | StrOutputParser()
    reduce_room = input_chars(prof, REDUCE_REPLY_TOKENS)
    notes, found = transcript, None
    # The first map round always runs, even when the transcript fits the reduce call:
    # asked for JSON straight away qwen2.5:3b listed one task of a stand-up's four, while
    # TASK: lines from the map step catch them all. Later rounds only run until the notes fit;
    # each shrinks the text ~5-10x, so a 60 min meeting on a 4k-context model needs two at most.
    for round_ in range(MAX_ROUNDS):
        if round_ and len(notes) <= reduce_room:
            break
        chunks = split(notes, prof)
        parts = []
        for i, c in enumerate(chunks):
            parts.append(chain.invoke({"text": c}).strip())
            on_progress((i + 1) / len(chunks))
        mapped = "\n\n".join(p for p in parts if p)
        if found is None:  # first round: the lines straight from the transcript
            found = harvest(parts)
        if len(notes) <= reduce_room:
            break  # short meeting: the reduce call reads the transcript itself
        notes = mapped
    if len(notes) > reduce_room:
        # Still too long after MAX_ROUNDS: keep the start and the end (outcomes come late in a
        # meeting) rather than letting Ollama drop the start without telling anyone.
        log.warning("notes still %d chars after %d rounds, trimming to %d", len(notes), MAX_ROUNDS, reduce_room)
        half = reduce_room // 2
        notes = notes[:half] + "\n...\n" + notes[-half:]
    raw = (REDUCE_PROMPT | chat(prof, json_mode=True, num_predict=REDUCE_REPLY_TOKENS) | StrOutputParser()).invoke(
        {"text": notes}
    )
    result = parse_notes(raw)
    if found is not None:
        result = merge(found, result, union=notes is transcript)
    return ground(result, transcript)


STAMP = re.compile(r"\[(\d{1,2}(?::\d{2}){1,2})\]")
CITE_SKIP = {"the", "and", "will", "was", "were", "that", "this", "with", "for", "they", "said", "meeting"}


def _content(text):
    return {w for w in re.findall(r"\w+", text.lower()) if len(w) > 2 and w not in CITE_SKIP}


def cite(reply, excerpts, question="", max_cites=2):
    """Make sure an answer points at the transcript.

    qwen2.5:1.5b answers well in its own words but often leaves out the [mm:ss] the prompt asks
    for. When it does, append the timestamps of the excerpt lines that share the most words
    with the answer and the question (a short answer such as "By next week." matches too
    little on its own), so the UI still has something to seek to.
    """
    if STAMP.search(reply) or reply.lower().startswith("the meeting does not say"):
        return reply
    words = _content(reply)
    asked = _content(question)
    scored = []
    for line in excerpts.splitlines():
        m = STAMP.match(line)
        if m:
            said = _content(line[m.end():])
            overlap = len(words & said)
            if overlap >= 2 or (overlap and len(words) <= 3):
                scored.append((overlap + len(asked & said), m.group(0)))
    stamps = []
    for _, stamp in sorted(scored, key=lambda s: -s[0]):
        if stamp not in stamps:
            stamps.append(stamp)
    if not stamps:
        # Not one excerpt line shares two words with the answer: the model made it up
        # (asked about database backups the meeting never reached, the 1.5b model invented
        # "the first and third weeks of every month").
        log.info("dropping an answer with no support in the excerpts: %r", reply[:200])
        return "The meeting does not say."
    return f"{reply} {' '.join(stamps[:max_cites])}"


def answer(excerpts, question, prof):
    reply = (
        QA_PROMPT | chat(prof, num_predict=QA_REPLY_TOKENS) | StrOutputParser()
    ).invoke({"text": excerpts, "question": question}).strip()
    return cite(reply, excerpts, question)
