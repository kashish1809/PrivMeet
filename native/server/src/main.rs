//! privmeet-server: PrivMeet's backend in Rust (rust/migration).
//!
//! It answers the same /api/ as the Django backend, so the React app works unchanged, and
//! serves the built app itself. Configuration: config.rs (same env names as Django).

mod api;
mod audio;
mod cli;
mod config;
mod csrf;
mod db;
mod diarize;
mod export;
mod hw;
mod llm;
mod meetings;
mod models;
mod names;
mod pipeline;
mod providers;
mod settings;
mod stt;
mod templates;
mod web;

use std::net::SocketAddr;

#[tokio::main]
async fn main() {
    let cfg = config::Config::from_env();
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Some(done) = cli::run(&args, &cfg) {
        match done {
            Ok(msg) => println!("{msg}"),
            Err(e) => {
                eprintln!("privmeet-server: {e}");
                std::process::exit(1);
            }
        }
        return;
    }
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
    let app = match web::App::new(cfg.clone()) {
        Ok(a) => web::router(a),
        Err(e) => {
            eprintln!("privmeet-server: {e}");
            std::process::exit(1);
        }
    };
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
