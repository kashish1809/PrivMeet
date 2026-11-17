//! privmeet-server: PrivMeet's backend in Rust (rust/migration).
//!
//! It answers the same /api/ as the Django backend, so the React app works unchanged, and
//! serves the built app itself. Configuration: config.rs (same env names as Django).

mod config;
mod csrf;
mod db;
mod hw;
mod settings;
mod web;

use std::net::SocketAddr;

#[tokio::main]
async fn main() {
    let cfg = config::Config::from_env();
    if let Err(e) = std::fs::create_dir_all(&cfg.data_dir) {
        eprintln!("privmeet-server: cannot create {}: {e}", cfg.data_dir.display());
        std::process::exit(1);
    }
    let addr: SocketAddr = match format!("{}:{}", cfg.host, cfg.port).parse() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("privmeet-server: bad HOST/PORT: {e}");
            std::process::exit(1);
        }
    };
    let app = web::router(cfg.clone());
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("privmeet-server: cannot listen on {addr}: {e}");
            std::process::exit(1);
        }
    };
    eprintln!("privmeet-server listening on http://{addr}");
    let shutdown = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    if let Err(e) = axum::serve(listener, app).with_graceful_shutdown(shutdown).await {
        eprintln!("privmeet-server: {e}");
        std::process::exit(1);
    }
}
