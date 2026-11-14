//! Docker and backend lifecycle for the desktop app.
//!
//! Every command here is called from the launcher page with `invoke(...)`.
//! Nothing goes through a shell: `docker` runs as a list of arguments.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::process::{Child, Command};

/// Compose project name, so `up`/`down`/`logs` always address the same stack.
const PROJECT: &str = "privmeet";

/// Where the app answers once the stack is healthy.
const API_HOST: &str = "127.0.0.1";
const API_PORT: u16 = 8000;
const API_PATH: &str = "/api/system/";

/// Timeout for the status probe, so a half-started stack cannot hang the launcher.
const PROBE_TIMEOUT: Duration = Duration::from_secs(3);

/// What `check_docker` reports to the launcher.
#[derive(Serialize)]
pub struct DockerReport {
    pub installed: bool,
    pub running: bool,
    pub compose: bool,
    pub version: String,
}

/// What `backend_status` reports to the launcher.
#[derive(Serialize)]
pub struct BackendStatus {
    pub running: bool,
    pub status: u16,
    pub system: Option<serde_json::Value>,
    pub error: String,
}

/// Holder for the running `docker compose logs -f` child, so a second call (or a
/// stop) can end the previous stream.
#[derive(Default)]
pub struct Logs(Mutex<Option<Child>>);

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
    dev.is_file().then_some(dev)
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
    let mut state = (nanos ^ ((std::process::id() as u64) << 32)) | 1;
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
    stop_stack(&app, dir).await
}

/// The body of `stop_backend`, reusable from the window-close handler.
pub async fn stop_stack(app: &AppHandle, dir: Option<String>) -> Result<String, String> {
    let dir = compose_dir(app, dir)?;
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

/// Launcher settings, kept in the app data directory so a quit can read them without
/// the webview. Fields default, so an older file with fewer keys still loads.
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Settings {
    #[serde(default)]
    pub keep_running: bool,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not find the app data directory: {e}"))?;
    std::fs::create_dir_all(&base).map_err(|e| format!("Could not create {}: {e}", base.display()))?;
    Ok(base.join("launcher-settings.json"))
}

/// Read the settings file. A missing or unreadable file means "defaults", never an error
/// that would stop the launcher from opening.
fn load_settings(app: &AppHandle) -> Settings {
    settings_path(app)
        .ok()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Whether the stack should outlive the window. Read by the close handler.
pub fn keep_running(app: &AppHandle) -> bool {
    load_settings(app).keep_running
}

/// Current launcher settings.
#[tauri::command]
pub fn get_settings(app: AppHandle) -> Settings {
    load_settings(&app)
}

/// Save the launcher settings and return what was stored.
#[tauri::command]
pub fn set_settings(app: AppHandle, settings: Settings) -> Result<Settings, String> {
    let path = settings_path(&app)?;
    let text = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Could not serialise the settings: {e}"))?;
    std::fs::write(&path, text).map_err(|e| format!("Could not write {}: {e}", path.display()))?;
    Ok(settings)
}

/// Open an install guide in the user's browser. Only http(s) is allowed, so a bad value
/// from the page cannot launch an arbitrary program.
#[tauri::command]
pub async fn open_link(app: AppHandle, url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only http and https links can be opened.".to_string());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("Could not open the browser: {e}"))
}

/// Ask the app itself whether it is up. Never a shell call: one request on a socket
/// with a 3 s timeout, so a closed port fails fast.
#[tauri::command]
pub async fn backend_status() -> BackendStatus {
    match http_get(API_PATH).await {
        Ok((status, body)) => BackendStatus {
            running: (200..300).contains(&status),
            status,
            system: serde_json::from_str(&body).ok(),
            error: String::new(),
        },
        Err(error) => BackendStatus { running: false, status: 0, system: None, error },
    }
}

/// Minimal HTTP/1.1 GET with `Connection: close`; enough for a localhost JSON health check
/// and one less dependency than a full HTTP client.
async fn http_get(path: &str) -> Result<(u16, String), String> {
    let connect = tokio::time::timeout(PROBE_TIMEOUT, TcpStream::connect((API_HOST, API_PORT))).await;
    let mut stream = match connect {
        Ok(Ok(stream)) => stream,
        Ok(Err(e)) => return Err(format!("{API_HOST}:{API_PORT} is not reachable: {e}")),
        Err(_) => return Err(format!("Timed out connecting to {API_HOST}:{API_PORT}")),
    };

    let request = format!("GET {path} HTTP/1.1\r\nHost: {API_HOST}:{API_PORT}\r\nConnection: close\r\n\r\n");
    stream
        .write_all(request.as_bytes())
        .await
        .map_err(|e| format!("Could not send the request: {e}"))?;

    let mut raw = Vec::new();
    match tokio::time::timeout(PROBE_TIMEOUT, stream.read_to_end(&mut raw)).await {
        Ok(Ok(_)) => {}
        Ok(Err(e)) => return Err(format!("Could not read the response: {e}")),
        Err(_) => return Err("The backend did not answer in time".to_string()),
    }

    let text = String::from_utf8_lossy(&raw);
    let (head, body) = text
        .split_once("\r\n\r\n")
        .ok_or_else(|| "Malformed HTTP response from the backend".to_string())?;
    let status = head
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or_else(|| "Malformed status line from the backend".to_string())?;
    Ok((status, body.to_string()))
}

/// Stream `docker compose logs -f` to the launcher as `backend-log` events, one line
/// per event, followed by `backend-log-end` when the stream closes. Stops any stream
/// started before, so repeated retries never stack up.
#[tauri::command]
pub async fn backend_logs(
    app: AppHandle,
    state: State<'_, Logs>,
    dir: Option<String>,
) -> Result<(), String> {
    let dir = compose_dir(&app, dir)?;
    stop_log_stream(&state).await;

    let mut child = compose_command(&dir, has_nvidia().await)
        .args(["logs", "-f", "--tail", "80", "--no-color"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not run docker compose logs: {e}"))?;
    let stdout = child.stdout.take().ok_or("docker compose logs gave no output pipe")?;
    let stderr = child.stderr.take().ok_or("docker compose logs gave no error pipe")?;

    pump(app.clone(), stdout);
    pump(app, stderr);

    *state.0.lock().map_err(|_| "The log stream state is poisoned".to_string())? = Some(child);
    Ok(())
}

/// Kill the previous `logs -f` child without holding the mutex across the await.
async fn stop_log_stream(state: &State<'_, Logs>) {
    let previous = match state.0.lock() {
        Ok(mut slot) => slot.take(),
        Err(_) => None,
    };
    if let Some(mut child) = previous {
        let _ = child.kill().await;
    }
}

/// Forward every line of `reader` as an event, then signal the end of the stream.
fn pump<R>(app: AppHandle, reader: R)
where
    R: AsyncRead + Unpin + Send + 'static,
{
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app.emit("backend-log", line);
        }
        let _ = app.emit("backend-log-end", ());
    });
}
