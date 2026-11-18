//! Pick model sizes that fit the machine. Every value can be
//! overridden by env vars, and the saved settings win over both (apply_overrides).

use std::collections::HashMap;
use std::path::Path;

use serde::Serialize;
use serde_json::Value;

use crate::settings::Settings;

/// The tier defaults (hw.TIERS). Model names live here and nowhere else.
#[derive(Clone, Copy)]
pub struct Tier {
    pub whisper_model: &'static str,
    pub device: &'static str,
    pub compute_type: &'static str,
    pub beam_size: i64,
    pub llm_model: &'static str,
    pub num_ctx: i64,
    pub keep_alive: &'static str,
    pub diarize: bool,
}

pub fn tier(name: &str) -> Option<Tier> {
    Some(match name {
        "low" => Tier {
            whisper_model: "base", device: "cpu", compute_type: "int8", beam_size: 1,
            llm_model: "qwen2.5:1.5b", num_ctx: 4096, keep_alive: "30s", diarize: false,
        },
        "mid" => Tier {
            whisper_model: "small", device: "cpu", compute_type: "int8", beam_size: 5,
            llm_model: "qwen2.5:3b", num_ctx: 8192, keep_alive: "5m", diarize: true,
        },
        // int8_float16 ran a 10 min file at RTF 0.10 on a GTX 1650 (no tensor cores), with half the VRAM
        "high" => Tier {
            whisper_model: "large-v3-turbo", device: "cuda", compute_type: "int8_float16", beam_size: 5,
            llm_model: "qwen2.5:7b", num_ctx: 8192, keep_alive: "5m", diarize: true,
        },
        _ => return None,
    })
}

/// qwen2.5:7b needs ~5 GB of VRAM; under this the high tier uses the mid tier's model.
pub const SMALL_GPU_GB: f64 = 6.0;
/// Providers that keep their own linked account (<name>_api_key, <name>_model).
pub const LINKED_PROVIDERS: &[&str] = &["anthropic", "openai", "openrouter", "groq", "gemini"];
/// Providers whose API can transcribe audio (pipeline/providers.py AUDIO_PROVIDERS).
pub const AUDIO_PROVIDERS: &[&str] = &["groq", "openai", "custom"];

/// The profile a run uses: tier + env + saved settings (hw.profile()).
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Profile {
    pub tier: String,
    pub ram_gb: f64,
    pub cuda: bool,
    pub whisper_model: String,
    pub device: String,
    pub compute_type: String,
    pub beam_size: i64,
    pub llm_model: String,
    pub num_ctx: i64,
    pub keep_alive: String,
    pub diarize: bool,
    pub cpu_threads: i64,
    pub ollama_url: Option<String>,
    pub llm_provider: String,
    pub api_base_url: Option<String>,
    pub api_key: Option<String>,
    pub api_model: Option<String>,
    pub cloud_transcribe: bool,
    pub cloud_transcribe_model: Option<String>,
}

pub fn detect_tier(ram_gb: f64, cuda: bool) -> &'static str {
    if cuda {
        "high"
    } else if ram_gb >= 7.5 {
        "mid" // 8 GB sticks report ~7.6 GB usable
    } else {
        "low"
    }
}

/// Tier + env vars, before the saved settings (hw.build_profile).
pub fn build_profile(env: &HashMap<String, String>, ram_gb: f64, cuda: bool, cpus: usize, vram_gb: Option<f64>) -> Profile {
    let get = |k: &str| env.get(k).filter(|v| !v.is_empty());
    let name = get("TIER").filter(|t| tier(t).is_some()).map(String::as_str).unwrap_or(detect_tier(ram_gb, cuda));
    let t = tier(name).expect("known tier");
    let mut p = Profile {
        tier: name.to_string(),
        ram_gb: (ram_gb * 10.0).round() / 10.0,
        cuda,
        whisper_model: t.whisper_model.into(),
        device: t.device.into(),
        compute_type: t.compute_type.into(),
        beam_size: t.beam_size,
        llm_model: t.llm_model.into(),
        num_ctx: t.num_ctx,
        keep_alive: t.keep_alive.into(),
        diarize: t.diarize,
        // leave half the cores free so the desktop and web UI stay responsive
        cpu_threads: get("CPU_THREADS").and_then(|v| v.parse().ok()).unwrap_or((cpus / 2).max(1) as i64),
        ollama_url: None,
        llm_provider: "ollama".into(),
        api_base_url: None,
        api_key: None,
        api_model: None,
        cloud_transcribe: false,
        cloud_transcribe_model: None,
    };
    if p.device == "cuda" && vram_gb.is_some_and(|v| v < SMALL_GPU_GB) {
        p.llm_model = tier("mid").unwrap().llm_model.into();
    }
    if let Some(v) = get("WHISPER_MODEL") {
        p.whisper_model = v.clone();
    }
    if let Some(v) = get("LLM_MODEL") {
        p.llm_model = v.clone();
    }
    if let Some(v) = get("NUM_CTX").and_then(|v| v.parse().ok()) {
        p.num_ctx = v;
    }
    if let Some(v) = get("BEAM_SIZE").and_then(|v| v.parse().ok()) {
        p.beam_size = v;
    }
    if let Some(v) = get("DIARIZE") {
        p.diarize = v == "1";
    }
    if p.device == "cuda" && !cuda {
        cpu_fallback(&mut p); // TIER=high forced on a machine without a GPU
    }
    p
}

