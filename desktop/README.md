# PrivMeet desktop app

Tauri 2 shell around the PrivMeet stack. It uses the system webview (WebKitGTK on
Linux, WebView2 on Windows), so installing it does not add a second browser engine
next to the Django UI.

## What exists now (A2.3)

- `src-tauri/tauri.conf.json` — product name PrivMeet, identifier `com.privmeet.app`,
  one 1280×820 window (min 900×580, centered), `frontendDist` is `../launcher`,
  bundle targets `appimage`, `deb`, `nsis`, `msi`, `withGlobalTauri` on so the plain
  JS launcher can call `invoke`.
- `src-tauri/src/backend.rs` — the commands the launcher drives:
  `check_docker`, `has_nvidia`, `start_backend`, `stop_backend`, `backend_status`,
  `backend_logs`, `get_settings`, `set_settings`, `open_link`.
- `src-tauri/src/lib.rs` — registers those, mounts the opener plugin, and stops the
  stack on window close unless "keep running in background" is set.
- `launcher/` — plain HTML/CSS/JS start-up page (no React, no bundler).
- `icons/` — generated from `app-icon.png` with `npx tauri icon app-icon.png`.
  Re-run that after changing the logo.

## Launcher flow

1. **Checking Docker.** `check_docker` reports installed / daemon running /
   compose v2 / client version. Anything missing turns the step red and shows
   per-OS instructions plus a link to the official install guide, opened by the
   Rust `open_link` command through `tauri-plugin-opener` (http and https only).
2. **Starting PrivMeet.** If `/api/system/` already answers, the running stack is
   reused. Otherwise `docker compose -p privmeet -f compose.yml [-f compose.gpu.yml]
   up -d` runs with the compose files copied out of the bundle into
   `<app data>/compose`, where a first-run `.env` with a generated `SECRET_KEY`
   is written for compose's `${SECRET_KEY:?…}`.
3. **Waiting for the server.** `/api/system/` is polled every 2 s for up to 15
   minutes, because the first start pulls the image. When it answers the window
   navigates to <http://127.0.0.1:8000>.

A failure shows the explanation, a Retry button and the `docker compose logs -f`
stream (`backend-log` events, last 400 lines kept in the page).

## Settings

`<app data>/launcher-settings.json` holds the launcher's own settings:

```json
{ "keep_running": false }
```

`keep_running: false` means quitting runs `docker compose down` first (volumes are
kept). `true` leaves the containers running so the next launch reaches step 2 with
the stack already up. The file is read on window close, so the choice survives a
crash of the webview.

## Prerequisites

- Rust with rustup (`rustup.rs`) and a C linker.
- Linux: `webkit2gtk-4.1`, `gtk3`, `librsvg` (dev packages), plus the usual
  `base-devel` / `build-essential`.
- Windows: WebView2 runtime (bundled by the installer) and the MSVC build tools.
- Docker with the compose v2 plugin for the app to actually start the stack.
- Node 20+ to run the Tauri CLI.

## Run

```bash
cd desktop
npm install
npm run dev      # opens the launcher window
npm run build    # installers land in src-tauri/target/release/bundle/
```

The window loads `launcher/index.html` directly, so no web server is needed and
the app never bundles a second copy of the React UI.

To test the launcher page alone, without Rust, open `launcher/index.html` in a
browser: it detects the missing Tauri globals and says so instead of pretending to
start anything.

## Decisions

- **Identifier `com.privmeet.app`.** Used by the AppImage/deb/NSIS/MSI bundlers and
  stored per user, so changing it later strands existing settings. AGENTS.md asks
  for it to be agreed with Vinayak; confirm before the first release.
- **No `devUrl`.** The launcher is static. `frontendDist` pointing at a folder with
  no dev server keeps `tauri dev` and `tauri build` on the same code path.
- **`withGlobalTauri`.** The launcher is plain JS, so it needs the injected
  `window.__TAURI__` to call `invoke`/`listen`; there is no bundler to import the
  npm API from.
- **Opener is Rust-side only.** `open_link` validates http(s) and calls the plugin
  from Rust, so `capabilities/default.json` keeps just `core:default` and the page
  cannot ask the plugin for anything else.

## Verified

- `cargo build` (dev) and `cargo build --release` both finish with no warnings on
  Rust 1.99.1, GTK3 + webkit2gtk-4.1 2.54.2.
- The launcher page was rendered in Chromium with a stubbed `window.__TAURI__` for
  the three states: Docker missing, Docker stopped, and a failing
  `start_backend` with streamed logs. Each shows the right step, panel and links.

## Not verified here

- A real cold start: this machine has no Docker, so `start_backend`,
  `backend_logs` and the `/api/system/` poll have never run against containers.
- Quit behaviour: closing the window with `keep_running` on and off needs the
  containers to compare, and the window manager to close the app.
