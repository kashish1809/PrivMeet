//! Settings from the environment, with the same names and defaults as the Django backend
//! (backend/privmeet/settings.py), so a deployment can switch servers without new config.

use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct Config {
    /// Where to listen. Only loopback by default: there is no login (docs/TASKS.md, security).
    pub host: String,
    pub port: u16,
    /// Host header values accepted (Django's ALLOWED_HOSTS), without the port.
    pub allowed_hosts: Vec<String>,
    /// Origins allowed to send unsafe requests from another port (Vite's dev server).
    pub trusted_origins: Vec<String>,
    pub data_dir: PathBuf,
    pub media_root: PathBuf,
    pub models_dir: PathBuf,
    /// The built React app (frontend/dist), served under /static/ with index.html for the rest.
    pub frontend_dist: PathBuf,
    pub max_upload_mb: u64,
    pub ollama_url: String,
}

fn env(key: &str, default: &str) -> String {
    std::env::var(key).ok().filter(|v| !v.is_empty()).unwrap_or_else(|| default.to_string())
}

fn list(value: String) -> Vec<String> {
    value.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect()
}

impl Config {
    pub fn from_env() -> Self {
        let data_dir = PathBuf::from(env("DATA_DIR", "data"));
        Config {
            host: env("HOST", "127.0.0.1"),
            port: env("PORT", "8000").parse().unwrap_or(8000),
            allowed_hosts: list(env("ALLOWED_HOSTS", "localhost,127.0.0.1")),
            trusted_origins: list(env("CSRF_TRUSTED_ORIGINS", "http://localhost:5173")),
            media_root: data_dir.join("media"),
            models_dir: std::env::var("MODELS_DIR").map(PathBuf::from).unwrap_or_else(|_| data_dir.join("models")),
            frontend_dist: PathBuf::from(env("FRONTEND_DIST", "frontend_dist")),
            max_upload_mb: env("MAX_UPLOAD_MB", "2048").parse().unwrap_or(2048),
            ollama_url: env("OLLAMA_URL", "http://localhost:11434"),
            data_dir,
        }
    }
}
