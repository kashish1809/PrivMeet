//! Language models over HTTP: Ollama (the default, local) and the opt-in cloud providers
//! (OpenAI, OpenRouter, Anthropic, Groq, Gemini, any OpenAI-compatible server), plus cloud
//! transcription. A port of backend/meetings/pipeline/providers.py and llm.chat().

use std::time::Duration;

use serde_json::{json, Value};

use crate::hw::Profile;

pub const ANTHROPIC_VERSION: &str = "2023-06-01";
/// Groq's Cloudflare refuses a client that does not name itself (403, error code 1010).
pub const USER_AGENT: &str = "PrivMeet/1.0";
pub const TIMEOUT: Duration = Duration::from_secs(300);
/// Free Groq and OpenAI accounts refuse an upload over 25 MB; long audio goes in pieces.
pub const MAX_UPLOAD_BYTES: usize = 24 * 1024 * 1024;
pub const CHUNK_SECONDS: f64 = 600.0;

fn client(timeout: Duration) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder().timeout(timeout).user_agent(USER_AGENT).build().map_err(|e| e.to_string())
}

/// Where the provider lives; "custom" takes api_base_url from Settings.
pub fn base_url(p: &Profile) -> Result<String, String> {
    let url = match p.llm_provider.as_str() {
        "openai" => Some("https://api.openai.com/v1".to_string()),
        "openrouter" => Some("https://openrouter.ai/api/v1".into()),
        "anthropic" => Some("https://api.anthropic.com/v1".into()),
        "groq" => Some("https://api.groq.com/openai/v1".into()),
        "gemini" => Some("https://generativelanguage.googleapis.com/v1beta/openai".into()),
        "custom" => p.api_base_url.clone(),
        _ => None,
    };
    url.filter(|u| !u.is_empty()).map(|u| u.trim_end_matches('/').to_string()).ok_or_else(|| "No server URL set for this provider.".into())
}

fn with_headers(p: &Profile, req: reqwest::blocking::RequestBuilder) -> reqwest::blocking::RequestBuilder {
    let key = p.api_key.clone().unwrap_or_default();
    if p.llm_provider == "anthropic" {
        return req.header("x-api-key", key).header("anthropic-version", ANTHROPIC_VERSION);
    }
    let req = if key.is_empty() { req } else { req.bearer_auth(key) };
    if p.llm_provider == "openrouter" { req.header("x-title", "PrivMeet") } else { req }
}

/// A provider's error as one readable line: "401 from the provider: Invalid API Key".
fn read(resp: Result<reqwest::blocking::Response, reqwest::Error>) -> Result<Value, String> {
    let resp = resp.map_err(|e| format!("Could not reach the provider: {}", e.without_url()))?;
    let status = resp.status();
    let text = resp.text().unwrap_or_default();
    if !status.is_success() {
        let detail: String = text.chars().take(300).collect();
        let msg = serde_json::from_str::<Value>(&detail)
            .ok()
            .and_then(|v| match &v["error"] {
                Value::Object(o) => o.get("message").and_then(Value::as_str).map(String::from),
                Value::String(s) => Some(s.clone()),
                _ => None,
            })
            .unwrap_or(detail);
        return Err(format!("{} from the provider: {msg}", status.as_u16()));
    }
    serde_json::from_str(&text).map_err(|_| "The provider sent a reply PrivMeet could not read.".into())
}

