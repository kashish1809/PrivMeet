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


def chat(prof, json_mode=False, num_predict=None):
    from langchain_ollama import ChatOllama

    return ChatOllama(
        model=prof["llm_model"],
        base_url=settings.OLLAMA_URL,
        num_ctx=prof["num_ctx"],
        num_predict=num_predict,
        keep_alive=prof["keep_alive"],
        num_thread=None if prof["device"] == "cuda" else prof["cpu_threads"],
        temperature=0.1,
        format="json" if json_mode else None,
    )


def ensure_model(prof):
    """Pull the tier's model on first use; a no-op when it is already present."""
    import ollama

    ollama.Client(host=settings.OLLAMA_URL).pull(prof["llm_model"])


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
EMPTY = {"", "none", "n/a", "na", "unknown", "unassigned", "not specified", "not mentioned", "tbd", "-", "null"}


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
    if data is None:
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


GENERIC = {"the", "next", "this", "end", "of", "by", "on", "before", "after", "week", "day", "until", "and", "or"}


def _grounded(value, source):
    """Whether a model-written owner or due date was actually said. Small models fill an
    empty slot with a plausible name or "Friday"; a blank is better than a wrong deadline."""
    tokens = [t for t in re.findall(r"\w+", value.lower()) if t not in GENERIC]
    return bool(tokens) and any(t in source for t in tokens)


def ground(notes, transcript):
    source = transcript.lower()
    for item in notes["action_items"]:
        for key in ("owner", "due"):
            if item[key] and not _grounded(item[key], source):
                log.info("dropping %s %r: not in the transcript", key, item[key])
                item[key] = ""
    return notes


LINE = re.compile(r"^\W*(DECISION|TASK)\s*:\s*(.+)$", re.IGNORECASE | re.MULTILINE)
MAX_DECISIONS, MAX_ITEMS = 15, 20


def harvest(notes):
    """DECISION: and TASK: lines from the map step, in meeting order.

    A 1.5b model asked to fold 20 topics into one JSON keeps three or four of them. The map
    step already found every decision and task chunk by chunk, so they are read straight
    from its notes and only the summary paragraph is left to the reduce call.
    """
    decisions, items = [], []
    for kind, rest in LINE.findall(notes):
        if kind.upper() == "DECISION":
            decisions.append(rest)
            continue
        owner, task, due = ([*(p.strip() for p in rest.split("|")), "", ""])[:3] if "|" in rest else ("", rest, "")
        due = re.sub(r"^due\s*:\s*", "", due, flags=re.IGNORECASE)
        items.append({"owner": owner, "task": task, "due": due})
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


def merge(found, notes):
    """Decisions and tasks from the map step, the summary from the reduce call.

    The reduce reply's own lists are used only when the map step found none: given notes,
    small models re-word every decision (so nothing dedupes) and invent follow-up tasks.
    """
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
    # Map until the notes fit the reduce call. Each round shrinks the text ~5-10x, so a
    # 60 min meeting on a 4k-context model needs two rounds at most.
    for _ in range(MAX_ROUNDS):
        if len(notes) <= reduce_room:
            break
        chunks = split(notes, prof)
        parts = []
        for i, c in enumerate(chunks):
            parts.append(chain.invoke({"text": c}).strip())
            on_progress((i + 1) / len(chunks))
        notes = "\n\n".join(p for p in parts if p)
        if found is None:  # first round: the lines straight from the transcript
            found = harvest(notes)
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
        result = merge(found, result)
    return ground(result, transcript)


def answer(excerpts, question, prof):
    return (
        QA_PROMPT | chat(prof, num_predict=QA_REPLY_TOKENS) | StrOutputParser()
    ).invoke({"text": excerpts, "question": question}).strip()
