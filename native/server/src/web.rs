//! HTTP layer: shared state, the router, the Host check, the built React app and JSON errors.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use axum::{
    body::{Body, Bytes},
    extract::{Request, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde_json::{json, Value};
use tower_http::services::ServeDir;

use crate::config::Config;
use crate::{api, csrf, db, hw, models, pipeline, settings, templates};

/// What every request can reach: configuration, the database and the hardware (read once).
pub struct App {
    pub cfg: Config,
    pub db: Mutex<rusqlite::Connection>,
    /// RAM GB, usable CUDA, CPU cores, VRAM GB: hw::detected(), at startup.
    pub hardware: (f64, bool, usize, Option<f64>),
}

pub type AppState = Arc<App>;

/// What this server supports beyond the v1 API (docs/TASKS.md "Feature flags"). Only what is
/// built: the React app shows a control only when its flag is here.
pub const FEATURES: &[&str] = &["settings", "providers", "notes", "tags", "filters", "templates", "models", "exports", "share-page", "exports-office", "exports-ics", "audio-exports", "summarize", "transcript-edit", "speaker-merge", "cancel"];

/// Built-in note template ids (backend/meetings/note_templates.py); own ones are "u<pk>".
pub fn builtin_template(id: &str) -> bool {
    crate::templates::BUILTINS.iter().any(|b| b.id == id)
}

/// The error body every endpoint uses, as Django's bad(): {"error": "..."}; api.js shows it.
pub fn error(status: StatusCode, msg: impl Into<String>) -> Response {
    (status, Json(json!({ "error": msg.into() }))).into_response()
}

impl App {
    pub fn new(cfg: Config) -> Result<Self, String> {
        let conn = db::open(&cfg.data_dir.join("privmeet.sqlite3")).map_err(|e| format!("database: {e}"))?;
        let hardware = hw::detected(&cfg.data_dir);
        Ok(App { cfg, db: Mutex::new(conn), hardware })
    }

    /// Whether a note template id exists: a built-in, or an own template "u<pk>".
    pub fn template_exists(&self, id: &str) -> bool {
        if builtin_template(id) {
            return true;
        }
        let Some(pk) = id.strip_prefix('u').and_then(|n| n.parse::<i64>().ok()) else { return false };
        self.db().query_row("SELECT 1 FROM note_templates WHERE id = ?1", [pk], |_| Ok(())).is_ok()
    }

    /// The database. One connection behind a mutex: a single-user app, and every query is short.
    pub fn db(&self) -> std::sync::MutexGuard<'_, rusqlite::Connection> {
        self.db.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// The template an upload gets when it names none (note_templates.default_id).
    pub fn default_template(&self) -> String {
        self.settings()
            .get("default_template")
            .and_then(Value::as_str)
            .filter(|id| self.template_exists(id))
            .unwrap_or("general")
            .to_string()
    }

    pub fn settings(&self) -> settings::Settings {
        settings::load(&self.cfg.data_dir, &|id| self.template_exists(id))
    }

    /// Tier + env + saved settings, as hw.profile().
    pub fn profile(&self) -> hw::Profile {
        let (ram, cuda, cpus, vram) = self.hardware;
        let base = hw::build_profile(&hw::env_map(), ram, cuda, cpus, vram);
        let mut p = hw::apply_overrides(&base, &self.settings());
        if p.ollama_url.as_deref().unwrap_or("").is_empty() {
            p.ollama_url = Some(self.cfg.ollama_url.clone()); // OLLAMA_URL from the environment
        }
        p
    }
}

pub fn router(app: App) -> Router {
    let state: AppState = Arc::new(app);
    pipeline::start(state.clone());
    let upload_limit = (state.cfg.max_upload_mb as usize + 1) * 1024 * 1024; // + multipart overhead
    let api = Router::new()
        .route("/system/", get(system))
        .route("/settings/", get(settings_get).patch(settings_patch))
        .route("/settings/test", axum::routing::post(models::settings_test))
        .route("/models/", get(models::models))
        .route("/models/pull", axum::routing::post(models::pull))
        .route("/models/{*name}", axum::routing::delete(models::delete))
        .route(
            "/meetings/",
            get(api::list).post(api::create).layer(axum::extract::DefaultBodyLimit::max(upload_limit)),
        )
        .route("/meetings/{id}/", get(api::detail).patch(api::patch).delete(api::delete))
        .route("/meetings/{id}/audio", get(api::audio))
        .route("/meetings/{id}/retry", axum::routing::post(api::retry))
        .route("/meetings/{id}/ask", axum::routing::post(api::ask))
        .route("/meetings/{id}/summarize", axum::routing::post(api::summarize))
        .route("/meetings/{id}/cancel", axum::routing::post(api::cancel))
        .route("/meetings/{id}/speakers/merge", axum::routing::post(api::merge_speakers))
        .route("/segments/{id}/", axum::routing::patch(api::patch_segment))
        .route("/meetings/{id}/{file}", get(api::download))
        .route("/questions/{id}/", get(api::question))
        .route("/templates/", get(templates::list).post(templates::create))
        .route("/templates/{id}/", get(templates::detail).patch(templates::patch).delete(templates::delete))
        .route("/tags/", get(api::tags))
        .route("/action-items/", get(api::action_items))
        .fallback(|| async { error(StatusCode::NOT_FOUND, "Not found.") })
        .layer(middleware::from_fn_with_state(state.clone(), csrf::protect));
    Router::new()
        .nest("/api", api)
        .nest_service("/static", ServeDir::new(&state.cfg.frontend_dist))
        .fallback(get(spa))
        .layer(middleware::from_fn_with_state(state.clone(), allowed_host))
        .with_state(state)
}

/// GET /api/system/: the profile the next meeting will use, and the feature flags. Sets the
/// CSRF cookie, as Django's ensure_csrf_cookie does: the app calls this first.
async fn system(State(app): State<AppState>, headers: HeaderMap) -> Response {
    let p = app.profile();
    let mut data = json!({
        "tier": p.tier, "whisper_model": p.whisper_model, "llm_model": p.llm_model,
        "device": p.device, "diarize": p.diarize, "llm_provider": p.llm_provider,
        "features": FEATURES,
    });
    if p.llm_provider != "ollama" {
        data["llm_model"] = json!(p.api_model.unwrap_or_default()); // the model that writes the notes
    }
    let cuda_error = hw::cuda_error(&app.cfg.data_dir);
    if !cuda_error.is_empty() {
        data["device"] = json!("cpu");
        data["cuda_error"] = json!(cuda_error);
    }
    let mut resp = Json(data).into_response();
    csrf::ensure_cookie(&headers, &mut resp);
    resp
}

async fn settings_get(State(app): State<AppState>) -> Response {
    Json(Value::Object(settings::public(&app.settings()))).into_response()
}

/// PATCH /api/settings/: merge; a key set to null goes back to the tier default.
async fn settings_patch(State(app): State<AppState>, body: Bytes) -> Response {
    let patch: Value = if body.is_empty() {
        json!({})
    } else {
        match serde_json::from_slice(&body) {
            Ok(v) => v,
            Err(_) => return error(StatusCode::BAD_REQUEST, "Invalid JSON."),
        }
    };
    match settings::save(&app.cfg.data_dir, &patch, &|id| app.template_exists(id)) {
        Ok(saved) => Json(Value::Object(settings::public(&saved))).into_response(),
        Err(e) => error(StatusCode::BAD_REQUEST, e),
    }
}

/// Refuse requests whose Host is not ours (Django's ALLOWED_HOSTS): a web page on another
/// site could otherwise reach this unauthenticated server through DNS rebinding.
async fn allowed_host(State(app): State<AppState>, req: Request, next: Next) -> Response {
    let host = req
        .headers()
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .map(|h| h.rsplit_once(':').map_or(h, |(name, port)| if port.chars().all(|c| c.is_ascii_digit()) { name } else { h }))
        .unwrap_or("");
    if !app.cfg.allowed_hosts.iter().any(|a| a.eq_ignore_ascii_case(host)) {
        return error(StatusCode::BAD_REQUEST, "Invalid Host header.");
    }
    next.run(req).await
}

/// Every non-API path gets the React app's index.html (hash routing does the rest), with the
/// CSRF cookie set, as Django's spa view does.
async fn spa(State(app): State<AppState>, req: Request) -> Response {
    let index: PathBuf = app.cfg.frontend_dist.join("index.html");
    match tokio::fs::read(index).await {
        Ok(html) => {
            let mut r = Response::new(Body::from(html));
            r.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static("text/html; charset=utf-8"));
            csrf::ensure_cookie(req.headers(), &mut r);
            r
        }
        Err(_) => (
            StatusCode::NOT_FOUND,
            "Frontend not built. Run `npm run build` in frontend/ or use the Vite dev server.",
        )
            .into_response(),
    }
}