/// A CUDA profile switched to the CPU after the GPU failed; keeps the model size.
pub fn cpu_fallback(p: &mut Profile) {
    p.device = "cpu".into();
    p.compute_type = "int8".into();
    p.cuda = false;
}

/// Whether this run sends audio to the provider instead of transcribing here.
pub fn uses_cloud(p: &Profile) -> bool {
    p.cloud_transcribe && AUDIO_PROVIDERS.contains(&p.llm_provider.as_str())
}

/// Saved settings win over the tier and the env vars: they are what the user picked last.
pub fn apply_overrides(base: &Profile, saved: &Settings) -> Profile {
    let mut p = base.clone();
    let s = |k: &str| saved.get(k).and_then(Value::as_str).map(String::from);
    if let Some(v) = s("llm_model") { p.llm_model = v; }
    if let Some(v) = s("whisper_model") { p.whisper_model = v; }
    if let Some(v) = saved.get("num_ctx").and_then(Value::as_i64) { p.num_ctx = v; }
    if let Some(v) = saved.get("diarize").and_then(Value::as_bool) { p.diarize = v; }
    if let Some(v) = saved.get("cpu_threads").and_then(Value::as_i64) { p.cpu_threads = v; }
    if let Some(v) = s("llm_provider") { p.llm_provider = v; }
    if let Some(v) = saved.get("cloud_transcribe").and_then(Value::as_bool) { p.cloud_transcribe = v; }
    p.ollama_url = s("ollama_url").or(p.ollama_url);
    p.api_base_url = s("api_base_url").or(p.api_base_url);
    p.api_key = s("api_key").or(p.api_key);
    p.api_model = s("api_model").or(p.api_model);
    p.cloud_transcribe_model = s("cloud_transcribe_model").or(p.cloud_transcribe_model);
    // the linked account of the provider in use wins over the single api_key/api_model
    if LINKED_PROVIDERS.contains(&p.llm_provider.as_str()) {
        if let Some(k) = s(&format!("{}_api_key", p.llm_provider)).filter(|v| !v.is_empty()) { p.api_key = Some(k); }
        if let Some(m) = s(&format!("{}_model", p.llm_provider)).filter(|v| !v.is_empty()) { p.api_model = Some(m); }
    }
    // a cloud provider runs the heavy stages, so local RAM no longer limits them
    let high = tier("high").unwrap();
    if p.llm_provider != "ollama" && !saved.contains_key("num_ctx") {
        p.num_ctx = high.num_ctx;
    }
    if uses_cloud(&p) {
        p.tier = "high".into();
        if !saved.contains_key("diarize") {
            p.diarize = high.diarize;
        }
    }
    p
}

/// Total RAM in GB from /proc/meminfo (Linux, and the Docker containers).
// shortcut: Linux only; Windows and macOS read 0 and get the low tier. Upgrade with
// GlobalMemoryStatusEx / sysctl when the desktop app ships this server on those systems.
pub fn total_ram_gb() -> f64 {
    std::fs::read_to_string("/proc/meminfo")
        .ok()
        .and_then(|s| {
            s.lines()
                .find(|l| l.starts_with("MemTotal:"))
                .and_then(|l| l.split_whitespace().nth(1))
                .and_then(|kb| kb.parse::<f64>().ok())
        })
        .map(|kb| kb / 1024.0 / 1024.0)
        .unwrap_or(0.0)
}

