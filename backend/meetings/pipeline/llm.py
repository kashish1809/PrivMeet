"""LangChain + Ollama: map-reduce summaries and transcript Q&A sized to small local models.

Every call caps its reply (`num_predict`) so prompt + reply always fit inside `num_ctx`: Ollama
silently drops the *start* of a prompt that is too long, which used to cut the first part of
long meetings.
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
PROMPT_TOKENS = 450  # the longest prompt below plus chat-template overhead, with room to grow
MAP_REPLY_TOKENS = 500
REDUCE_REPLY_TOKENS = 900
QA_REPLY_TOKENS = 350
MAX_ROUNDS = 4
# Small models lose track of a long chunk: qwen2.5:1.5b fed ~3000 tokens of a planning
# meeting kept the decisions of one topic in five. ~1500 tokens per map call keeps them all.
MAP_CHUNK_TOKENS = 1500

MAP_PROMPT = ChatPromptTemplate.from_template(
    "Summarize this part of a meeting transcript as short bullet notes. "
    "Keep names, numbers, decisions and tasks with their owners.\n\n{text}"
)
REDUCE_PROMPT = ChatPromptTemplate.from_template(
    "Below are notes or the transcript of one meeting. Reply with JSON only, using these keys:\n"
    '"summary": a short paragraph,\n'
    '"decisions": a list of strings,\n'
    '"action_items": a list of objects with "owner", "task" and "due" strings (empty string when unknown).\n'
    "Use [] when there are none. Do not invent facts.\n\n{text}"
)
QA_PROMPT = ChatPromptTemplate.from_template(
    "Answer the question using only these meeting transcript excerpts. "
    "Cite timestamps like [12:34]. If the excerpts do not contain the answer, say so.\n\n"
    "Excerpts:\n{text}\n\nQuestion: {question}"
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
        temperature=0.2,
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


def summarize(transcript, prof, on_progress=lambda frac: None):
    if not transcript.strip():
        return parse_notes("{}")
    chain = MAP_PROMPT | chat(prof, num_predict=MAP_REPLY_TOKENS) | StrOutputParser()
    reduce_room = input_chars(prof, REDUCE_REPLY_TOKENS)
    notes = transcript
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
    if len(notes) > reduce_room:
        # Still too long after MAX_ROUNDS: keep the start and the end (outcomes come late in a
        # meeting) rather than letting Ollama drop the start without telling anyone.
        log.warning("notes still %d chars after %d rounds, trimming to %d", len(notes), MAX_ROUNDS, reduce_room)
        half = reduce_room // 2
        notes = notes[:half] + "\n...\n" + notes[-half:]
    raw = (REDUCE_PROMPT | chat(prof, json_mode=True, num_predict=REDUCE_REPLY_TOKENS) | StrOutputParser()).invoke(
        {"text": notes}
    )
    return parse_notes(raw)


def answer(excerpts, question, prof):
    return (
        QA_PROMPT | chat(prof, num_predict=QA_REPLY_TOKENS) | StrOutputParser()
    ).invoke({"text": excerpts, "question": question}).strip()
