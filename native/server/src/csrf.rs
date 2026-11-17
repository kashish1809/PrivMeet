//! CSRF protection with Django's contract, which frontend/src/api.js relies on: a `csrftoken`
//! cookie set by GET /api/system/ (and the app page), sent back by the browser, and echoed by
//! api.js in the X-CSRFToken header on every unsafe request. A page on another site cannot
//! read the cookie, so it cannot forge the header.

use axum::{
    extract::{Request, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    middleware::Next,
    response::Response,
};

use crate::web::{error, AppState};

pub const COOKIE: &str = "csrftoken";

/// The csrftoken cookie's value, if the request carries one that looks like ours.
pub fn token_from(headers: &HeaderMap) -> Option<String> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|kv| kv.trim().split_once('='))
        .find(|(k, _)| *k == COOKIE)
        .map(|(_, v)| v.to_string())
        .filter(|v| (16..=128).contains(&v.len()) && v.chars().all(|c| c.is_ascii_alphanumeric()))
}

/// A new random token (32 hex characters from a v4 UUID's 122 random bits).
pub fn new_token() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

/// Set the cookie on `resp` unless the request already had one (Django's ensure_csrf_cookie).
pub fn ensure_cookie(req_headers: &HeaderMap, resp: &mut Response) {
    if token_from(req_headers).is_some() {
        return;
    }
    // Not HttpOnly: api.js reads it. SameSite=Lax keeps it off cross-site POSTs.
    let cookie = format!("{COOKIE}={}; Path=/; SameSite=Lax; Max-Age=31449600", new_token());
    if let Ok(v) = HeaderValue::from_str(&cookie) {
        resp.headers_mut().append(header::SET_COOKIE, v);
    }
}

/// Equal strings, in time that does not depend on where they first differ.
fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn safe(method: &Method) -> bool {
    matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS | Method::TRACE)
}

/// Middleware for /api/: unsafe methods need a matching X-CSRFToken, and an Origin, when
/// present, must be this server or a trusted one (CSRF_TRUSTED_ORIGINS, e.g. Vite's port).
pub async fn protect(State(cfg): State<AppState>, req: Request, next: Next) -> Response {
    if safe(req.method()) {
        return next.run(req).await;
    }
    let headers = req.headers();
    if let Some(origin) = headers.get(header::ORIGIN).and_then(|o| o.to_str().ok()) {
        let host = headers.get(header::HOST).and_then(|h| h.to_str().ok()).unwrap_or("");
        let own = origin == format!("http://{host}") || origin == format!("https://{host}");
        if !own && !cfg.trusted_origins.iter().any(|t| t == origin) {
            return error(StatusCode::FORBIDDEN, "CSRF check failed: the request came from another site.");
        }
    }
    let cookie = token_from(headers);
    let sent = headers.get("x-csrftoken").and_then(|v| v.to_str().ok());
    match (cookie, sent) {
        (Some(c), Some(s)) if same(c.as_bytes(), s.as_bytes()) => next.run(req).await,
        (None, _) => error(StatusCode::FORBIDDEN, "CSRF cookie not set. Reload the page."),
        _ => error(StatusCode::FORBIDDEN, "CSRF token missing or incorrect."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_cookie_among_others() {
        let mut h = HeaderMap::new();
        h.insert(header::COOKIE, HeaderValue::from_static("theme=nether; csrftoken=abcdef0123456789abcdef; x=1"));
        assert_eq!(token_from(&h).as_deref(), Some("abcdef0123456789abcdef"));
    }

    #[test]
    fn rejects_odd_cookie_values() {
        let mut h = HeaderMap::new();
        h.insert(header::COOKIE, HeaderValue::from_static("csrftoken=short"));
        assert_eq!(token_from(&h), None);
        h.insert(header::COOKIE, HeaderValue::from_static("csrftoken=has spaces in it ok?"));
        assert_eq!(token_from(&h), None);
    }

    #[test]
    fn tokens_are_new_and_well_formed() {
        let (a, b) = (new_token(), new_token());
        assert_ne!(a, b);
        assert_eq!(a.len(), 32);
        assert!(same(a.as_bytes(), a.as_bytes()) && !same(a.as_bytes(), b.as_bytes()));
    }
}
