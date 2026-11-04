//! PrivMeet desktop shell.
//!
//! The window shows the bundled launcher page (`frontendDist` in
//! tauri.conf.json). The launcher drives the Docker stack through the commands
//! in [`backend`], then navigates to the app served on 127.0.0.1:8000.

mod backend;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Holds the running `docker compose logs -f` child so a retry replaces it.
        .manage(backend::Logs::default())
        // Backend-manager commands, called from the launcher with invoke(...).
        .invoke_handler(tauri::generate_handler![
            backend::check_docker,
            backend::has_nvidia,
            backend::start_backend,
            backend::stop_backend,
            backend::backend_status,
            backend::backend_logs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PrivMeet");
}
