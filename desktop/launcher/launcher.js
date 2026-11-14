/*
 * Launcher flow: check Docker, start the stack, wait for /api/system/, then hand the
 * window to the app. Plain JS on purpose — no bundler, no React.
 *
 * The Rust side is desktop/src-tauri/src/backend.rs. Every call below is a Tauri
 * command from that module, and the log pane listens for its "backend-log" events.
 */

const APP_URL = "http://127.0.0.1:8000";
const POLL_MS = 2000;
const FIRST_RUN_MS = 15 * 60 * 1000; // pulling the image plus model downloads on a slow line

const tauri = window.__TAURI__ || {};
const invoke = tauri.core?.invoke;
const listen = tauri.event?.listen;

const el = {
  status: document.getElementById("status"),
  statusText: document.getElementById("status-text"),
  steps: Array.from(document.querySelectorAll("#steps li")),
  panel: document.getElementById("panel"),
  panelTitle: document.getElementById("panel-title"),
  panelText: document.getElementById("panel-text"),
  panelList: document.getElementById("panel-list"),
  docs: document.getElementById("docs"),
  retry: document.getElementById("retry"),
  toggleLogs: document.getElementById("toggle-logs"),
  logs: document.getElementById("logs"),
  keepRunning: document.getElementById("keep-running"),
  about: document.getElementById("about"),
  aboutDialog: document.getElementById("about-dialog"),
  aboutVersion: document.getElementById("about-version"),
  aboutAuthors: document.getElementById("about-authors"),
  aboutLicense: document.getElementById("about-license"),
  aboutHome: document.getElementById("about-home"),
  aboutClose: document.getElementById("about-close"),
  version: document.getElementById("version"),
};

let logLines = [];
let logStreamStarted = false;
let docsUrl = "";
let running = false; // guards against a second Retry while a start is in flight
let currentStep = ""; // the step in flight, so a thrown error can mark the right one failed

/** "busy" | "done" | "error" — drives the spinner and the colours in launcher.css. */
function setStatus(text, state = "busy") {
  el.statusText.textContent = text;
  el.status.classList.remove("done", "error");
  if (state !== "busy") el.status.classList.add(state);
}

/** Mark one step active, done or failed; every other step keeps its own state. */
function setStep(name, state) {
  for (const item of el.steps) {
    if (item.dataset.step !== name) continue;
    item.classList.remove("active", "done", "failed");
    if (state && state !== "idle") item.classList.add(state);
    if (state === "active") {
      item.setAttribute("aria-current", "step");
      currentStep = name;
    }
    else item.removeAttribute("aria-current");
  }
}

function resetSteps() {
  for (const item of el.steps) item.classList.remove("active", "done", "failed");
  for (const item of el.steps) item.removeAttribute("aria-current");
}

function appendLog(line) {
  logLines.push(line);
  if (logLines.length > 400) logLines = logLines.slice(-400);
  el.logs.textContent = logLines.join("\n");
  el.logs.scrollTop = el.logs.scrollHeight;
}

function showLogs(show) {
  el.logs.hidden = !show;
  el.toggleLogs.setAttribute("aria-expanded", String(show));
  el.toggleLogs.textContent = show ? "Hide logs" : "Show logs";
}

function hidePanel() {
  el.panel.hidden = true;
  el.retry.hidden = true;
}

function fail({ title, text, items = [], docs = "", logs = false }) {
  // Docker problems are not in the container logs; start-up problems are.
  if (logs) showLogs(true);
  el.panel.hidden = false;
  el.panel.setAttribute("tabindex", "-1");
  el.panel.focus();
  // The status line already carries the headline; the panel heading stays "What to do".
  el.panelText.textContent = text;
  el.panelList.replaceChildren(
    ...items.map((item) => {
      const li = document.createElement("li");
      // Items mix plain text with a <code> hint; textContent keeps this injection-free.
      li.textContent = item;
      return li;
    }),
  );
  docsUrl = docs;
  el.docs.hidden = !docs;
  el.retry.hidden = false;
  setStatus(title, "error");
}

function isWindows() {
  return /windows/i.test(navigator.userAgent);
}

function isMac() {
  return /mac os|macintosh/i.test(navigator.userAgent);
}

function dockerHelp(kind) {
  if (kind === "missing") {
    if (isWindows()) {
      return {
        title: "Docker Desktop is not installed",
        text: "PrivMeet runs its stack in Docker. Install Docker Desktop, start it, then press Retry.",
        items: ["winget install -e --id Docker.DockerDesktop", "Start Docker Desktop from the Start menu"],
        docs: "https://docs.docker.com/desktop/setup/install/windows-install/",
      };
    }
    if (isMac()) {
      return {
        title: "Docker is not installed",
        text: "PrivMeet runs its stack in Docker. Install Docker Desktop, start it, then press Retry.",
        items: ["brew install --cask docker", "Open Docker from Applications"],
        docs: "https://docs.docker.com/desktop/setup/install/mac-install/",
      };
    }
    return {
      title: "Docker is not installed",
      text: "PrivMeet runs its stack in Docker. Install it with your package manager, then press Retry.",
      items: [
        "Arch / CachyOS: sudo pacman -S docker docker-compose",
        "Debian / Ubuntu: sudo apt install docker.io docker-compose-v2",
        "Fedora: sudo dnf install docker docker-compose",
      ],
      docs: "https://docs.docker.com/engine/install/",
    };
  }
  if (kind === "stopped") {
    return {
      title: "Docker is installed but not running",
      text: "Start the Docker service, wait for it to report ready, then press Retry.",
      items: isWindows() || isMac()
        ? ["Open Docker Desktop and wait until it says it is running"]
        : ["sudo systemctl start docker", "Check with: docker info"],
      docs: "https://docs.docker.com/engine/daemon/start/",
    };
  }
  return {
    title: "Docker Compose v2 is missing",
    text: "The launcher starts the stack with `docker compose`, which ships with current Docker releases.",
    items: [
      "Update Docker, or install the compose plugin for your distribution",
      "Check with: docker compose version",
    ],
    docs: "https://docs.docker.com/compose/install/",
  };
}

