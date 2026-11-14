/**
 * The recorder lives here, outside React, so a recording keeps running when the user opens
 * another page (the sidebar shows the red dot through layout/recording.js) and is still there
 * when they come back to #/record.
 *
 * State is one plain object replaced on every change; pages read it with useRecordSession().
 */
import { useSyncExternalStore } from "react";

import { upload } from "../api";
import { setRecording } from "../layout/recording";
import { createMixer } from "./mixer";
import { KEYS, readPrefs, writePref } from "./prefs";

// What we ask MediaRecorder for, best first. WebKitGTK and Safari only do MP4.
const AUDIO_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
const VIDEO_TYPES = ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];

function pickType(types) {
  if (typeof MediaRecorder === "undefined") return null;
  return types.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? "";
}

/** File extension the backend accepts for a recorder MIME type. */
export function extensionFor(type, video) {
  if (type.startsWith("audio/ogg")) return ".ogg";
  if (type.includes("mp4")) return video ? ".mp4" : ".m4a";
  return ".webm";
}

function defaultTitle(now = new Date()) {
  const date = now.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const time = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `Recording ${date}, ${time}`;
}

function initial() {
  const prefs = readPrefs();
  return {
    // idle -> recording <-> paused -> stopped -> uploading -> (navigates away) ; stopped also on upload error
    phase: "idle",
    elapsed: 0, // ms recorded, pauses excluded
    startedAt: null, // Date of the first Start, for the header
    mic: { status: "off", error: "", deviceId: prefs.mic, devices: [] }, // off | asking | on | error
    muted: false,
    camera: { on: false, stream: null, error: "", wanted: prefs.camera },
    share: { stream: null, hasAudio: false, error: "", supported: !!navigator.mediaDevices?.getDisplayMedia },
    systemAudio: prefs.systemAudio,
    videoRecorded: false, // decided at Start: camera on then = a video file
    blob: null, // the finished recording, kept until the upload succeeds
    progress: 0,
    uploadError: "",
    title: defaultTitle(),
    notes: "",
    tags: [],
    supported: typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia,
  };
}

let state = initial();
const listeners = new Set();

function set(patch) {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  setRecording(state.phase === "recording" || state.phase === "paused");
  listeners.forEach((fn) => fn());
}

export function useRecordSession() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
}

// Resources that are not state: the audio graph, raw streams, the recorder and its chunks.
let mixer = null;
let micStream = null;
let recorder = null;
let chunks = [];
let tick = null;
let runStart = 0; // performance.now() when the current recording run (not paused) began
let banked = 0; // ms recorded in earlier runs

export function getMixer() {
  if (!mixer) mixer = createMixer();
  return mixer;
}

const stopTracks = (stream) => stream?.getTracks().forEach((t) => t.stop());

function mediaError(e, what) {
  if (e?.name === "NotAllowedError" || e?.name === "SecurityError")
    return `${what} access was blocked. Allow it for this site in the browser's address bar, then try again.`;
  if (e?.name === "NotFoundError" || e?.name === "OverconstrainedError") return `No ${what.toLowerCase()} was found.`;
  if (e?.name === "NotReadableError") return `The ${what.toLowerCase()} is in use by another app.`;
  return `${what} could not start: ${e?.message || e}`;
}

async function listDevices() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    const mics = all
      .filter((d) => d.kind === "audioinput")
      .map((d, i) => ({ value: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
    set((s) => ({ mic: { ...s.mic, devices: mics } }));
  } catch {
    // device list is a nicety; the default mic still works
  }
}

/** Open (or re-open with another device) the microphone and plug it into the mixer. */
export async function openMic(deviceId = state.mic.deviceId) {
  if (!state.supported) return;
  set((s) => ({ mic: { ...s.mic, status: "asking", error: "", deviceId } }));
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    stopTracks(micStream);
    micStream = stream;
    getMixer().setMic(stream);
    getMixer().setMuted(state.muted);
    set((s) => ({ mic: { ...s.mic, status: "on", error: "" } }));
    listDevices(); // labels only appear once permission is granted
  } catch (e) {
    if (deviceId && e?.name === "OverconstrainedError") {
      // The saved device is gone (headset unplugged): fall back to the default one.
      writePref(KEYS.mic, "");
      return openMic("");
    }
    set((s) => ({ mic: { ...s.mic, status: "error", error: mediaError(e, "Microphone") } }));
  }
}