/// Total memory of the first NVIDIA GPU in GB, or None when nvidia-smi is not there.
pub fn gpu_vram_gb() -> Option<f64> {
    let out = std::process::Command::new("nvidia-smi")
        .args(["--query-gpu=memory.total", "--format=csv,noheader,nounits"])
        .output()
        .ok()
        .filter(|o| o.status.success())?;
    String::from_utf8_lossy(&out.stdout).split_whitespace().next()?.parse::<f64>().ok().map(|mb| mb / 1024.0)
}

/// CUDA is usable only when this binary was built with GPU support and a driver answers.
pub fn has_cuda() -> bool {
    cfg!(feature = "cuda") && gpu_vram_gb().is_some()
}

/// The error of the last CUDA failure ("" when the GPU never failed): DATA_DIR/cuda_broken.json,
/// the same file the Python worker writes.
pub fn cuda_error(data_dir: &Path) -> String {
    std::fs::read_to_string(data_dir.join("cuda_broken.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v.get("error").and_then(Value::as_str).map(|e| e.chars().take(500).collect()))
        .unwrap_or_default()
}

/// The hardware, read once per process (hw.detected): RAM, usable CUDA, cores, VRAM.
pub fn detected(data_dir: &Path) -> (f64, bool, usize, Option<f64>) {
    let cuda = has_cuda() && cuda_error(data_dir).is_empty();
    let cpus = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2);
    (total_ram_gb(), cuda, cpus, if cuda { gpu_vram_gb() } else { None })
}

pub fn env_map() -> HashMap<String, String> {
    std::env::vars().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn env(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }
    fn saved(v: Value) -> Settings {
        v.as_object().unwrap().clone()
    }

    #[test]
    fn tiers_from_hardware() {
        assert_eq!(build_profile(&env(&[]), 5.7, false, 8, None).tier, "low");
        assert_eq!(build_profile(&env(&[]), 7.6, false, 8, None).tier, "mid");
        let high = build_profile(&env(&[]), 16.0, true, 12, Some(4.0));
        assert_eq!((high.tier.as_str(), high.llm_model.as_str()), ("high", "qwen2.5:3b")); // small GPU
        let low = build_profile(&env(&[]), 5.7, false, 8, None);
        assert_eq!((low.cpu_threads, low.whisper_model.as_str(), low.num_ctx), (4, "base", 4096));
    }

    #[test]
    fn env_overrides_and_forced_high_without_gpu() {
        let p = build_profile(&env(&[("TIER", "high"), ("NUM_CTX", "2048"), ("DIARIZE", "0"), ("CPU_THREADS", "3")]), 5.7, false, 8, None);
        assert_eq!((p.device.as_str(), p.compute_type.as_str(), p.num_ctx, p.diarize, p.cpu_threads), ("cpu", "int8", 2048, false, 3));
        assert_eq!(build_profile(&env(&[("TIER", "bogus")]), 5.7, false, 8, None).tier, "low");
    }

    #[test]
    fn saved_settings_and_cloud() {
        let base = build_profile(&env(&[]), 5.7, false, 8, None);
        let local = apply_overrides(&base, &saved(json!({"llm_model": "qwen2.5:3b"})));
        assert_eq!((local.llm_model.as_str(), local.num_ctx, local.tier.as_str()), ("qwen2.5:3b", 4096, "low"));
        // cloud LLM only: bigger context, tier unchanged
        let llm = apply_overrides(&base, &saved(json!({"llm_provider": "anthropic", "anthropic_api_key": "k", "anthropic_model": "m"})));
        assert_eq!((llm.num_ctx, llm.tier.as_str(), llm.api_key.as_deref(), llm.api_model.as_deref()), (8192, "low", Some("k"), Some("m")));
        // cloud LLM and transcription: high tier, diarization on unless saved
        let both = apply_overrides(&base, &saved(json!({"llm_provider": "groq", "cloud_transcribe": true})));
        assert_eq!((both.tier.as_str(), both.diarize), ("high", true));
        let off = apply_overrides(&base, &saved(json!({"llm_provider": "groq", "cloud_transcribe": true, "diarize": false, "num_ctx": 2048})));
        assert_eq!((off.diarize, off.num_ctx), (false, 2048));
    }
}
