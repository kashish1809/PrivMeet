"""User settings that override the hardware tier: DATA_DIR/settings.json.

load() is called at the start of every task (through hw.profile()), so a change made in
Settings applies to the next meeting without restarting the worker. save() validates every
key and writes the file atomically, so a crash never leaves half a JSON file behind.
"""

import json
import os
import re
import tempfile
from urllib.parse import urlparse

from django.conf import settings

MODEL_NAME = re.compile(r"^[\w.\-/:]+$")


class SettingsError(ValueError):
    """An unknown key or a value of the wrong type; the message goes back as the 400 error."""


def _text(limit):
    def check(key, v):
        if not isinstance(v, str):
            raise SettingsError(f"{key} must be a string.")
        v = v.strip()
        if len(v) > limit:
            raise SettingsError(f"{key} can be at most {limit} characters.")
        return v
    return check


def _model(key, v):
    v = _text(100)(key, v)
    if not MODEL_NAME.match(v):
        raise SettingsError(f"{key} is not a valid model name.")
    return v


def _url(key, v):
    v = _text(200)(key, v).rstrip("/")
    u = urlparse(v)
    if u.scheme not in ("http", "https") or not u.netloc:
        raise SettingsError(f"{key} must be an http:// or https:// URL.")
    return v


def _int(lo, hi):
    def check(key, v):
        # bool is an int in Python; "true" for a number is a client bug, not a 1.
        if isinstance(v, bool) or not isinstance(v, int):
            raise SettingsError(f"{key} must be a whole number.")
        if not lo <= v <= hi:
            raise SettingsError(f"{key} must be between {lo} and {hi}.")
        return v
    return check


def _bool(key, v):
    if not isinstance(v, bool):
        raise SettingsError(f"{key} must be true or false.")
    return v


# Key -> validator. Later tasks add their keys here (default_template, keep_audio, ...).
SCHEMA = {
    "display_name": _text(60),
    "llm_model": _model,
    "ollama_url": _url,
    "whisper_model": _model,
    "num_ctx": _int(512, 131072),
    "diarize": _bool,
    "cpu_threads": _int(1, 256),
}


def path():
    return settings.DATA_DIR / "settings.json"


def load():
    """Saved settings, {} when there are none. A broken file reads as {} rather than
    stopping every meeting; the next save() replaces it."""
    try:
        data = json.loads(path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    clean = {}
    for k, v in data.items():
        if k in SCHEMA:
            try:
                clean[k] = SCHEMA[k](k, v)
            except SettingsError:
                pass  # hand-edited file with a bad value: ignore that key only
    return clean


def validate(patch):
    if not isinstance(patch, dict):
        raise SettingsError("Expected a JSON object.")
    unknown = sorted(set(patch) - set(SCHEMA))
    if unknown:
        raise SettingsError(f"Unknown setting: {', '.join(unknown)}.")
    # null (or an empty string) removes the override, so the tier default applies again.
    return {k: (None if v is None or v == "" else SCHEMA[k](k, v)) for k, v in patch.items()}


def save(patch):
    """Merge `patch` into the saved settings and return the result. Raises SettingsError."""
    clean = validate(patch)
    data = load()
    for k, v in clean.items():
        if v is None:
            data.pop(k, None)
        else:
            data[k] = v
    target = path()
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=target.parent, prefix=".settings-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp, target)  # atomic on the same filesystem
    except BaseException:
        os.unlink(tmp)
        raise
    return data
