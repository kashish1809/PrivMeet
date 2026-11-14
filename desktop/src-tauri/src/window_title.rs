//! Keep the window title in step with the page.
//!
//! Neither WebKitGTK nor WebView2 renames the host window when the page changes its
//! `<title>`, so the window would say "PrivMeet" from launch to quit while the launcher
//! shows "Waiting for the server" and the app shows a meeting. This module watches the
//! document title and copies it onto the window.
//!
//! Which titles appear is the pages' business: the launcher sets its own per step, and the
//! React app sets `<title>` in `frontend/index.html` (Vinayak's files). An empty title is
//! ignored so a page that clears it cannot leave the window nameless.

use tauri::{AppHandle, Manager, WebviewWindow};

/// Prefix used when a page leaves the title empty or unset.
pub const FALLBACK: &str = "PrivMeet";

/// Wire up the title mirror on the main window. Called once from `setup`.
pub fn install(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    mirror(&window);
}

/// The window title for a document title: trimmed, or the fallback when there is nothing.
fn window_title(document_title: &str) -> &str {
    let trimmed = document_title.trim();
    if trimmed.is_empty() {
        FALLBACK
    } else {
        trimmed
    }
}

#[cfg(target_os = "linux")]
fn mirror(window: &WebviewWindow) {
    use webkit2gtk::WebViewExt;

    let target = window.clone();
    let done = window.with_webview(move |webview| {
        let view = webview.inner();
        let copy = move |view: &webkit2gtk::WebView| {
            let title = view.title().map(|t| t.to_string()).unwrap_or_default();
            let _ = target.set_title(window_title(&title));
        };
        copy(&view); // the launcher's own title, before anything changes it
        view.connect_title_notify(copy);
    });

    if let Err(err) = done {
        // Not fatal: the window just keeps its configured title.
        eprintln!("PrivMeet: could not follow the page title: {err}");
    }
}

#[cfg(windows)]
fn mirror(window: &WebviewWindow) {
    use webview2_com::DocumentTitleChangedEventHandler;

    let target = window.clone();
    let done = window.with_webview(move |webview| {
        let controller = webview.controller();
        let Ok(core) = (unsafe { controller.CoreWebView2() }) else {
            return;
        };

        let first = target.clone();
        apply(&core, &first);

        let handler_target = target.clone();
        let handler = DocumentTitleChangedEventHandler::create(Box::new(move |sender, _args| {
            if let Some(sender) = sender {
                apply(&sender, &handler_target);
            }
            Ok(())
        }));

        let mut token = 0;
        // The handler lives as long as the webview, so the token is not kept.
        let _ = unsafe { core.add_DocumentTitleChanged(&handler, &mut token) };
    });

    if let Err(err) = done {
        eprintln!("PrivMeet: could not follow the page title: {err}");
    }
}

/// Copy the webview's document title onto the window, if it has one.
#[cfg(windows)]
fn apply(
    core: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2,
    target: &WebviewWindow,
) {
    use windows::core::PWSTR;

    let mut raw = PWSTR::null();
    if unsafe { core.DocumentTitle(&mut raw) }.is_err() {
        return;
    }
    let title = unsafe { raw.to_string() }.unwrap_or_default();
    let _ = target.set_title(window_title(&title));
}

#[cfg(not(any(target_os = "linux", windows)))]
fn mirror(_window: &WebviewWindow) {
    // macOS is not a target of the desktop app yet.
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_a_real_title() {
        assert_eq!(window_title("PrivMeet — Waiting for the server"), "PrivMeet — Waiting for the server");
        assert_eq!(window_title("  Meeting: Project Sync  "), "Meeting: Project Sync");
    }

    #[test]
    fn falls_back_when_the_page_clears_it() {
        assert_eq!(window_title(""), FALLBACK);
        assert_eq!(window_title("   "), FALLBACK);
    }
}
