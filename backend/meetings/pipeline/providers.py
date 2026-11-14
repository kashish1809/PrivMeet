"""Cloud LLM providers, opt-in from Settings: OpenAI, OpenRouter, Anthropic and any server that
speaks the OpenAI chat API (LM Studio, vLLM, llama.cpp server, Ollama's /v1).

Ollama stays the default and the only provider that keeps everything on this machine. With a
cloud provider the transcript text is sent to that provider for the summary and Q&A; the audio
never leaves the machine (Whisper and diarization always run locally).

Plain HTTP with urllib, so no SDK is added. The chat is a LangChain Runnable, so the prompts and
the map-reduce in llm.py work unchanged.
"""

import json
import urllib.error
import urllib.request

from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableLambda

# Where each provider lives; "custom" takes api_base_url from Settings.
BASE_URLS = {
    "openai": "https://api.openai.com/v1",
    "openrouter": "https://openrouter.ai/api/v1",
    "anthropic": "https://api.anthropic.com/v1",
}
PROVIDERS = ("ollama", "openai", "openrouter", "anthropic", "custom")
ANTHROPIC_VERSION = "2023-06-01"
TIMEOUT = 300  # seconds: a long map step on a slow provider


class ProviderError(RuntimeError):
    pass


def base_url(prof):
    url = prof.get("api_base_url") if prof.get("llm_provider") == "custom" else BASE_URLS.get(prof.get("llm_provider"))
    if not url:
        raise ProviderError("No server URL set for this provider.")
    return url.rstrip("/")


def _headers(prof):
    key = prof.get("api_key") or ""
    if prof.get("llm_provider") == "anthropic":
        return {"x-api-key": key, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json"}
    h = {"content-type": "application/json"}
    if key:
        h["authorization"] = f"Bearer {key}"
    if prof.get("llm_provider") == "openrouter":
        h["x-title"] = "PrivMeet"  # shown on the user's OpenRouter dashboard
    return h


def _request(prof, path, body=None, timeout=TIMEOUT):
    req = urllib.request.Request(
        base_url(prof) + path,
        data=None if body is None else json.dumps(body).encode(),
        headers=_headers(prof),
        method="GET" if body is None else "POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        try:
            err = json.loads(detail).get("error")
            detail = err.get("message") if isinstance(err, dict) else err or detail
        except (ValueError, AttributeError):
            pass
        raise ProviderError(f"{e.code} from the provider: {detail}") from None
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise ProviderError(f"Could not reach the provider: {getattr(e, 'reason', e)}") from None


def _split(messages):
    """LangChain messages -> (system text, [{"role", "content"}])."""
    system, chat = [], []
    for m in messages:
        role = {"system": "system", "human": "user", "ai": "assistant"}.get(m.type, "user")
        if role == "system":
            system.append(m.content)
        else:
            chat.append({"role": role, "content": m.content})
    return "\n\n".join(system), chat


def complete(prof, messages, json_mode=False, max_tokens=None, temperature=0.1):
    """One chat completion; returns the reply text."""
    if not prof.get("api_model"):
        raise ProviderError("Choose a model for this provider in Settings.")
    system, chat = _split(messages)
    if prof.get("llm_provider") == "anthropic":
        body = {"model": prof["api_model"], "max_tokens": max_tokens or 1024, "temperature": temperature, "messages": chat}
        if system:
            body["system"] = system + ("\nReply with JSON only." if json_mode else "")
        data = _request(prof, "/messages", body)
        return "".join(part.get("text", "") for part in data.get("content", []) if part.get("type") == "text")
    body = {
        "model": prof["api_model"],
        "messages": ([{"role": "system", "content": system}] if system else []) + chat,
        "temperature": temperature,
    }
    if max_tokens:
        body["max_tokens"] = max_tokens
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    data = _request(prof, "/chat/completions", body)
    try:
        return data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError):
        raise ProviderError("The provider sent a reply PrivMeet could not read.") from None


def chat(prof, json_mode=False, num_predict=None):
    """A Runnable with the same role as ChatOllama in llm.chat()."""
    return RunnableLambda(
        lambda prompt: AIMessage(content=complete(prof, prompt.to_messages(), json_mode, num_predict))
    )


def list_models(prof):
    """Model ids the provider offers, for Test Connection. Raises ProviderError."""
    data = _request(prof, "/models", timeout=15)
    items = data.get("data", []) if isinstance(data, dict) else []
    return sorted({m.get("id") for m in items if isinstance(m, dict) and m.get("id")})
