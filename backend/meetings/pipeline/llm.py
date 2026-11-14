"""LangChain + Ollama: map-reduce summaries and transcript Q&A sized to small local models."""

import json
import logging
import re

from django.conf import settings
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_text_splitters import RecursiveCharacterTextSplitter

log = logging.getLogger(__name__)

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


def chat(prof, json_mode=False):
    from langchain_ollama import ChatOllama

    return ChatOllama(
        model=prof["llm_model"],
        base_url=settings.OLLAMA_URL,
        num_ctx=prof["num_ctx"],
        keep_alive=prof["keep_alive"],
        num_thread=None if prof["device"] == "cuda" else prof["cpu_threads"],
        temperature=0.2,
        format="json" if json_mode else None,
    )


def ensure_model(prof):
    """Pull the tier's model on first use; a no-op when it is already present."""
    import ollama

    ollama.Client(host=settings.OLLAMA_URL).pull(prof["llm_model"])


def chunk_chars(prof):
    # ~4 chars per token; keep half the context free for the prompt and the reply.
    return prof["num_ctx"] * 2


def split(text, prof):
    size = chunk_chars(prof)
    return RecursiveCharacterTextSplitter(chunk_size=size, chunk_overlap=size // 20).split_text(text)


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
    chain = MAP_PROMPT | chat(prof) | StrOutputParser()
    notes = transcript
    # Collapse until the notes fit one context window (long meetings on 4k-context models).
    for _ in range(4):
        chunks = split(notes, prof)
        if len(chunks) <= 1:
            break
        parts = []
        for i, c in enumerate(chunks):
            parts.append(chain.invoke({"text": c}))
            on_progress((i + 1) / len(chunks))
        notes = "\n\n".join(parts)
    raw = (REDUCE_PROMPT | chat(prof, json_mode=True) | StrOutputParser()).invoke({"text": notes})
    return parse_notes(raw)


def answer(excerpts, question, prof):
    return (QA_PROMPT | chat(prof) | StrOutputParser()).invoke({"text": excerpts, "question": question})
