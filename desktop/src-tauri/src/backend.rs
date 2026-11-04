//! Docker and backend lifecycle for the desktop app.
//!
//! Every command here is called from the launcher page with `invoke(...)`.
//! Nothing goes through a shell: `docker` runs as a list of arguments.

use std::process::Stdio;

use serde::Serialize;
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
