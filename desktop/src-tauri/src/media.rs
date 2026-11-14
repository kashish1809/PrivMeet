//! Microphone and camera access for the PrivMeet page inside the app window.
//!
//! The window shows the bundled launcher first and then navigates to
//! `http://127.0.0.1:8000`, which is a *remote* URL as far as the webview is
//! concerned: by default neither WebKitGTK nor WebView2 hands a remote page the
//! microphone or the camera. The Record / Live screen (U1.3) calls
//! `getUserMedia` for the mic and an optional camera preview, so the shell has
//! to answer those permission requests itself.
//!
//! What this module allows, and nothing else: microphone and camera for the page
//! on `127.0.0.1:8000`. Any other origin, including the bundled launcher and any
//! site the window is ever pointed at, keeps the default answer (deny). Clipboard,
//! notifications, geolocation and the rest are never touched.

use tauri::{AppHandle, Manager, WebviewWindow};

/// The only origin allowed to open the microphone or camera: the app the launcher
/// starts on this machine. Plain HTTP on the loopback address, so a page on any
/// other host, or the same host on another port, is refused.
pub const ALLOWED_ORIGIN: &str = "http://127.0.0.1:8000";

/// Wire up media capture on the main window. Called once from `setup`.
pub fn install(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return; // no window yet: nothing to grant, and nothing to log about
    };
    grant(&window);
}

#[cfg(target_os = "linux")]
fn grant(window: &WebviewWindow) {
    use webkit2gtk::glib::ObjectExt;
    use webkit2gtk::{
        DeviceInfoPermissionRequest, PermissionRequestExt, SettingsExt, UserMediaPermissionRequest,
        WebViewExt,
    };

    let done = window.with_webview(|webview| {
        let view = webview.inner();

        // `enable-media-stream` is what makes getUserMedia exist at all, and
        // `webrtc` covers the peer-connection path a future live mode would use.
        // The user-gesture switch lets playback start from the Record button
        // instead of a raw click on an <audio> element.
        if let Some(settings) = WebViewExt::settings(&view) {
            settings.set_enable_media_stream(true);
            settings.set_enable_mediasource(true);
            settings.set_enable_webrtc(true);
            settings.set_media_playback_requires_user_gesture(false);
        }

        view.connect_permission_request(|view, request| {
            let from_app = view
                .uri()
                .map(|uri| uri.starts_with(ALLOWED_ORIGIN))
                .unwrap_or(false);
            // enumerateDevices() asks for the device list, getUserMedia() for the device.
            let wants_media = request.is::<UserMediaPermissionRequest>()
                || request.is::<DeviceInfoPermissionRequest>();
            if from_app && wants_media {
                request.allow();
                return true; // handled: WebKitGTK shows no dialog
            }
            false // everything else keeps WebKitGTK's own answer
        });
    });

    if let Err(err) = done {
        // Not fatal: the app still runs, the recorder just has no microphone.
        eprintln!("PrivMeet: could not enable media capture: {err}");
    }
}

#[cfg(not(target_os = "linux"))]
fn grant(_window: &WebviewWindow) {
    // Windows is handled in the next commit; macOS is not a target for the app yet.
}
