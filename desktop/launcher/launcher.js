/*
 * Launcher state. Plain JS, no bundler and no Tauri imports yet: A2.2 adds the
 * backend commands (check_docker, start_backend, backend_status, ...) and A2.3
 * drives these helpers from the real start-up flow, then navigates the window to
 * http://127.0.0.1:8000 once /api/system/ answers.
 *
 * Until then the page shows the first step as active so a `tauri dev` run opens
 * something real instead of a blank window.
 */

const statusLine = document.getElementById("status");
const statusText = document.getElementById("status-text");
const stepItems = Array.from(document.querySelectorAll("#steps li"));

/** "busy" | "done" | "error" — controls the spinner and the colour. */
function setStatus(text, state = "busy") {
  statusText.textContent = text;
  statusLine.classList.remove("done", "error");
  if (state !== "busy") statusLine.classList.add(state);
}

/** Mark one step: active, done or failed. Pass "active" one step at a time. */
function setStep(name, state) {
  for (const item of stepItems) {
    if (item.dataset.step !== name) continue;
    item.classList.remove("active", "done", "failed");
    if (state !== "idle") item.classList.add(state);
  }
}

// Exposed for A2.3, which will call these from its flow code.
window.privmeetLauncher = { setStatus, setStep, steps: stepItems.map((el) => el.dataset.step) };

setStep("docker", "active");
