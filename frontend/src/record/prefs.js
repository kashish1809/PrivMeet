/**
 * Recording defaults kept in this browser. Settings → Recording (U1.5) writes the same keys,
 * so it only needs to import KEYS and writePref.
 */
export const KEYS = {
  mic: "record.mic", // deviceId of the preferred microphone, "" = browser default
  systemAudio: "record.systemAudio", // "1" = ask for tab/system audio when sharing
  camera: "record.camera", // "1" = camera on when the recorder opens
};

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
  };
}

export function writePref(key, value) {
  try {
    localStorage.setItem(key, typeof value === "boolean" ? (value ? "1" : "0") : String(value));
  } catch {
    // not fatal: the choice still applies to this session
  }
}
