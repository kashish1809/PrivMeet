# PrivMeet desktop app

Tauri 2 shell around the PrivMeet stack. It uses the system webview (WebKitGTK on
Linux, WebView2 on Windows), so installing it does not add a second browser engine
next to the Django UI.

## What exists now (A2.1)

- `src-tauri/tauri.conf.json` — product name PrivMeet, identifier `com.privmeet.app`,
  one 1280×820 window (min 900×580, centered), `frontendDist` is `../launcher`,
  bundle targets `appimage`, `deb`, `nsis`, `msi`.
- `src-tauri/` — Rust crate `privmeet` with an empty `Builder::default()` run loop.
  A2.2 adds the Docker/backend commands here.
- `launcher/` — plain HTML/CSS/JS start-up page (no React, no bundler). A2.3 adds
  the real flow and navigates the window to `http://127.0.0.1:8000`.
- `icons/` — generated from `app-icon.png` with `npx tauri icon app-icon.png`.
  Re-run that after changing the logo.

## Prerequisites

- Rust with rustup (`rustup.rs`) and a C linker.
- Linux: `webkit2gtk-4.1`, `gtk3`, `librsvg` (dev packages), plus the usual
  `base-devel` / `build-essential`.
- Windows: WebView2 runtime (bundled by the installer) and the MSVC build tools.
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

## Decisions

- **Identifier `com.privmeet.app`.** Used by the AppImage/deb/NSIS/MSI bundlers and
  stored per user, so changing it later strands existing settings. AGENTS.md asks
  for it to be agreed with Vinayak; confirm before the first release.
- **No `devUrl`.** The launcher is static. `frontendDist` pointing at a folder with
  no dev server keeps `tauri dev` and `tauri build` on the same code path.

## Not verified here

`tauri dev` has not been run: this machine has no `rustc`/`cargo` (`npx tauri info`
reports Rust missing, webkit2gtk-4.1 2.54.2 present). Install rustup, then
`npm run dev` in this folder, to see the launcher window.