/** Wait until /api/system/ answers, printing how long it has been trying. */
async function waitForServer(deadline) {
  const started = Date.now();
  for (;;) {
    const status = await invoke("backend_status");
    if (status.running) return true;
    if (Date.now() > deadline) return false;
    const seconds = Math.round((Date.now() - started) / 1000);
    setStatus(`Waiting for the server on 127.0.0.1:8000 · ${seconds}s`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

async function startLogStream() {
  if (logStreamStarted) return;
  logStreamStarted = true;
  try {
    await listen("backend-log", (event) => appendLog(String(event.payload)));
    await listen("backend-log-end", () => appendLog("-- log stream closed --"));
    await invoke("backend_logs");
  } catch (err) {
    appendLog(`Could not read the container logs: ${err}`);
  }
}

async function run() {
  if (running) return;
  if (!invoke) {
    fail({
      title: "Open PrivMeet from the app window",
      text: "This page drives the Docker stack, so it only works inside the desktop app.",
    });
    return;
  }
  running = true;
  el.retry.disabled = true;
  hidePanel();
  resetSteps();
  showLogs(false);
  appendLog("");
  setStatus("Checking Docker…");
  setStep("docker", "active");

  try {
    const docker = await invoke("check_docker");
    if (!docker.installed) {
      setStep("docker", "failed");
      fail(dockerHelp("missing"));
      return;
    }
    if (!docker.running) {
      setStep("docker", "failed");
      fail(dockerHelp("stopped"));
      return;
    }
    if (!docker.compose) {
      setStep("docker", "failed");
      fail(dockerHelp("compose"));
      return;
    }
    appendLog(`Docker: ${docker.version || "running"}`);
    setStep("docker", "done");
    setStep("start", "active");

    // Someone may have left the stack up ("keep running"): reuse it instead of restarting.
    const already = await invoke("backend_status");
    if (!already.running) {
      setStatus("Starting PrivMeet (first run downloads about 2 GB)…");
      await startLogStream();
      const output = await invoke("start_backend");
      if (output) appendLog(output);
    }
    setStep("start", "done");
    setStep("wait", "active");
    setStatus("Waiting for the server on 127.0.0.1:8000…");

    const ready = await waitForServer(Date.now() + FIRST_RUN_MS);
    if (!ready) {
      setStep("wait", "failed");
      fail({
        title: "The server did not answer",
        text: "The containers are up but the app never reached /api/system/. The logs below are from docker compose.",
        items: ["Check the log pane for a failed service", "Press Retry, or run docker compose logs -f in the app data folder"],
        logs: true,
      });
      return;
    }

    setStep("wait", "done");
    setStatus("Opening PrivMeet…", "done");
    window.location.replace(APP_URL);
  } catch (err) {
    if (currentStep) setStep(currentStep, "failed");
    setStatus("PrivMeet could not start", "error");
    await startLogStream();
    fail({
      title: "PrivMeet could not start",
      text: String(err && err.message ? err.message : err),
      items: ["The log pane has the last lines from docker compose", "Press Retry after fixing the cause"],
      logs: true,
    });
  } finally {
    running = false;
    el.retry.disabled = false;
  }
}

// --- keep running in background ------------------------------------------------

async function loadSetting() {
  if (!invoke) return;
  try {
    const settings = await invoke("get_settings");
    el.keepRunning.checked = !!settings.keep_running;
  } catch (err) {
    appendLog(`Could not read the settings: ${err}`);
  }
}

async function saveSetting() {
  if (!invoke) return;
  try {
    await invoke("set_settings", { settings: { keep_running: el.keepRunning.checked } });
  } catch (err) {
    appendLog(`Could not save the setting: ${err}`);
  }
}

// --- about ----------------------------------------------------------------------

let homepage = "";

async function loadAppInfo() {
  if (!invoke) return; // opened outside the app window: the footer keeps its plain label
  try {
    const info = await invoke("app_info");
    homepage = info.homepage || "";
    el.version.textContent = `v${info.version}`;
    el.aboutVersion.textContent = `Version ${info.version}`;
    el.aboutAuthors.textContent = `By ${info.authors}`;
    el.aboutLicense.textContent = `${info.license} licensed · self-hosted, no account`;
  } catch (err) {
    appendLog(`Could not read the app version: ${err}`);
  }
}

// --- wiring ---------------------------------------------------------------------

el.retry.addEventListener("click", run);
el.toggleLogs.addEventListener("click", () => showLogs(el.logs.hidden));
el.keepRunning.addEventListener("change", saveSetting);
el.docs.addEventListener("click", async () => {
  if (!docsUrl || !invoke) return;
  try {
    await invoke("open_link", { url: docsUrl });
  } catch (err) {
    appendLog(`Could not open the browser: ${err}`);
  }
});

el.about.addEventListener("click", () => el.aboutDialog.showModal());
el.aboutClose.addEventListener("click", () => el.aboutDialog.close());
el.aboutHome.addEventListener("click", async () => {
  if (!homepage || !invoke) return;
  try {
    await invoke("open_link", { url: homepage });
  } catch (err) {
    appendLog(`Could not open the project page: ${err}`);
  }
});

loadAppInfo();
loadSetting();
run();
