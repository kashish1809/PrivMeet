#!/usr/bin/env python3
"""Benchmark the PrivMeet pipeline per hardware tier.

    python scripts/bench.py meeting.mp3                 # low and mid
    python scripts/bench.py meeting.mp3 --tiers low,mid,high --markdown

Each stage (ffmpeg convert, Whisper, diarization, LLM summary) runs in its own child
process with TIER=<tier> forced, the way the Celery worker runs one task per child, so
the peak RSS of one stage never hides inside another's. For every stage it records:

- wall time, and the real-time factor (wall / audio length) for Whisper;
- peak RSS of the child (resource.getrusage; GetProcessMemoryInfo on Windows), plus the
  peak of its own subprocesses (ffmpeg) where the OS reports it;
- for the LLM stage, the size Ollama reports for the loaded model (`ollama ps`, read
  through the same /api/ps endpoint), since the model lives in the Ollama process.

Run it from the repo root or anywhere: it finds backend/ next to this file. Needs the
backend venv (faster-whisper, sherpa-onnx, langchain-ollama), ffmpeg and a running Ollama.
"""

import argparse
import json
import os
import platform
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
STAGES = ("convert", "transcribe", "diarize", "summarize")


# ---------------------------------------------------------------- measuring (child side)

def peak_rss_mb():
    """(self, children) peak resident set size in MB. Children is None where the OS hides it."""
    try:
        import resource

        scale = 1 / 1024 if sys.platform != "darwin" else 1 / 1024**2  # Linux KB, macOS bytes
        own = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * scale
        kids = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss * scale
        return own, kids
    except ImportError:  # Windows: no resource module
        import ctypes
        from ctypes import wintypes

        class Counters(ctypes.Structure):
            _fields_ = [
                ("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD),
                ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t),
            ]

        kernel32, psapi = ctypes.windll.kernel32, ctypes.windll.psapi
        kernel32.GetCurrentProcess.restype = wintypes.HANDLE
        psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
        c = Counters()
        c.cb = ctypes.sizeof(c)
        psapi.GetProcessMemoryInfo(kernel32.GetCurrentProcess(), ctypes.byref(c), c.cb)
        return c.PeakWorkingSetSize / 1024**2, None


def django_setup():
    sys.path.insert(0, str(BACKEND))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "privmeet.settings")
    os.environ.setdefault("DEBUG", "1")  # settings refuse the built-in key otherwise; nothing is served
    import django

    django.setup()


def ollama_loaded(model):
    """Size Ollama reports for `model` while it is loaded: what `ollama ps` prints."""
    import urllib.request

    from django.conf import settings

    try:
        with urllib.request.urlopen(f"{settings.OLLAMA_URL}/api/ps", timeout=5) as r:
            for m in json.load(r).get("models", []):
                if m.get("name") == model or m.get("model") == model:
                    return {"size_mb": round(m.get("size", 0) / 1024**2), "vram_mb": round(m.get("size_vram", 0) / 1024**2)}
    except OSError:
        pass
    return None


def run_stage(stage, work):
    """Run one stage in this (child) process. `work` is a scratch dir shared by the stages."""
    django_setup()
    from meetings import hw

    prof = hw.profile()
    wav = work / "audio.wav"
    out = {"stage": stage, "tier": prof["tier"]}
    t0 = time.perf_counter()

    if stage == "convert":
        from meetings.pipeline import audio

        audio.to_wav(os.environ["BENCH_SRC"], wav)
        out["audio_s"] = audio.probe(wav)

    elif stage == "transcribe":
        from meetings.pipeline.transcribe import transcribe

        segments, info = transcribe(wav, prof)
        segs = [{"start": s.start, "end": s.end, "text": s.text.strip()} for s in segments]
        out.update(audio_s=info.duration, segments=len(segs), model=prof["whisper_model"],
                   device=prof["device"], compute_type=prof["compute_type"])
        (work / "segments.json").write_text(json.dumps(segs))

    elif stage == "diarize":
        from meetings.pipeline import diarize

        if not prof["diarize"]:
            out["skipped"] = "off for this tier"
        elif not diarize.available():
            out["skipped"] = "models missing"
        else:
            turns = diarize.diarize(wav, prof["cpu_threads"])
            out["speakers"] = len({t[2] for t in turns})

    elif stage == "summarize":
        from meetings.models import mmss
        from meetings.pipeline import llm

        segs = json.loads((work / "segments.json").read_text())
        text = "\n".join(f"[{mmss(s['start'])}] {s['text']}" for s in segs)
        llm.ensure_model(prof)
        t0 = time.perf_counter()  # do not count a first-time model download
        notes = llm.summarize(text, prof)
        out.update(model=prof["llm_model"], num_ctx=prof["num_ctx"], decisions=len(notes["decisions"]),
                   action_items=len(notes["action_items"]), ollama=ollama_loaded(prof["llm_model"]))

    out["wall_s"] = round(time.perf_counter() - t0, 1)
    own, kids = peak_rss_mb()
    out["peak_rss_mb"] = round(own)
    out["children_peak_rss_mb"] = None if kids is None else round(kids)
    print("BENCH " + json.dumps(out), flush=True)


