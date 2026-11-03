import { cx } from "./cx";

/** Determinate bar, value 0-100. `label` names it for screen readers. */
export function ProgressBar({ value = 0, label = "Progress", className }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v}
      className={cx("h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800", className)}
    >
      <div className="h-full rounded-full bg-primary-600 transition-[width] duration-500" style={{ width: `${v}%` }} />
    </div>
  );
}
