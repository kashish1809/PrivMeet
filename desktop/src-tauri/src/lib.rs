//! PrivMeet desktop shell.
//!
//! At this stage the window only shows the bundled launcher page, which is
//! `frontendDist` in tauri.conf.json. A2.2 adds the Docker/backend commands
//! and A2.3 the launcher flow that navigates the window to the local app.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running PrivMeet");
}
