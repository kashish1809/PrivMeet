# Benchmarks

`scripts/bench.py` runs each pipeline stage in its own child process with `TIER=` forced,
the way the Celery worker runs one task per child, and records wall time, the Whisper
real-time factor (RTF = wall / audio length) and peak RSS per stage. For the LLM it also
records what `ollama ps` reports for the loaded model, since the model lives in the
Ollama process, not in the worker.

```
cd backend && uv venv -p 3.12 .venv && uv pip install -p .venv -r requirements.txt
.venv/bin/python ../scripts/bench.py meeting.mp3 --tiers low,mid --markdown
```

Needs ffmpeg, a running Ollama and, for diarization, `scripts/download_models.sh`. The first
run of a tier downloads its models; run it twice and keep the second numbers.

## Results, 10 min meeting (2026-11-14)

- **Audio:** the first 10 minutes of a synthetic planning meeting. Five voices from Windows text-to-speech, continuous speech, 64 kb/s MP3.
- **Machine:** Windows 11, AMD Ryzen 5 5600 (6 cores / 12 threads), 16 GB RAM, NVIDIA GTX 1650 4 GB (Turing, no tensor cores).
- **Setup:** Ollama 0.40, Python 3.12, faster-whisper on CTranslate2 4.9.
- **Low and mid** ran with Ollama forced onto the CPU (`CUDA_VISIBLE_DEVICES=-1`, `OLLAMA_VULKAN=false`), as on a machine without a GPU. `cpu_threads` = 6, half the threads.
- **Peak RSS** is the worker child. The LLM's memory is in the Ollama column.

| Tier | Stage | Model | Wall (s) | RTF | Peak RSS (MB) | Notes |
|---|---|---|---:|---:|---:|---|
| low | convert | ffmpeg | 0.2 | | 77 | |
| low | transcribe | base (cpu, int8, beam 1) | 16.1 | 0.03 | 769 | 74 segments |
| low | diarize | | | | | off for this tier |
| low | summarize | qwen2.5:1.5b, ctx 4096 | 27.7 | | 118 | Ollama: 1119 MB RAM |
| mid | convert | ffmpeg | 0.2 | | 77 | |
| mid | transcribe | small (cpu, int8, beam 5) | 69.4 | 0.12 | 936 | 43 segments |
| mid | diarize | sherpa-onnx | 32.9 | | 340 | 4 speakers |
| mid | summarize | qwen2.5:3b, ctx 8192 | 41.9 | | 118 | Ollama: 2308 MB RAM |
| high (before) | transcribe | large-v3-turbo (cuda, float16) | 255.8 | 0.43 | 1774 | |
| high (before) | diarize | sherpa-onnx | 33.1 | | 340 | 4 speakers |
| high (before) | summarize | qwen2.5:7b | 74.3 | | 118 | Ollama: 5158 MB, only 2153 MB in VRAM (58% on CPU) |
| **high (tuned)** | transcribe | large-v3-turbo (cuda, **int8_float16**) | 61.8 | 0.10 | 2026 | 67 segments |
| **high (tuned)** | diarize | sherpa-onnx | 32.9 | | 339 | 4 speakers |
| **high (tuned)** | summarize | **qwen2.5:3b** (GPU < 6 GB) | 29.6 | | 118 | Ollama: 2211 MB, all in VRAM |

**Totals for 10 minutes of audio:**
| Tier | Total | Peak RAM |
|---|---|---|
| Low | 44 s | worker 0.8 GB, then Ollama 1.1 GB; the two never overlap |
| Mid | 144 s | worker 0.9 GB, Ollama 2.3 GB |
| High, before | 363 s | |
| High, tuned | 125 s | 2.9x faster |

### Whisper on the 4 GB GPU, same file
| Model | Compute type | Beam | Wall (s) | RTF |
|---|---|---:|---:|---:|
| large-v3-turbo | float16 | 5 | 255.8 | 0.43 |
| large-v3-turbo | float16 | 1 | 222.1 | 0.37 |
| large-v3-turbo | int8_float16 | 5 | 62.2 | 0.10 |
| small | float16 | 5 | 62.0 | 0.10 |
| small | int8_float16 | 5 | 24.4 | 0.04 |

## What changed in `hw.py`
- **Low tier: no change.** Peak is 0.8 GB in the worker plus 1.1 GB in Ollama, far under the 2.5 GB limit, and RTF is 0.03, far under 1.0. The 5.7 GB / 8-thread target laptop is slower, but it has ~30x headroom on RTF. T3.6 measures it there.
- **High tier Whisper: `float16` → `int8_float16`.** It is 4x faster on a GPU without tensor cores and uses less VRAM. On tensor-core GPUs (RTX 20xx and later) the two are close, so one default covers both.
- **High tier on a GPU under 6 GB: the LLM drops to the mid tier's model (qwen2.5:3b).** qwen2.5:7b does not fit in 4 GB, so Ollama split it 58/42 CPU/GPU and it took 2.5x longer. `hw.gpu_vram_gb()` reads the size from `nvidia-smi`. `LLM_MODEL` still overrides it.
- **`hw.total_ram_gb()` now also works on Windows and macOS.** It used to read only `/proc/meminfo`, so a local Windows run reported 0 GB and always picked the low tier. Docker is unaffected.

## Notes
- **CUDA on a local Windows run** needs `cublas64_12.dll` and cuDNN 9 on `PATH`, e.g. `pip install nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*"` plus their `bin` folders. Without them, loading the high-tier Whisper fails with `Library cublas64_12.dll is not found`. T1.5 adds the CPU fallback for that case. The Docker image installs them with `GPU=1`.
- **Ollama on Windows** also uses Vulkan. Hiding a GPU from it needs `OLLAMA_VULKAN=false` as well as `CUDA_VISIBLE_DEVICES=-1`.
- **Accuracy is not measured here.** The summaries were checked by hand in T1.3.
