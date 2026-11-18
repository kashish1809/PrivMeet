//! The Models page API and Settings' Test Connection (views.models, models_pull,
//! models_delete, settings_test; tasks.pull_model).

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::Duration;

use axum::{
    body::Bytes,
    extract::{Path as UrlPath, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};

use crate::hw::{self, Profile};
use crate::web::{error, App, AppState};
use crate::{diarize, providers, settings, stt};

/// (name, RAM it needs in GB, download size in MB): hw.WHISPER_SIZES.
pub const WHISPER_SIZES: &[(&str, f64, i64)] =
    &[("tiny", 0.5, 75), ("base", 0.7, 145), ("small", 1.2, 485), ("medium", 2.5, 1530), ("large-v3-turbo", 2.2, 1620), ("large-v3", 3.8, 3090)];

/// Seconds without an update after which a pull counts as dead (tasks.PULL_STALE_AFTER).
const PULL_STALE_AFTER: f64 = 120.0;

fn pull_file(data_dir: &Path) -> PathBuf {
    data_dir.join("model_pull.json")
}

fn write_pull(data_dir: &Path, mut state: Value) {
    state["updated"] = json!(crate::db::now_unix());
    let tmp = data_dir.join("model_pull.tmp");
    if std::fs::write(&tmp, state.to_string()).is_ok() {
        let _ = std::fs::rename(&tmp, pull_file(data_dir)); // a reader never sees half a file
    }
}

/// The last pull, or null. `running` is false once it finished, failed or went stale.
pub fn pull_state(data_dir: &Path) -> Value {
    let Some(mut s) = std::fs::read(pull_file(data_dir)).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()) else {
        return Value::Null;
    };
    let status = s["status"].as_str().unwrap_or("");
    let fresh = crate::db::now_unix() - s["updated"].as_f64().unwrap_or(0.0) < PULL_STALE_AFTER;
    s["running"] = json!(!matches!(status, "success" | "error") && fresh);
    s
}

/// The innermost error ("Connection refused (os error 111)"), not reqwest's "error sending request".
fn root_cause(e: &(dyn std::error::Error + 'static)) -> String {
    let mut cur = e;
    while let Some(next) = cur.source() {
        cur = next;
    }
    cur.to_string()
}

fn http(timeout: u64) -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder().timeout(Duration::from_secs(timeout)).build().expect("http client")
}

/// Stream Ollama's /api/pull, writing {model, percent, status} at most once a second. Runs on
/// the pipeline thread, so it never runs beside a transcription.
pub fn pull_model(app: &App, name: &str) {
    let dir = &app.cfg.data_dir;
    let url = providers::ollama_url(&app.profile());
    write_pull(dir, json!({"model": name, "percent": 0, "status": "starting"}));
    let mut percent: i64 = 0;
    let mut layers: std::collections::HashMap<String, (f64, f64)> = Default::default(); // each layer counts from 0
    let mut last = std::time::Instant::now() - Duration::from_secs(2);
    let mut run = || -> Result<(), String> {
        let resp = http(3600).post(format!("{url}/api/pull")).json(&json!({"model": name, "stream": true})).send().map_err(|e| e.without_url().to_string())?;
        if !resp.status().is_success() {
            return Err(format!("HTTP Error {}", resp.status().as_u16()));
        }
        for line in BufReader::new(resp).lines() {
            let line = line.map_err(|e| e.to_string())?;
            let d: Value = serde_json::from_str(if line.is_empty() { "{}" } else { &line }).map_err(|e| e.to_string())?;
            if let Some(e) = d["error"].as_str().filter(|e| !e.is_empty()) {
                return Err(e.to_string());
            }
            if let (Some(total), Some(digest)) = (d["total"].as_f64().filter(|t| *t > 0.0), d["digest"].as_str()) {
                layers.insert(digest.to_string(), (d["completed"].as_f64().unwrap_or(0.0), total));
                let done: f64 = layers.values().map(|l| l.0).sum();
                let all: f64 = layers.values().map(|l| l.1).sum();
                percent = percent.max(((100.0 * done / all).round() as i64).min(99)); // one bar, never backwards
            }
            if last.elapsed() >= Duration::from_secs(1) {
                write_pull(dir, json!({"model": name, "percent": percent, "status": d["status"].as_str().unwrap_or("pulling")}));
                last = std::time::Instant::now();
            }
        }
        Ok(())
    };
    match run() {
        Ok(()) => write_pull(dir, json!({"model": name, "percent": 100, "status": "success"})),
        Err(e) => {
            eprintln!("pull of {name} failed: {e}");
            write_pull(dir, json!({"model": name, "percent": percent, "status": "error", "error": e.chars().take(300).collect::<String>()}));
        }
    }
}

/// Installed Ollama models as [{name, size}] by name, or None when Ollama does not answer.
fn ollama_models(url: &str) -> Option<Vec<Value>> {
    let data: Value = http(5).get(format!("{url}/api/tags")).send().ok()?.error_for_status().ok()?.json().ok()?;
    let mut out: Vec<Value> = data["models"]
        .as_array()?
        .iter()
        .filter_map(|m| Some(json!({"name": m["name"].as_str().filter(|n| !n.is_empty())?, "size": m["size"].as_i64().unwrap_or(0)})))
        .collect();
    out.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    Some(out)
}