/// One chat call: a system prompt and one user message. `json_mode` asks for a JSON object.
/// `num_predict` caps the reply on Ollama only (to keep prompt + reply inside num_ctx); a cloud
/// model gets no cap, since a reasoning model's hidden tokens count against it.
pub fn chat(p: &Profile, system: &str, user: &str, json_mode: bool, num_predict: Option<i64>) -> Result<String, String> {
    if p.llm_provider == "ollama" {
        return ollama_chat(p, system, user, json_mode, num_predict);
    }
    let model = p.api_model.clone().filter(|m| !m.is_empty()).ok_or("Choose a model for this provider in Settings.")?;
    let url = base_url(p)?;
    let http = client(TIMEOUT)?;
    if p.llm_provider == "anthropic" {
        let body = json!({
            "model": model, "max_tokens": 1024, "temperature": 0.1,
            "system": format!("{system}{}", if json_mode { "\nReply with JSON only." } else { "" }),
            "messages": [{"role": "user", "content": user}],
        });
        let data = read(with_headers(p, http.post(format!("{url}/messages"))).json(&body).send())?;
        return Ok(data["content"]
            .as_array()
            .map(|parts| parts.iter().filter(|x| x["type"] == "text").filter_map(|x| x["text"].as_str()).collect::<String>())
            .unwrap_or_default());
    }
    let mut body = json!({
        "model": model, "temperature": 0.1,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
    });
    if json_mode {
        body["response_format"] = json!({"type": "json_object"});
    }
    let data = read(with_headers(p, http.post(format!("{url}/chat/completions"))).json(&body).send())?;
    data["choices"][0]["message"]["content"]
        .as_str()
        .map(String::from)
        .or_else(|| data["choices"][0]["message"]["content"].is_null().then(String::new))
        .ok_or_else(|| "The provider sent a reply PrivMeet could not read.".into())
}

/// The Ollama server: the one in Settings, else OLLAMA_URL (App::profile fills it in).
pub fn ollama_url(p: &Profile) -> String {
    p.ollama_url.clone().filter(|u| !u.is_empty()).unwrap_or_else(|| "http://localhost:11434".into()).trim_end_matches('/').to_string()
}

fn ollama_chat(p: &Profile, system: &str, user: &str, json_mode: bool, num_predict: Option<i64>) -> Result<String, String> {
    let url = ollama_url(p);
    let mut options = json!({"num_ctx": p.num_ctx, "temperature": 0.1});
    if let Some(n) = num_predict {
        options["num_predict"] = json!(n);
    }
    if p.device != "cuda" {
        options["num_thread"] = json!(p.cpu_threads);
    }
    let mut body = json!({
        "model": p.llm_model, "stream": false, "keep_alive": p.keep_alive, "options": options,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
    });
    if json_mode {
        body["format"] = json!("json");
    }
    let resp = client(TIMEOUT)?.post(format!("{url}/api/chat")).json(&body).send();
    let resp = resp.map_err(|e| format!("Could not reach Ollama at {url}: {}", e.without_url()))?;
    let status = resp.status();
    let data: Value = resp.json().unwrap_or_default();
    if !status.is_success() {
        return Err(format!("Ollama: {}", data["error"].as_str().unwrap_or(status.as_str())));
    }
    Ok(data["message"]["content"].as_str().unwrap_or("").to_string())
}

/// Pull the model on first use; a no-op when Ollama already has it, and for cloud providers.
pub fn ensure_model(p: &Profile) -> Result<(), String> {
    if p.llm_provider != "ollama" {
        return Ok(());
    }
    let url = ollama_url(p);
    let resp = client(Duration::from_secs(3 * 3600))?
        .post(format!("{url}/api/pull"))
        .json(&json!({"model": p.llm_model, "stream": false}))
        .send()
        .map_err(|e| format!("Could not reach Ollama at {url}: {}", e.without_url()))?;
    if resp.status().is_success() {
        Ok(())
    } else {
        Err(format!("Ollama could not get {}: {}", p.llm_model, resp.text().unwrap_or_default().chars().take(200).collect::<String>()))
    }
}

/// One /audio/transcriptions call (OpenAI-style, Groq, custom). The provider's verbose_json.
pub fn transcribe_chunk(p: &Profile, blob: Vec<u8>, model: &str, language: Option<&str>, prompt: &str) -> Result<Value, String> {
    let mut form = reqwest::blocking::multipart::Form::new()
        .text("model", model.to_string())
        .text("response_format", "verbose_json")
        .text("temperature", "0");
    if let Some(l) = language.filter(|l| !l.is_empty()) {
        form = form.text("language", l.to_string());
    }
    if !prompt.is_empty() {
        form = form.text("prompt", prompt.to_string());
    }
    let part = reqwest::blocking::multipart::Part::bytes(blob).file_name("audio.flac").mime_str("application/octet-stream").map_err(|e| e.to_string())?;
    form = form.part("file", part);
    let url = base_url(p)?;
    let http = client(TIMEOUT)?;
    read(with_headers(p, http.post(format!("{url}/audio/transcriptions"))).multipart(form).send())
}
