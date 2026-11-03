import { cx } from "./cx";

const TONES = {
  gray: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  blue: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  red: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  primary: "bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-300",
};
const DOTS = {
  gray: "bg-zinc-400",
  blue: "bg-blue-500",
  amber: "bg-amber-500",
  green: "bg-emerald-500",
  red: "bg-red-500",
  primary: "bg-primary-500",
};

// Meeting.status values from backend/meetings/models.py, plus "recording" for the Record / Live screen.
const STATUS = {
  queued: ["gray", "Queued"],
  converting: ["blue", "Converting"],
  transcribing: ["blue", "Transcribing"],
  diarizing: ["amber", "Finding speakers"],
  summarizing: ["primary", "Summarizing"],
  done: ["green", "Done"],
  failed: ["red", "Failed"],
  recording: ["red", "Recording"],
};

/** Small pill. Pass `status` (a Meeting.status) or `tone` + children. */
export function Badge({ status, tone, dot, className, children }) {
  const [statusTone, label] = STATUS[status] || [];
  const t = tone || statusTone || "gray";
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        TONES[t],
        className,
      )}
    >
      {(dot ?? !!status) && <span className={cx("size-1.5 rounded-full", DOTS[t])} aria-hidden="true" />}
      {children ?? label}
    </span>
  );
}

/** Colored dot with a screen-reader label, e.g. Ollama connected / offline. */
export function StatusDot({ tone = "green", label, pulse, className }) {
  return (
    <span className={cx("relative inline-flex size-2.5", className)} role="img" aria-label={label} title={label}>
      {pulse && <span className={cx("absolute inset-0 animate-ping rounded-full opacity-60", DOTS[tone])} />}
      <span className={cx("relative size-2.5 rounded-full", DOTS[tone])} />
    </span>
  );
}