export function setMicDevice(deviceId) {
  writePref(KEYS.mic, deviceId);
  return openMic(deviceId);
}

export function toggleMute() {
  const muted = !state.muted;
  getMixer().setMuted(muted);
  set({ muted });
}

export async function toggleCamera() {
  if (state.camera.on) {
    if (state.videoRecorded) {
      // The recording has a video track: black it out instead of ending the track,
      // which would end the video part of the file.
      state.camera.stream?.getVideoTracks().forEach((t) => (t.enabled = false));
    } else {
      stopTracks(state.camera.stream);
    }
    set((s) => ({ camera: { ...s.camera, on: false, stream: s.videoRecorded ? s.camera.stream : null } }));
    return;
  }
  if (state.videoRecorded && state.camera.stream) {
    state.camera.stream.getVideoTracks().forEach((t) => (t.enabled = true));
    set((s) => ({ camera: { ...s.camera, on: true } }));
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
    set((s) => ({ camera: { ...s.camera, on: true, stream, error: "" } }));
  } catch (e) {
    set((s) => ({ camera: { ...s.camera, on: false, error: mediaError(e, "Camera") } }));
  }
}

function endShare() {
  stopTracks(state.share.stream);
  getMixer().setShare(null);
  set((s) => ({ share: { ...s.share, stream: null, hasAudio: false } }));
}

export async function toggleShare() {
  if (state.share.stream) return endShare();
  if (!state.share.supported) {
    set((s) => ({
      share: { ...s.share, error: "This browser cannot share a tab or window here. The microphone still records." },
    }));
    return;
  }
  await getMixer().resume();
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      // Raw audio: echo cancellation would cut the meeting audio whenever the user talks.
      audio: state.systemAudio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false,
      systemAudio: state.systemAudio ? "include" : "exclude", // Chrome: offer "Also share system audio"
      selfBrowserSurface: "exclude", // do not offer this very tab
    });
    const hasAudio = getMixer().setShare(stream);
    // The browser's own "Stop sharing" bar ends the track without telling us otherwise.
    stream.getVideoTracks()[0]?.addEventListener("ended", endShare);
    set((s) => ({
      share: {
        ...s.share,
        stream,
        hasAudio,
        error:
          state.systemAudio && !hasAudio
            ? "No audio is shared. To record a meeting tab, share it again and tick “Share tab audio”."
            : "",
      },
    }));
  } catch (e) {
    // Closing the picker is a NotAllowedError too; that is not worth a red message.
    const cancelled = e?.name === "NotAllowedError" && !/permission/i.test(e?.message || "");
    set((s) => ({ share: { ...s.share, error: cancelled ? "" : mediaError(e, "Screen sharing") } }));
  }
}

export function setSystemAudio(on) {
  writePref(KEYS.systemAudio, on);
  set({ systemAudio: on });
}

export function setNotes(patch) {
  set(patch); // { title } | { notes } | { tags }
}

function startTick() {
  clearInterval(tick);
  tick = setInterval(() => set({ elapsed: banked + performance.now() - runStart }), 250);
}

/** Start recording: whatever feeds the mixer, plus the camera's video if it is on now. */
export async function start() {
  if (state.phase !== "idle") return;
  const m = getMixer();
  await m.resume();
  if (state.mic.status !== "on" && !state.share.hasAudio) {
    set((s) => ({ mic: { ...s.mic, error: s.mic.error || "Turn on the microphone or share a tab with audio first." } }));
    return;
  }
  const video = !!(state.camera.on && state.camera.stream);
  const type = pickType(video ? VIDEO_TYPES : AUDIO_TYPES);
  const tracks = [...m.stream.getAudioTracks(), ...(video ? state.camera.stream.getVideoTracks() : [])];
  try {
    recorder = new MediaRecorder(new MediaStream(tracks), {
      ...(type ? { mimeType: type } : {}),
      audioBitsPerSecond: 64000, // speech: plenty for Whisper, ~30 MB an hour
      ...(video ? { videoBitsPerSecond: 1_000_000 } : {}),
    });
  } catch (e) {
    set((s) => ({ mic: { ...s.mic, error: `Recording could not start: ${e.message}` } }));
    return;
  }
  chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.start(1000); // a chunk a second, so a long recording is not one huge buffer at the end
  banked = 0;
  runStart = performance.now();
  startTick();
  set({ phase: "recording", elapsed: 0, startedAt: new Date(), videoRecorded: video, blob: null, uploadError: "" });
}

