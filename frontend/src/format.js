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
