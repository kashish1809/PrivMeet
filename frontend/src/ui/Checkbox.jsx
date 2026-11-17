import { useId } from "react";
import { Check } from "lucide-react";

import { cx, focusRing } from "./cx";

/**
 * The square checkbox of the mockup's Action Items card. A real <input type="checkbox">
 * underneath, so Space, labels and screen readers work as usual.
 *   <Checkbox checked={done} onChange={setDone} label="Update API docs" />
 * `hideLabel` keeps the label for screen readers only, for a row that shows the text itself.
 */
export function Checkbox({ checked, onChange, label, hideLabel = false, disabled, className }) {
  const id = useId();
  return (
    <span className={cx("inline-flex items-center gap-2.5", className)}>
      <span className="relative inline-flex size-5 shrink-0">
        <input
          id={id}
          type="checkbox"
          checked={!!checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className={cx(
            "peer size-5 cursor-pointer appearance-none rounded-md border-2 border-zinc-300 bg-white transition-colors",
            "checked:border-primary-600 checked:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50",
            "dark:border-zinc-600 dark:bg-zinc-800/70 dark:checked:border-primary-500 dark:checked:bg-primary-500",
            focusRing,
          )}
        />
        <Check
          className="pointer-events-none absolute inset-0.5 size-4 text-white opacity-0 peer-checked:opacity-100"
          strokeWidth={3}
          aria-hidden="true"
        />
      </span>
      <label htmlFor={id} className={cx("cursor-pointer text-sm text-zinc-800 dark:text-zinc-200", hideLabel && "sr-only")}>
        {label}
      </label>
    </span>
  );
}