export function pause() {
  if (state.phase !== "recording") return;
  recorder.pause();
  clearInterval(tick);
  banked += performance.now() - runStart;
  set({ phase: "paused", elapsed: banked });
}

export function resume() {
  if (state.phase !== "paused") return;
  getMixer().resume();
  recorder.resume();
  runStart = performance.now();
  startTick();
  set({ phase: "recording" });
}

/** Stop and keep the file in memory. Resolves to the Blob. */
export function stop() {
  if (state.phase !== "recording" && state.phase !== "paused") return Promise.resolve(state.blob);
  clearInterval(tick);
  if (state.phase === "recording") banked += performance.now() - runStart;
  return new Promise((resolve) => {
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || "audio/webm" });
      chunks = [];
      set({ phase: "stopped", elapsed: banked, blob });
      resolve(blob);
    };
    recorder.stop();
  });
}

function fileName() {
  const safe = state.title.replace(/[^\w\- ]+/g, "").trim() || "recording";
  return safe + extensionFor(state.blob.type, state.videoRecorded);
}

/** Send the stopped recording with its title, notes and tags. Resolves to the new meeting. */
export async function save() {
  if (!state.blob) return null;
  const form = new FormData();
  form.append("file", new File([state.blob], fileName(), { type: state.blob.type }));
  form.append("title", state.title.trim() || defaultTitle(state.startedAt || new Date()));
  // The server keeps notes and tags once U1.4 is merged; before that it ignores them.
  if (state.notes.trim()) form.append("notes", state.notes.trim());
  if (state.tags.length) form.append("tags", JSON.stringify(state.tags));
  set({ phase: "uploading", progress: 0, uploadError: "" });
  try {
    const meeting = await upload("/api/meetings/", form, (p) => set({ progress: p }));
    reset();
    return meeting;
  } catch (e) {
    set({ phase: "stopped", uploadError: e.message || "Upload failed." });
    return null;
  }
}

/** Stop + upload in one go: the Leave and Stop Recording buttons. */
export async function stopAndSave() {
  await stop();
  return save();
}

/** Save the stopped recording to disk, for when the server is unreachable. */
export function downloadBlob() {
  if (!state.blob) return;
  const url = URL.createObjectURL(state.blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: fileName() });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Drop everything (also used after a successful upload) and release the devices. */
export function reset() {
  clearInterval(tick);
  if (recorder && recorder.state !== "inactive") {
    recorder.onstop = null;
    recorder.stop();
  }
  recorder = null;
  chunks = [];
  stopTracks(micStream);
  micStream = null;
  stopTracks(state.camera.stream);
  stopTracks(state.share.stream);
  mixer?.close();
  mixer = null;
  state = initial();
  setRecording(false);
  listeners.forEach((fn) => fn());
}

/** True while closing the tab would lose audio. */
export function hasUnsaved() {
  return ["recording", "paused", "stopped", "uploading"].includes(state.phase);
}

/**
 * Called when the Record page unmounts. A recording keeps going (the user may be checking
 * another page); an idle recorder lets go of the mic and camera so the browser's "in use"
 * light goes off.
 */
export function release() {
  if (state.phase !== "idle") return;
  stopTracks(micStream);
  micStream = null;
  stopTracks(state.camera.stream);
  stopTracks(state.share.stream);
  mixer?.close();
  mixer = null;
  const keep = { title: state.title, notes: state.notes, tags: state.tags };
  state = { ...initial(), ...keep };
  listeners.forEach((fn) => fn());
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (!hasUnsaved()) return;
    e.preventDefault();
    e.returnValue = ""; // older browsers need it set to show the prompt
  });
}