/// GET /api/models/: hardware, Whisper sizes, Ollama models, diarization and the running pull.
pub async fn models(State(app): State<AppState>) -> Response {
    let body = tokio::task::spawn_blocking(move || {
        let p = app.profile();
        // recommend for the hardware, not the profile's tier: a cloud provider makes it "high"
        let hw_tier = hw::detect_tier(p.ram_gb, p.cuda);
        let rec = hw::tier(hw_tier).or_else(|| hw::tier("low")).expect("tier");
        let installed = ollama_models(&providers::ollama_url(&p));
        let sizes: Vec<Value> = WHISPER_SIZES
            .iter()
            .map(|(n, ram, mb)| json!({"name": n, "ram_gb": ram, "download_mb": mb, "downloaded": stt::model_path(&app.cfg.models_dir, n).is_file()}))
            .collect();
        json!({
            "hardware": {"tier": hw_tier, "ram_gb": p.ram_gb, "device": p.device, "gpu": p.cuda, "cuda_error": hw::cuda_error(&app.cfg.data_dir)},
            "whisper": {"current": p.whisper_model, "recommended": rec.whisper_model, "sizes": sizes},
            "ollama": {"reachable": installed.is_some(), "installed": installed.unwrap_or_default(),
                       "current": p.llm_model, "recommended": rec.llm_model, "provider": p.llm_provider},
            "diarization": {"enabled": p.diarize, "available": diarize::available(&app.cfg.models_dir)},
            "pull": pull_state(&app.cfg.data_dir),
        })
    })
    .await;
    match body {
        Ok(b) => Json(b).into_response(),
        Err(_) => error(StatusCode::INTERNAL_SERVER_ERROR, "Could not read the models."),
    }
}

fn model_name_ok(name: &str) -> bool {
    settings::is_model_name(name) && name.chars().count() <= 100
}

/// POST /api/models/pull {model}: queue a download. One pull at a time (409 otherwise).
pub async fn pull(State(app): State<AppState>, body: Bytes) -> Response {
    let data: Value = if body.is_empty() { json!({}) } else { serde_json::from_slice(&body).unwrap_or(Value::Null) };
    let Some(obj) = data.as_object() else { return error(StatusCode::BAD_REQUEST, "Expected a JSON object with a model name.") };
    let name = obj.get("model").cloned().unwrap_or(json!(""));
    let Some(name) = name.as_str().filter(|n| model_name_ok(n.trim()) && n.chars().count() <= 100) else {
        return error(StatusCode::BAD_REQUEST, "That is not a valid model name.");
    };
    let state = pull_state(&app.cfg.data_dir);
    if state["running"] == json!(true) {
        return error(StatusCode::CONFLICT, format!("Already downloading {}. Wait for it to finish.", state["model"].as_str().unwrap_or("")));
    }
    // marked as started now, so the page shows it at once and a second click gets 409
    write_pull(&app.cfg.data_dir, json!({"model": name.trim(), "percent": 0, "status": "queued"}));
    crate::pipeline::enqueue_pull(name.trim());
    (StatusCode::ACCEPTED, Json(json!({"pull": pull_state(&app.cfg.data_dir)}))).into_response()
}

/// DELETE /api/models/<name>: remove an installed Ollama model, never the one in use.
pub async fn delete(State(app): State<AppState>, UrlPath(name): UrlPath<String>) -> Response {
    if !model_name_ok(&name) {
        return error(StatusCode::BAD_REQUEST, "That is not a valid model name.");
    }
    let p = app.profile();
    let same = |a: &str, b: &str| a.strip_suffix(":latest").unwrap_or(a) == b.strip_suffix(":latest").unwrap_or(b);
    if p.llm_provider == "ollama" && same(&name, &p.llm_model) {
        return error(StatusCode::CONFLICT, format!("{name} writes your notes now. Pick another model first."));
    }
    let url = providers::ollama_url(&p);
    let res = tokio::task::spawn_blocking(move || http(30).delete(format!("{url}/api/delete")).json(&json!({"model": name})).send()).await;
    match res {
        Ok(Ok(r)) if r.status().is_success() => StatusCode::NO_CONTENT.into_response(),
        Ok(Ok(r)) if r.status() == reqwest::StatusCode::NOT_FOUND => error(StatusCode::NOT_FOUND, "That model is not installed."),
        Ok(Ok(r)) => error(StatusCode::BAD_GATEWAY, format!("Ollama refused: {}", r.status().as_u16())),
        Ok(Err(e)) => error(StatusCode::BAD_GATEWAY, format!("Could not reach Ollama: {}", root_cause(&e))),
        Err(_) => error(StatusCode::BAD_GATEWAY, "Could not reach Ollama."),
    }
}

