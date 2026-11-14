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

/// Whether a page URL is the PrivMeet app on this machine. Compared by origin, not by
/// prefix: `http://127.0.0.1:8000.example.com/` and `http://127.0.0.1:80001/` are both
/// different origins and both have to come out false.
pub fn is_app_origin(url: &str) -> bool {
    match url.strip_prefix(ALLOWED_ORIGIN) {
        Some(rest) => {
            rest.is_empty()
                || rest.starts_with('/')
                || rest.starts_with('?')
                || rest.starts_with('#')
        }
        None => false,
    }
}

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
            let from_app = view.uri().map(|uri| is_app_origin(&uri)).unwrap_or(false);
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

#[cfg(windows)]
fn grant(window: &WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2PermissionRequestedEventArgs, COREWEBVIEW2_PERMISSION_KIND_CAMERA,
        COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, COREWEBVIEW2_PERMISSION_KIND_UNKNOWN_PERMISSION,
        COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    };
    use webview2_com::PermissionRequestedEventHandler;
    use windows::core::PWSTR;

    let done = window.with_webview(|webview| {
        let controller = webview.controller();
        let Ok(core) = (unsafe { controller.CoreWebView2() }) else {
            return;
        };

        // WebView2 asks once per request; Allow is the same answer as pressing
        // "Allow" in Edge's own prompt. Microphone and camera only, app origin only.
        let handler = PermissionRequestedEventHandler::create(Box::new(
            |_sender, args: Option<ICoreWebView2PermissionRequestedEventArgs>| {
                let Some(args) = args else { return Ok(()) };

                let mut kind = COREWEBVIEW2_PERMISSION_KIND_UNKNOWN_PERMISSION;
                unsafe { args.PermissionKind(&mut kind)? };
                if kind != COREWEBVIEW2_PERMISSION_KIND_MICROPHONE
                    && kind != COREWEBVIEW2_PERMISSION_KIND_CAMERA
                {
                    return Ok(());
                }

                let mut raw = PWSTR::null();
                unsafe { args.Uri(&mut raw)? };
                let uri = unsafe { raw.to_string() }?;
                if is_app_origin(&uri) {
                    unsafe { args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)? };
                }
                Ok(())
            },
        ));

        let mut token = 0;
        // The handler lives as long as the webview, so the token is not kept.
        let _ = unsafe { core.add_PermissionRequested(&handler, &mut token) };
    });

    if let Err(err) = done {
        eprintln!("PrivMeet: could not enable media capture: {err}");
    }
}

#[cfg(not(any(target_os = "linux", windows)))]
fn grant(_window: &WebviewWindow) {
    // macOS is not a target for the desktop app yet; the web UI falls back to
    // mic-only recording when the browser asks and gets no device.
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_the_app_and_its_pages() {
        assert!(is_app_origin("http://127.0.0.1:8000"));
        assert!(is_app_origin("http://127.0.0.1:8000/"));
        assert!(is_app_origin("http://127.0.0.1:8000/#/m/42?t=90"));
        assert!(is_app_origin("http://127.0.0.1:8000/api/system/"));
    }

    #[test]
    fn rejects_the_launcher_and_other_hosts() {
        assert!(!is_app_origin("tauri://localhost/index.html"));
        assert!(!is_app_origin("https://127.0.0.1:8000/"));
        assert!(!is_app_origin("http://localhost:8000/"));
        assert!(!is_app_origin("http://127.0.0.1:8001/"));
        assert!(!is_app_origin("http://192.168.1.10:8000/"));
        assert!(!is_app_origin("http://example.com/"));
        assert!(!is_app_origin(""));
    }

    #[test]
    fn rejects_lookalike_hosts_and_ports() {
        assert!(!is_app_origin("http://127.0.0.1:8000.example.com/"));
        assert!(!is_app_origin("http://127.0.0.1:80000/"));
        assert!(!is_app_origin("http://127.0.0.1:8000@evil.example/"));
    }
}
