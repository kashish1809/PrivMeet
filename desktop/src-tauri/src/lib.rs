//! PrivMeet desktop shell.
//!
//! The window shows the bundled launcher page (`frontendDist` in
//! tauri.conf.json). The launcher drives the Docker stack through the commands
//! in [`backend`], then navigates to the app served on 127.0.0.1:8000.
//!
//! Only one copy runs at a time: `tauri-plugin-single-instance` hands a second
//! launch to the running window instead of letting it start a second stack.

mod backend;
mod media;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must come first: the plugin has to decide there is already a PrivMeet before the
        // rest of the app is set up, otherwise a second launch starts a second stack.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        // Opens the per-OS Docker install guides from the launcher's failure panel.
        .plugin(tauri_plugin_opener::init())
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
            backend::get_settings,
            backend::set_settings,
            backend::open_link,
        ])
        // The Record / Live screen needs the mic (and the camera, when it is on)
        // inside the window; media.rs grants that to 127.0.0.1:8000 only.
        .setup(|app| {
            media::install(app.handle());
            Ok(())
        })
        // Quitting stops the containers unless "keep running in background" is on.
        // `prevent_close` keeps the window up while `docker compose down` runs, so the
        // user sees the app still working instead of a window that vanishes mid-stop.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle().clone();
                if backend::keep_running(&app) {
                    return;
                }
                api.prevent_close();
                tauri::async_runtime::spawn(async move {
                    let _ = backend::stop_stack(&app, None).await;
                    app.exit(0);
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running PrivMeet");
}
