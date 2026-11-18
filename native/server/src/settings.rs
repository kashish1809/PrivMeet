//! User settings that override the hardware tier: DATA_DIR/settings.json.
//!
//! A port of backend/meetings/settings_store.py with the same file, keys, validation and error
//! messages, so the Django and Rust servers can read each other's file. load() is called at the
//! start of every task; save() validates every key and writes the file atomically.

use std::io::Write;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

pub type Settings = Map<String, Value>;

/// A key's type and limits (settings_store.SCHEMA).
#[derive(Clone, Copy)]
enum Kind {
    Text(usize),
    Model,
    Url,
    Int(i64, i64),
    Choice(&'static [&'static str]),
    Bool,
    Template,
}

const PROVIDERS: &[&str] = &["ollama", "openai", "openrouter", "anthropic", "groq", "gemini", "custom"];

const SCHEMA: &[(&str, Kind)] = &[
    ("display_name", Kind::Text(60)),
    ("llm_model", Kind::Model),
    ("ollama_url", Kind::Url),
    ("whisper_model", Kind::Model),
    ("num_ctx", Kind::Int(512, 131072)),
    ("diarize", Kind::Bool),
    ("cpu_threads", Kind::Int(1, 256)),
    ("default_template", Kind::Template),
    ("vocabulary", Kind::Text(500)),
    ("llm_provider", Kind::Choice(PROVIDERS)),
    ("api_base_url", Kind::Url),
    ("api_key", Kind::Text(300)),
    ("api_model", Kind::Model),
    ("anthropic_api_key", Kind::Text(300)),
    ("anthropic_model", Kind::Model),
    ("openai_api_key", Kind::Text(300)),
    ("openai_model", Kind::Model),
    ("openrouter_api_key", Kind::Text(300)),
    ("openrouter_model", Kind::Model),
    ("groq_api_key", Kind::Text(300)),
    ("groq_model", Kind::Model),
    ("gemini_api_key", Kind::Text(300)),
    ("gemini_model", Kind::Model),
    ("cloud_transcribe", Kind::Bool),
    ("cloud_transcribe_model", Kind::Model),
    ("keep_audio", Kind::Bool),
];

/// Never sent back to the browser: GET /api/settings/ says only whether one is saved.
pub const SECRET: &[&str] = &[
    "api_key", "anthropic_api_key", "openai_api_key", "openrouter_api_key", "groq_api_key", "gemini_api_key",
];

fn kind(key: &str) -> Option<Kind> {
    SCHEMA.iter().find(|(k, _)| *k == key).map(|(_, kind)| *kind)
}

/// Python's `^[\w.\-/:]+$`: \w is any Unicode letter or digit, or "_".
pub fn is_model_name(v: &str) -> bool {
    !v.is_empty() && v.chars().all(|c| c.is_alphanumeric() || "_.-/:".contains(c))
}

fn text(key: &str, v: &Value, limit: usize) -> Result<String, String> {
    let s = v.as_str().ok_or(format!("{key} must be a string."))?.trim().to_string();
    if s.chars().count() > limit {
        return Err(format!("{key} can be at most {limit} characters."));
    }
    Ok(s)
}

/// One value checked and normalised, or the 400 message (settings_store's validators).
fn check(key: &str, v: &Value, exists: &dyn Fn(&str) -> bool) -> Result<Value, String> {
    let k = kind(key).ok_or(format!("Unknown setting: {key}."))?;
    Ok(match k {
        Kind::Text(limit) => Value::String(text(key, v, limit)?),
        Kind::Model => {
            let s = text(key, v, 100)?;
            if !is_model_name(&s) {
                return Err(format!("{key} is not a valid model name."));
            }
            Value::String(s)
        }
        Kind::Url => {
            let s = text(key, v, 200)?.trim_end_matches('/').to_string();
            let ok = s
                .split_once("://")
                .is_some_and(|(scheme, rest)| matches!(scheme, "http" | "https") && !rest.split('/').next().unwrap_or("").is_empty());
            if !ok {
                return Err(format!("{key} must be an http:// or https:// URL."));
            }
            Value::String(s)
        }
        Kind::Int(lo, hi) => {
            // JSON true is not a 1, and 5.0 is not an int (Python rejects both too)
            let n = v.as_i64().filter(|_| !v.is_boolean()).ok_or(format!("{key} must be a whole number."))?;
            if !(lo..=hi).contains(&n) {
                return Err(format!("{key} must be between {lo} and {hi}."));
            }
            Value::from(n)
        }
        Kind::Choice(options) => {
            let s = v.as_str().filter(|s| options.contains(s));
            Value::String(s.ok_or(format!("{key} must be one of: {}.", options.join(", ")))?.to_string())
        }
        Kind::Bool => Value::Bool(v.as_bool().ok_or(format!("{key} must be true or false."))?),
        Kind::Template => {
            let s = text(key, v, 40)?;
            if !exists(&s) {
                return Err(format!("{key}: no template with id '{s}'."));
            }
            Value::String(s)
        }
    })
}

pub fn path(data_dir: &Path) -> PathBuf {
    data_dir.join("settings.json")
}

/// Saved settings, {} when there are none. A broken file reads as {} rather than stopping every
/// meeting, and a hand-edited bad value drops that key only.
pub fn load(data_dir: &Path, exists: &dyn Fn(&str) -> bool) -> Settings {
    let Ok(raw) = std::fs::read_to_string(path(data_dir)) else { return Settings::new() };
    let Ok(Value::Object(data)) = serde_json::from_str::<Value>(&raw) else { return Settings::new() };
    data.into_iter()
        .filter_map(|(k, v)| check(&k, &v, exists).ok().map(|v| (k, v)))
        .collect()
}

