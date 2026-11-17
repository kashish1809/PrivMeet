/**
 * All PrivMeet HTTP goes through here. Django's CsrfViewMiddleware rejects writes
 * without the cookie value echoed in X-CSRFToken, and GET /api/system/ (called once
 * on load) is what makes Django set that cookie.
 */

import { useEffect, useState } from "react";

const CSRF_COOKIE = "csrftoken";

/** Read the csrftoken cookie. Returns "" when the cookie is missing (first load). */
export function csrfToken() {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function parse(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null; // an HTML error page, not our JSON API
  }
}

function failure(status, statusText, data) {
  const message = (data && data.error) || [status, statusText].filter(Boolean).join(" ");
  return new Error(message || "Request failed.");
}

/**
 * JSON request. `body` is serialised; the CSRF header is added for every write.
 * Resolves to the parsed JSON (null for 204), rejects with Error(data.error).
 */
export async function api(path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(method === "GET" || method === "HEAD" ? {} : { "X-CSRFToken": csrfToken() }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = parse(await res.text());
  if (!res.ok) throw failure(res.status, res.statusText, data);
  return data;
}

/**
 * Multipart upload with progress. `onProgress` gets 0..1 as the bytes go out.
 * Resolves to the created meeting JSON, rejects with Error(data.error).
 */
export function upload(path, formData, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.withCredentials = true;
    xhr.setRequestHeader("X-CSRFToken", csrfToken());

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    });
    xhr.addEventListener("load", () => {
      const data = parse(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(failure(xhr.status, xhr.statusText, data));
    });
    xhr.addEventListener("error", () => reject(new Error("Upload failed: network error.")));
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelled.")));

    xhr.send(formData);
  });
}

// ---------------------------------------------------------------- system + feature flags

// One promise for /api/system/, shared by the whole page: the top bar, the Home page and
// every useFeatures() want the same answer, and asking once keeps one request per load.
let system = null;
// null until the answer arrives. An empty Set once it has: a server with no `features` list
// is an older server, which supports none of the v2 endpoints.
let features = null;
const watchers = new Set();

function offerFeatures(list) {
  features = new Set(Array.isArray(list) ? list : []);
  for (const watcher of watchers) watcher(features);
}

/** GET /api/system/, asked once. A failed request clears the promise so a retry can work. */
export function getSystem() {
  if (!system) {
    system = api("/api/system/").then(
      (data) => {
        offerFeatures(data?.features);
        return data;
      },
      (err) => {
        system = null;
        throw err;
      },
    );
  }
  return system;
}

/** Does this server support a v2 feature? False until /api/system/ has answered. */
export function hasFeature(key) {
  return features ? features.has(key) : false;
}

/** The feature flags as a Set that fills in when /api/system/ answers. Empty when it never does. */
export function useFeatures() {
  const [current, setCurrent] = useState(() => features ?? new Set());

  useEffect(() => {
    watchers.add(setCurrent);
    getSystem().catch(() => offerFeatures([])); // an older server: no list, no features
    return () => watchers.delete(setCurrent);
  }, []);

  return current;
}

// Thin wrappers so pages never hand-write a path. See backend/meetings/urls.py.
export const listMeetings = (q = "") => api(`/api/meetings/${q ? `?q=${encodeURIComponent(q)}` : ""}`);
export const getMeeting = (id) => api(`/api/meetings/${id}/`);
export const patchMeeting = (id, patch) => api(`/api/meetings/${id}/`, { method: "PATCH", body: patch });
export const deleteMeeting = (id) => api(`/api/meetings/${id}/`, { method: "DELETE" });
export const retryMeeting = (id) => api(`/api/meetings/${id}/retry`, { method: "POST", body: {} });
export const askMeeting = (id, question) =>
  api(`/api/meetings/${id}/ask`, { method: "POST", body: { question } });
export const getQuestion = (id) => api(`/api/questions/${id}/`);
export const meetingAudioUrl = (id) => `/api/meetings/${id}/audio`;
export const meetingExportUrl = (id) => `/api/meetings/${id}/export.md`;