/// An app on a temporary DATA_DIR with no pipeline thread: queued jobs go nowhere, so a test
/// sees exactly the state a handler left.
#[cfg(test)]
pub fn test_app(dir: &std::path::Path) -> AppState {
    let cfg = Config {
        host: "127.0.0.1".into(),
        port: 0,
        allowed_hosts: vec!["127.0.0.1".into()],
        trusted_origins: vec![],
        data_dir: dir.to_path_buf(),
        media_root: dir.join("media"),
        models_dir: dir.join("models"),
        frontend_dist: dir.join("dist"),
        max_upload_mb: 5,
        ollama_url: "http://127.0.0.1:9".into(), // nothing listens: LLM calls fail at once
    };
    Arc::new(App::new(cfg).expect("test app"))
}

/// A done meeting with two transcript lines and a summary, for tests.
#[cfg(test)]
pub fn test_meeting(app: &App, id: &str) {
    let db = app.db();
    db.execute(
        "INSERT INTO meetings (id, title, file, status, progress, summary, created, heartbeat) VALUES (?1, 'Sync', 'uploads/a.wav', 'done', 100, 'Old summary', ?2, ?2)",
        rusqlite::params![id, db::now_iso()],
    )
    .unwrap();
    for (start, speaker, text) in [(0.0, 0, "Hello Rohan, can you book the room?"), (4.0, 1, "Yes Asha, I will book it.")] {
        db.execute("INSERT INTO segments (meeting_id, start, end, speaker, text) VALUES (?1, ?2, ?3, ?4, ?5)", rusqlite::params![id, start, start + 3.0, speaker, text]).unwrap();
    }
}