/// Settings as the browser may see them: secrets replaced by <key>_set booleans.
pub fn public(data: &Settings) -> Settings {
    let mut out: Settings = data.iter().filter(|(k, _)| !SECRET.contains(&k.as_str())).map(|(k, v)| (k.clone(), v.clone())).collect();
    for k in SECRET {
        let set = data.get(*k).and_then(Value::as_str).is_some_and(|s| !s.is_empty());
        out.insert(format!("{k}_set"), Value::Bool(set));
    }
    out
}

/// Each key checked; null or "" means "remove the override" (Ok(None)).
pub fn validate(patch: &Value, exists: &dyn Fn(&str) -> bool) -> Result<Vec<(String, Option<Value>)>, String> {
    let obj = patch.as_object().ok_or("Expected a JSON object.")?;
    let mut unknown: Vec<&str> = obj.keys().map(String::as_str).filter(|k| kind(k).is_none()).collect();
    if !unknown.is_empty() {
        unknown.sort_unstable();
        return Err(format!("Unknown setting: {}.", unknown.join(", ")));
    }
    obj.iter()
        .map(|(k, v)| {
            let empty = v.is_null() || v.as_str() == Some("");
            Ok((k.clone(), if empty { None } else { Some(check(k, v, exists)?) }))
        })
        .collect()
}

/// Merge `patch` into the saved settings and return the result, written atomically (a temp
/// file in the same directory, then a rename), so a crash never leaves half a JSON file.
pub fn save(data_dir: &Path, patch: &Value, exists: &dyn Fn(&str) -> bool) -> Result<Settings, String> {
    let clean = validate(patch, exists)?;
    let mut data = load(data_dir, exists);
    for (k, v) in clean {
        match v {
            Some(v) => data.insert(k, v),
            None => data.remove(&k),
        };
    }
    std::fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
    let mut tmp = tempfile::Builder::new()
        .prefix(".settings-")
        .suffix(".json")
        .tempfile_in(data_dir)
        .map_err(|e| e.to_string())?;
    let body = serde_json::to_string_pretty(&Value::Object(data.clone())).map_err(|e| e.to_string())?;
    tmp.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
    tmp.persist(path(data_dir)).map_err(|e| e.to_string())?;
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn any(_: &str) -> bool {
        true
    }
    fn err(patch: Value) -> String {
        validate(&patch, &any).unwrap_err()
    }

    #[test]
    fn same_messages_as_python() {
        assert_eq!(err(json!({"zeta": 1, "alpha": 2})), "Unknown setting: alpha, zeta.");
        assert_eq!(err(json!([1])), "Expected a JSON object.");
        assert_eq!(err(json!({"display_name": 5})), "display_name must be a string.");
        assert_eq!(err(json!({"display_name": "x".repeat(61)})), "display_name can be at most 60 characters.");
        assert_eq!(err(json!({"llm_model": "rm -rf /"})), "llm_model is not a valid model name.");
        assert_eq!(err(json!({"ollama_url": "ftp://x"})), "ollama_url must be an http:// or https:// URL.");
        assert_eq!(err(json!({"num_ctx": true})), "num_ctx must be a whole number.");
        assert_eq!(err(json!({"num_ctx": 5.5})), "num_ctx must be a whole number.");
        assert_eq!(err(json!({"num_ctx": 100})), "num_ctx must be between 512 and 131072.");
        assert_eq!(err(json!({"diarize": 1})), "diarize must be true or false.");
        assert_eq!(
            err(json!({"llm_provider": "x"})),
            "llm_provider must be one of: ollama, openai, openrouter, anthropic, groq, gemini, custom."
        );
        let none = |_: &str| false;
        assert_eq!(validate(&json!({"default_template": "zzz"}), &none).unwrap_err(), "default_template: no template with id 'zzz'.");
    }

    #[test]
    fn normalises_and_removes() {
        let v = validate(&json!({"display_name": "  Vinayak  ", "ollama_url": "http://h:11434/", "vocabulary": ""}), &any).unwrap();
        let get = |k: &str| v.iter().find(|(kk, _)| kk == k).unwrap().1.clone();
        assert_eq!(get("display_name"), Some(json!("Vinayak")));
        assert_eq!(get("ollama_url"), Some(json!("http://h:11434")));
        assert_eq!(get("vocabulary"), None);
        assert!(is_model_name("qwen2.5:1.5b") && is_model_name("openai/gpt-oss-120b") && !is_model_name(""));
    }

    #[test]
    fn save_load_and_public() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), &json!({"display_name": "V", "groq_api_key": "gsk_x", "num_ctx": 8192}), &any).unwrap();
        let after = save(dir.path(), &json!({"display_name": null}), &any).unwrap();
        assert!(!after.contains_key("display_name") && after["num_ctx"] == 8192);
        assert_eq!(load(dir.path(), &any), after);
        let p = public(&after);
        assert!(!p.contains_key("groq_api_key") && p["groq_api_key_set"] == true && p["openai_api_key_set"] == false);
    }

    #[test]
    fn broken_or_hand_edited_files() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(path(dir.path()), "{not json").unwrap();
        assert!(load(dir.path(), &any).is_empty());
        std::fs::write(path(dir.path()), r#"{"num_ctx": "big", "display_name": "Ok", "junk": 1}"#).unwrap();
        let s = load(dir.path(), &any);
        assert_eq!(s.len(), 1);
        assert_eq!(s["display_name"], "Ok");
    }
}
