"""LangChain + Ollama: map-reduce summaries and transcript Q&A sized to small local models."""

import json
import logging

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


def parse_notes(raw):
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        log.warning("LLM returned invalid JSON, keeping raw text")
        data = {"summary": raw}
    if not isinstance(data, dict):
        data = {}
    items = [i for i in data.get("action_items") or [] if isinstance(i, dict)]
    return {
        "summary": str(data.get("summary") or ""),
        "decisions": [str(d) for d in data.get("decisions") or [] if d],
        "action_items": [
            {"owner": str(i.get("owner") or ""), "task": str(i.get("task") or ""),
             "due": str(i.get("due") or ""), "done": False}
            for i in items if i.get("task")
        ],
    }


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