/// The `exp` claim of a key that is a JWT, as an ISO timestamp; nothing is sent anywhere.
fn jwt_expiry(key: &str) -> Option<String> {
    let parts: Vec<&str> = key.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    let body = b64url(parts[1])?;
    let exp = serde_json::from_slice::<Value>(&body).ok()?.get("exp")?.as_f64()?;
    let secs = exp.floor() as i64;
    let iso = crate::db::iso_from_unix(secs, ((exp - secs as f64) * 1e6).round() as u32);
    Some(iso.replace(".000000+", "+")) // Python's isoformat() drops a zero fraction
}

fn b64url(s: &str) -> Option<Vec<u8>> {
    let val = |c: u8| -> Option<u32> {
        Some(match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'-' | b'+' => 62,
            b'_' | b'/' => 63,
            _ => return None,
        } as u32)
    };
    let mut out = Vec::new();
    let (mut acc, mut bits) = (0u32, 0);
    for &c in s.trim_end_matches('=').as_bytes() {
        acc = (acc << 6) | val(c)?;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Some(out)
}

/// When the key stops working, if anything says: the key itself, then OpenRouter's /key.
fn key_expiry(p: &Profile) -> Option<String> {
    if let Some(e) = jwt_expiry(p.api_key.as_deref().unwrap_or("")) {
        return Some(e);
    }
    if p.llm_provider != "openrouter" {
        return None;
    }
    let data = providers::get(p, "/key", Duration::from_secs(15)).ok()?;
    let info = if data["data"].is_object() { &data["data"] } else { &data };
    ["expires_at", "expiration", "expires", "expiry", "expire_at"]
        .iter()
        .find_map(|f| info.get(*f).and_then(Value::as_str).map(str::trim).filter(|v| !v.is_empty()).map(String::from))
}

/// POST /api/settings/test: try an LLM server before saving it. Unsaved values win over saved
/// ones; an empty value keeps the saved one.
pub async fn settings_test(State(app): State<AppState>, body: Bytes) -> Response {
    let data: Value = if body.is_empty() { json!({}) } else { serde_json::from_slice(&body).unwrap_or(Value::Null) };
    let Some(obj) = data.as_object() else { return error(StatusCode::BAD_REQUEST, "Expected a JSON object.") };
    let given: serde_json::Map<String, Value> = obj.iter().filter(|(_, v)| !(v.is_null() || v.as_str() == Some(""))).map(|(k, v)| (k.clone(), v.clone())).collect();
    let clean = match settings::validate(&Value::Object(given), &|i| app.template_exists(i)) {
        Ok(c) => c,
        Err(e) => return error(StatusCode::BAD_REQUEST, if e.is_empty() { "Expected a JSON object.".into() } else { e }),
    };
    let mut merged = app.settings();
    for (k, v) in clean {
        if let Some(v) = v {
            merged.insert(k, v);
        }
    }
    let (ram, cuda, cpus, vram) = app.hardware;
    let mut p = hw::apply_overrides(&hw::build_profile(&hw::env_map(), ram, cuda, cpus, vram), &merged);
    if p.ollama_url.as_deref().unwrap_or("").is_empty() {
        p.ollama_url = Some(app.cfg.ollama_url.clone());
    }
    let out = tokio::task::spawn_blocking(move || {
        let provider = p.llm_provider.clone();
        if provider == "ollama" {
            let url = providers::ollama_url(&p);
            return match http(5).get(format!("{url}/api/tags")).send().and_then(|r| r.error_for_status()).and_then(|r| r.json::<Value>()) {
                Ok(tags) => {
                    let mut names: Vec<String> = tags["models"].as_array().into_iter().flatten().filter_map(|m| m["name"].as_str().filter(|n| !n.is_empty()).map(String::from)).collect();
                    names.sort();
                    json!({"connected": true, "provider": provider, "models": names, "expires_at": null, "error": ""})
                }
                Err(e) => json!({"connected": false, "provider": provider, "models": [], "expires_at": null,
                                 "error": format!("Could not reach Ollama at {url}: {}", root_cause(&e))}),
            };
        }
        match providers::get(&p, "/models", Duration::from_secs(15)) {
            Ok(data) => {
                let mut ids: Vec<String> = data["data"].as_array().into_iter().flatten().filter_map(|m| m["id"].as_str().filter(|n| !n.is_empty()).map(String::from)).collect();
                ids.sort();
                ids.dedup();
                // only asked once the key is known to work, and never allowed to fail the test
                json!({"connected": true, "provider": provider, "models": ids, "expires_at": key_expiry(&p), "error": ""})
            }
            Err(e) => json!({"connected": false, "provider": provider, "models": [], "expires_at": null, "error": e}),
        }
    })
    .await;
    match out {
        Ok(v) => Json(v).into_response(),
        Err(_) => error(StatusCode::INTERNAL_SERVER_ERROR, "The test failed."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jwt_exp_is_read_locally() {
        // {"alg":"none"}.{"exp":1767225600}.sig
        assert_eq!(jwt_expiry("eyJhbGciOiJub25lIn0.eyJleHAiOjE3NjcyMjU2MDB9.c2ln").as_deref(), Some("2026-01-01T00:00:00+00:00"));
        assert_eq!(jwt_expiry("gsk_plainkey"), None);
    }
}
