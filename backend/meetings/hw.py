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
    # int8_float16: int8 weights, float16 maths. On a GTX 1650 (no tensor cores) it ran a
    # 10 min file at RTF 0.10 against 0.43 for float16, and it needs half the VRAM.
    "high": dict(
        whisper_model="large-v3-turbo", device="cuda", compute_type="int8_float16", beam_size=5,
        llm_model="qwen2.5:7b", num_ctx=8192, keep_alive="5m", diarize=True,
    ),
}


def total_ram_gb(path="/proc/meminfo"):
    """Total RAM in GB. /proc/meminfo in the Linux containers; the OS API on a local Windows or
    macOS run, where it used to report 0 and always picked the low tier."""
    try:
        with open(path) as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    return int(line.split()[1]) / 1024**2
    except OSError:
        pass
    try:
        if os.name == "nt":
            import ctypes

            class MemoryStatus(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong)] + [
                    (n, ctypes.c_ulonglong)
                    for n in ("total", "avail", "page_total", "page_avail", "virt_total", "virt_avail", "ext")
                ]

            status = MemoryStatus()
            status.dwLength = ctypes.sizeof(status)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
                return status.total / 1024**3
        else:
            return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 1024**3
    except (AttributeError, OSError, ValueError):
        pass
    return 0.0


# qwen2.5:7b needs ~5 GB of VRAM. On a 4 GB card Ollama put 58% of it on the CPU and the summary
# took 74 s; qwen2.5:3b fits whole and took 30 s (docs/BENCHMARKS.md).
SMALL_GPU_GB = 6
SMALL_GPU_LLM = TIERS["mid"]["llm_model"]


def gpu_vram_gb():
    """Total memory of the first NVIDIA GPU in GB, or None when nvidia-smi is not there."""
    import subprocess

    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10,
        )
        return int(out.stdout.split()[0]) / 1024 if out.returncode == 0 else None
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        return None


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


def build_profile(environ, ram_gb, cuda, cpus, vram_gb=None):
    tier = environ.get("TIER") or detect_tier(ram_gb, cuda)
    p = dict(TIERS[tier], tier=tier, ram_gb=round(ram_gb, 1), cuda=cuda)
    if p["device"] == "cuda" and vram_gb and vram_gb < SMALL_GPU_GB:
        p["llm_model"] = SMALL_GPU_LLM
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
    cuda = has_cuda()
    return build_profile(os.environ, total_ram_gb(), cuda, os.cpu_count() or 2, gpu_vram_gb() if cuda else None)
