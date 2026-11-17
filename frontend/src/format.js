/** Small formatting helpers shared by the pages. */

/** 42 -> "00:42", 3725 -> "1:02:05". */
export function duration(seconds = 0) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${String(m).padStart(2, "0")}:${rest}`;
}

/** ISO string -> "Oct 28, 2026 · 10:00 AM", in the browser's locale. */
export function dateTime(iso) {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}

/** Meeting.status values that mean "still working"; anything else stops the 2 s poll. */
export const PROCESSING = ["queued", "converting", "transcribing", "diarizing", "summarizing"];

export const isProcessing = (meeting) => PROCESSING.includes(meeting?.status);

/** 2520 -> "42 min". The mockup's list rows and header both say minutes, never mm:ss. */
export function minutes(seconds = 0) {
  return `${Math.max(0, Math.round((seconds || 0) / 60))} min`;
}

/** ISO string -> "Oct 28, 2026", in the visitor's locale, with no time. */
export function shortDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * How many people were in the meeting. The list rows send `speakers` (U1.4); before that,
 * count the saved names, and failing those the distinct speakers in the transcript.
 */
export function participants(meeting) {
  if (typeof meeting?.speakers === "number") return meeting.speakers;
  const names = Object.keys(meeting?.speaker_names || {}).length;
  if (names) return names;
  const seen = new Set();
  for (const s of meeting?.segments || []) {
    if (s.speaker !== null && s.speaker !== undefined) seen.add(s.speaker);
  }
  return seen.size;
}

/**
 * The props for the status pill, per the "Status pill" contract in docs/TASKS.md:
 * `<Badge {...statusBadge(meeting)} />`. A finished meeting with no summary - the pipeline
 * completed but the model wrote nothing - reads "Processed" instead of "Done", so nobody
 * waits for notes that are never coming. Only a literal `false` counts: a server that does
 * not send `has_summary` at all still gets the plain status pill.
 */
export function statusBadge(meeting) {
  if (meeting?.status === "done" && meeting?.has_summary === false) {
    return { tone: "blue", dot: true, children: "Processed" };
  }
  return { status: meeting?.status };
}
