"""Pick model sizes that fit the machine. Every value can be overridden by env vars."""

import os
from functools import cache

TIERS = {
    "low": dict(
        whisper_model="base", device="cpu", compute_type="int8", beam_size=1,
        llm_model="qwen2.5:1.5b", num_ctx=4096, keep_alive="30s", diarize=False,
    ),
    "mid": dict(
        whisper_model="small", device="cpu", compute_type="int8", beam_size=5,
        llm_model="qwen2.5:3b", num_ctx=8192, keep_alive="5m", diarize=True,
    ),
    "high": dict(
        whisper_model="large-v3-turbo", device="cuda", compute_type="float16", beam_size=5,
        llm_model="qwen2.5:7b", num_ctx=8192, keep_alive="5m", diarize=True,
    ),
}


def total_ram_gb(path="/proc/meminfo"):
    try:
        with open(path) as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    return int(line.split()[1]) / 1024**2
    except OSError:
        pass
    return 0.0


def has_cuda():
    try:
        import ctranslate2

        return ctranslate2.get_cuda_device_count() > 0
    except Exception:
        return False


def detect_tier(ram_gb, cuda):
    if cuda:
        return "high"
    return "mid" if ram_gb >= 7.5 else "low"  # 8 GB sticks report ~7.6 GB usable


def build_profile(environ, ram_gb, cuda, cpus):
    tier = environ.get("TIER") or detect_tier(ram_gb, cuda)
    p = dict(TIERS[tier], tier=tier, ram_gb=round(ram_gb, 1), cuda=cuda)
    # Leave half the cores free so the desktop and web UI stay responsive.
    p["cpu_threads"] = int(environ.get("CPU_THREADS") or max(1, cpus // 2))
    for key, cast in (("whisper_model", str), ("llm_model", str), ("num_ctx", int), ("beam_size", int)):
        if environ.get(key.upper()):
            p[key] = cast(environ[key.upper()])
    if environ.get("DIARIZE"):
        p["diarize"] = environ["DIARIZE"] == "1"
    if p["device"] == "cuda" and not cuda:  # TIER=high forced on a box without a GPU
        p.update(device="cpu", compute_type="int8")
    return p


@cache
def profile():
    return build_profile(os.environ, total_ram_gb(), has_cuda(), os.cpu_count() or 2)
