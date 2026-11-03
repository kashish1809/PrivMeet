/**
 * All PrivMeet HTTP goes through here. Django's CsrfViewMiddleware rejects writes
 * without the cookie value echoed in X-CSRFToken, and GET /api/system/ (called once
 * on load) is what makes Django set that cookie.
 */

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

// Thin wrappers so pages never hand-write a path. See backend/meetings/urls.py.
export const getSystem = () => api("/api/system/");
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