# ---------------------------------------------------------------- orchestration (parent side)

def child(stage, tier, src, work):
    env = {**os.environ, "TIER": tier, "BENCH_SRC": str(src)}
    proc = subprocess.run(
        [sys.executable, __file__, "--stage", stage, "--work", str(work)],
        env=env, capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    for line in proc.stdout.splitlines():
        if line.startswith("BENCH "):
            return json.loads(line[6:])
    return {"stage": stage, "tier": tier, "error": (proc.stderr.strip().splitlines() or ["no output"])[-1]}


def machine():
    django_setup()
    from meetings import hw

    return {
        "os": f"{platform.system()} {platform.release()}",
        "cpu": platform.processor() or platform.machine(),
        "threads": os.cpu_count(),
        "ram_gb": round(hw.total_ram_gb(), 1),
        "cuda": hw.has_cuda(),
    }


def markdown(results, info, src):
    rows = [
        "| Tier | Stage | Model | Wall (s) | RTF | Peak RSS (MB) | Notes |",
        "|---|---|---|---:|---:|---:|---|",
    ]
    for r in results:
        audio_s = next((x.get("audio_s") for x in results if x["tier"] == r["tier"] and x.get("audio_s")), None)
        rtf = f"{r['wall_s'] / audio_s:.2f}" if r.get("wall_s") is not None and audio_s and r["stage"] == "transcribe" else ""
        model = r.get("model", "ffmpeg" if r["stage"] == "convert" else "sherpa-onnx" if r["stage"] == "diarize" else "")
        if r["stage"] == "transcribe" and "device" in r:
            model += f" ({r['device']}, {r['compute_type']})"
        notes = r.get("error") or r.get("skipped") or ""
        if r["stage"] == "convert" and r.get("children_peak_rss_mb"):
            notes = f"ffmpeg peak {r['children_peak_rss_mb']} MB"
        if r["stage"] == "diarize" and "speakers" in r:
            notes = f"{r['speakers']} speakers"
        if r["stage"] == "summarize" and r.get("ollama"):
            o = r["ollama"]
            notes = f"Ollama model {o['size_mb']} MB ({o['vram_mb']} MB in VRAM); {r['decisions']} decisions, {r['action_items']} tasks"
        if r["stage"] == "transcribe" and "segments" in r:
            notes = f"{r['segments']} segments"
        rows.append(
            f"| {r['tier']} | {r['stage']} | {model} | {r.get('wall_s', '')} | {rtf} | {r.get('peak_rss_mb', '')} | {notes} |"
        )
    head = (
        f"Audio: `{Path(src).name}`. Machine: {info['os']}, {info['cpu']}, {info['threads']} threads, "
        f"{info['ram_gb']} GB RAM, CUDA {'yes' if info['cuda'] else 'no'}."
    )
    return head + "\n\n" + "\n".join(rows)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("audio", nargs="?", help="audio or video file to benchmark")
    ap.add_argument("--tiers", default="low,mid", help="comma list of low, mid, high (default: low,mid)")
    ap.add_argument("--markdown", action="store_true", help="print a Markdown table for docs/BENCHMARKS.md")
    ap.add_argument("--json", type=Path, help="also write the raw results here")
    ap.add_argument("--stage", choices=STAGES, help=argparse.SUPPRESS)  # child mode
    ap.add_argument("--work", type=Path, help=argparse.SUPPRESS)
    args = ap.parse_args()

    if args.stage:
        return run_stage(args.stage, args.work)
    if not args.audio:
        ap.error("give an audio file")
    src = Path(args.audio).resolve()
    if not src.is_file():
        ap.error(f"no such file: {src}")

    info = machine()
    results = []
    for tier in [t.strip() for t in args.tiers.split(",") if t.strip()]:
        with tempfile.TemporaryDirectory(prefix=f"bench-{tier}-") as work:
            for stage in STAGES:
                r = child(stage, tier, src, Path(work))
                results.append(r)
                print(f"{tier:5} {stage:10} " + (r.get("error") or r.get("skipped") or
                      f"{r['wall_s']:7.1f} s  peak {r['peak_rss_mb']} MB"), file=sys.stderr, flush=True)
                if r.get("error") and stage in ("convert", "transcribe"):
                    break  # later stages need this one's output
    if args.json:
        args.json.write_text(json.dumps({"machine": info, "audio": str(src), "results": results}, indent=2))
    print(markdown(results, info, src) if args.markdown else json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
