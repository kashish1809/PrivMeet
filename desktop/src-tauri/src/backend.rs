//! Docker and backend lifecycle for the desktop app.
//!
//! Every command here is called from the launcher page with `invoke(...)`.
//! Nothing goes through a shell: `docker` runs as a list of arguments.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::Serialize;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};
use tokio::process::Command;

/// Compose project name, so `up`/`down`/`logs` always address the same stack.
const PROJECT: &str = "privmeet";

/// What `check_docker` reports to the launcher.
#[derive(Serialize)]
pub struct DockerReport {
    pub installed: bool,
    pub running: bool,
    pub compose: bool,
    pub version: String,
}

/// Run docker with `args` and return trimmed stdout, or the trimmed stderr as the error.
async fn docker_capture(args: &[&str]) -> Result<String, String> {
    let out = Command::new("docker")
        .args(args)
        .output()
        .await
        .map_err(|e| format!("Could not run docker: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if err.is_empty() { format!("docker {} failed", args.join(" ")) } else { err })
    }
}

/// Installed, daemon running, compose v2 available, plus the client version string.
#[tauri::command]
pub async fn check_docker() -> DockerReport {
    let version = docker_capture(&["--version"]).await.unwrap_or_default();
    let installed = !version.is_empty();
    let running = installed
        && docker_capture(&["info", "--format", "{{.ServerVersion}}"])
            .await
            .map(|v| !v.is_empty())
            .unwrap_or(false);
    let compose = installed
        && docker_capture(&["compose", "version", "--short"])
            .await
            .map(|v| !v.is_empty())
            .unwrap_or(false);
    DockerReport { installed, running, compose, version }
}

/// True when `nvidia-smi` succeeds, which is the signal for the compose GPU override.
#[tauri::command]
pub async fn has_nvidia() -> bool {
    Command::new("nvidia-smi")
        .arg("-L")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Where compose runs from. Default is `<app data>/compose`, filled from the bundled
/// resources; `dir` lets a developer point at the repo checkout instead.
fn compose_dir(app: &AppHandle, dir: Option<String>) -> Result<PathBuf, String> {
    if let Some(dir) = dir {
        let dir = PathBuf::from(dir);
        return if dir.join("compose.yml").is_file() {
            Ok(dir)
        } else {
            Err(format!("{} does not contain a compose.yml", dir.display()))
        };
    }

    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not find the app data directory: {e}"))?;
    let dir = base.join("compose");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    for name in ["compose.yml", "compose.gpu.yml"] {
        if let Some(src) = bundled_compose(app, name) {
            std::fs::copy(&src, dir.join(name))
                .map_err(|e| format!("Could not copy {name} into the app data directory: {e}"))?;
        }
    }
    if !dir.join("compose.yml").is_file() {
        return Err("compose.yml is missing from the app bundle".to_string());
    }
    ensure_env(&dir)?;
    Ok(dir)
}

/// Bundled resource first, then the repo next to src-tauri so `tauri dev` works
/// before the resources are copied.
fn bundled_compose(app: &AppHandle, name: &str) -> Option<PathBuf> {
    let resource = Path::new("compose").join(name);
    if let Ok(path) = app.path().resolve(resource, BaseDirectory::Resource) {
        if path.is_file() {
            return Some(path);
        }
    }
    let dev = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").join(name);
    dev.is_file().then(|| dev)
}

/// compose.yml requires SECRET_KEY via `${SECRET_KEY:?…}`, so write one on first start.
/// A2.3 turns this file into the settings the user can edit.
fn ensure_env(dir: &Path) -> Result<(), String> {
    let path = dir.join(".env");
    if path.is_file() {
        return Ok(());
    }
    let body = format!(
        "# Written by PrivMeet on first start. Keep this file private.\n\
         # Change SECRET_KEY to sign out of every session (there is no login, so it only\n\
         # invalidates existing forms); the stack restarts with the new value.\n\
         SECRET_KEY={}\n",
        random_secret()
    );
    std::fs::write(&path, body).map_err(|e| format!("Could not write {}: {e}", path.display()))
}

/// 50 hex characters from a time/pid seeded xorshift.
// shortcut: a local-only secret for a single-user install; swap in a CSPRNG if PrivMeet ever
// serves more than 127.0.0.1.
fn random_secret() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0x9e37_79b9_7f4a_7c15);
    let mut state = nanos ^ ((std::process::id() as u64) << 32) | 1;
    (0..50)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            char::from_digit((state % 16) as u32, 16).unwrap_or('0')
        })
        .collect()
}

/// `docker compose -p privmeet -f compose.yml [-f compose.gpu.yml]`, run inside `dir`
/// so the project's `.env` is the one compose reads.
fn compose_command(dir: &Path, gpu: bool) -> Command {
    let mut cmd = Command::new("docker");
    cmd.arg("compose")
        .arg("-p")
        .arg(PROJECT)
        .arg("-f")
        .arg(dir.join("compose.yml"));
    if gpu {
        let override_file = dir.join("compose.gpu.yml");
        if override_file.is_file() {
            cmd.arg("-f").arg(override_file);
        }
    }
    cmd.current_dir(dir);
    cmd
}

/// Start the stack in the background. Returns compose's output, or its error text.
#[tauri::command]
pub async fn start_backend(app: AppHandle, dir: Option<String>) -> Result<String, String> {
    let dir = compose_dir(&app, dir)?;
    let out = compose_command(&dir, has_nvidia().await)
        .args(["up", "-d", "--remove-orphans"])
        .output()
        .await
        .map_err(|e| format!("Could not run docker compose: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if out.status.success() {
        Ok(if stdout.is_empty() { "Stack started.".to_string() } else { stdout })
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if stderr.is_empty() { "docker compose up failed".to_string() } else { stderr })
    }
}

/// Stop and remove the containers. Named volumes (meetings, models) are kept.
#[tauri::command]
pub async fn stop_backend(app: AppHandle, dir: Option<String>) -> Result<String, String> {
    let dir = compose_dir(&app, dir)?;
    let out = compose_command(&dir, has_nvidia().await)
        .args(["down", "--remove-orphans"])
        .output()
        .await
        .map_err(|e| format!("Could not run docker compose: {e}"))?;
    if out.status.success() {
        Ok("Stack stopped.".to_string())
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if stderr.is_empty() { "docker compose down failed".to_string() } else { stderr })
    }
}
