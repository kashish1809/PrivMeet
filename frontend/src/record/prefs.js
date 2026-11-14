/**
 * Recording defaults kept in this browser. Settings → Recording (U1.5) writes the same keys,
 * so it only needs to import KEYS and writePref.
 */
export const KEYS = {
  mic: "record.mic", // deviceId of the preferred microphone, "" = browser default
  systemAudio: "record.systemAudio", // "1" = ask for tab/system audio when sharing
  camera: "record.camera", // "1" = camera on when the recorder opens
  titleFormat: "record.titleFormat", // one of TITLE_FORMATS' ids
};

/** Default titles for a new recording; {date} {time} {weekday} are filled in. Settings -> General. */
export const TITLE_FORMATS = [
  { id: "recording", label: "Recording Oct 28, 2026, 10:00 AM", pattern: "Recording {date}, {time}" },
  { id: "meeting", label: "Meeting Oct 28, 2026", pattern: "Meeting {date}" },
  { id: "weekday", label: "Tuesday meeting, 10:00 AM", pattern: "{weekday} meeting, {time}" },
  { id: "plain", label: "Oct 28, 2026 10:00 AM", pattern: "{date} {time}" },
];

export function formatTitle(id, now = new Date()) {
  const pattern = (TITLE_FORMATS.find((f) => f.id === id) || TITLE_FORMATS[0]).pattern;
  return pattern
    .replace("{date}", now.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }))
    .replace("{time}", now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }))
    .replace("{weekday}", now.toLocaleDateString(undefined, { weekday: "long" }));
}

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // private window or blocked storage: fall back to the defaults
  }
}

export function readPrefs() {
  return {
    mic: read(KEYS.mic) || "",
    systemAudio: read(KEYS.systemAudio) !== "0", // on unless switched off: it is how online meetings get recorded
    camera: read(KEYS.camera) === "1",
    titleFormat: read(KEYS.titleFormat) || "recording",
  };
}

export function writePref(key, value) {
  try {
    localStorage.setItem(key, typeof value === "boolean" ? (value ? "1" : "0") : String(value));
  } catch {
    // not fatal: the choice still applies to this session
  }
}
