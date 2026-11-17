/**
 * The two CSV downloads, built in the browser from the meeting JSON: no request and no
 * feature flag, so they work against any server that has the meeting.
 *
 * Cells are quoted as RFC 4180 says, the file starts with a UTF-8 BOM so Excel reads
 * accents and non-Latin scripts, and a cell that a spreadsheet could take for a formula
 * gets a leading apostrophe.
 */

const BOM = "\uFEFF";

/** mm:ss, the same form the transcript shows. */
export function clock(seconds = 0) {
  const total = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** "Project Sync: demo" -> "Project Sync - demo"; no path separators, no control characters. */
export function fileName(title, ext) {
  const base =
    String(title || "Meeting")
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "Meeting";
  return `${base}.${ext}`;
}

/**
 * A cell a spreadsheet would run: =cmd, +1+1, -2+3, @SUM(...). The apostrophe is the
 * spreadsheet's own "this is text" prefix, and it is what stops a meeting title from
 * executing anything when the file is opened.
 */
function safeCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

/** One field, quoted only when it has to be. */
function field(value) {
  const text = safeCell(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows of already-plain values -> the whole file, BOM first, CRLF between rows. */
export function csvText(rows) {
  return BOM + rows.map((row) => row.map(field).join(",")).join("\r\n") + "\r\n";
}

/** Save a Blob as a file, then drop the object URL. */
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking at once can cancel the download in Safari; a tick is enough for the rest.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadCsv(name, rows) {
  saveBlob(new Blob([csvText(rows)], { type: "text/csv;charset=utf-8" }), name);
}

/** Task, Owner, Due, Done, Meeting, Date - one row per action item. */
export function actionItemRows(meeting) {
  const header = ["Task", "Owner", "Due", "Done", "Meeting", "Date"];
  const date = meeting?.created ? new Date(meeting.created).toISOString().slice(0, 10) : "";
  const rows = (meeting?.action_items || []).map((item) => [
    item.task ?? "",
    item.owner ?? "",
    item.due ?? "",
    item.done ? "yes" : "no",
    meeting?.title ?? "",
    date,
  ]);
  return [header, ...rows];
}

/** Start, End, Speaker, Text - one row per transcript line, names as saved. */
export function transcriptRows(meeting) {
  const header = ["Start", "End", "Speaker", "Text"];
  const names = meeting?.speaker_names || {};
  const rows = (meeting?.segments || []).map((segment) => {
    const speaker =
      segment.speaker === null || segment.speaker === undefined
        ? ""
        : names[segment.speaker] || `Speaker ${segment.speaker + 1}`;
    return [clock(segment.start), clock(segment.end), speaker, segment.text ?? ""];
  });
  return [header, ...rows];
}
