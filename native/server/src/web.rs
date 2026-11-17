//! HTTP layer: the router, the Host check, the built React app and the JSON error shape.

use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Request, State},
    http::{header, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde_json::json;
use tower_http::services::ServeDir;

use crate::config::Config;

pub type AppState = Arc<Config>;

/// The error body every endpoint uses, as Django's bad(): {"error": "..."}; api.js shows it.
pub fn error(status: StatusCode, msg: impl Into<String>) -> Response {
    (status, Json(json!({ "error": msg.into() }))).into_response()
}

pub fn router(cfg: Config) -> Router {
    let state: AppState = Arc::new(cfg);
    let api = Router::new().fallback(|| async { error(StatusCode::NOT_FOUND, "Not found.") });
    Router::new()
        .nest("/api", api)
        .nest_service("/static", ServeDir::new(&state.frontend_dist))
        .fallback(get(spa))
        .layer(middleware::from_fn_with_state(state.clone(), allowed_host))
        .with_state(state)
}

/// Refuse requests whose Host is not ours (Django's ALLOWED_HOSTS): a web page on another
/// site could otherwise reach this unauthenticated server through DNS rebinding.
async fn allowed_host(State(cfg): State<AppState>, req: Request, next: Next) -> Response {
    let host = req
        .headers()
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .map(|h| h.rsplit_once(':').map_or(h, |(name, port)| if port.chars().all(|c| c.is_ascii_digit()) { name } else { h }))
        .unwrap_or("");
    if !cfg.allowed_hosts.iter().any(|a| a.eq_ignore_ascii_case(host)) {
        return error(StatusCode::BAD_REQUEST, "Invalid Host header.");
    }
    next.run(req).await
}

/// Every non-API path gets the React app's index.html (hash routing does the rest).
async fn spa(State(cfg): State<AppState>) -> Response {
    match tokio::fs::read(cfg.frontend_dist.join("index.html")).await {
        Ok(html) => {
            let mut r = Response::new(Body::from(html));
            r.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static("text/html; charset=utf-8"));
            r
        }
        Err(_) => (
            StatusCode::NOT_FOUND,
            "Frontend not built. Run `npm run build` in frontend/ or use the Vite dev server.",
        )
            .into_response(),
    }
}
