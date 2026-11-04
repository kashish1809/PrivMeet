import { useSyncExternalStore } from "react";

// Whether the Record / Live screen is capturing right now. U1.3 calls setRecording;
// the sidebar reads it to show the red dot on every page.
let recording = false;
const listeners = new Set();

export function setRecording(on) {
  recording = !!on;
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const useRecording = () => useSyncExternalStore(subscribe, () => recording);
