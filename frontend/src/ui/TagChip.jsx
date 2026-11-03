import { X } from "lucide-react";
import { cx, focusRing } from "./cx";

/** Tag pill like "Development ×". Pass onRemove to show the remove button. */
export function TagChip({ children, onRemove, className }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-md bg-primary-50 py-0.5 pr-1 pl-2 text-xs font-medium text-primary-700 dark:bg-primary-950 dark:text-primary-300",
        !onRemove && "pr-2",
        className,
      )}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove tag ${children}`}
          className={cx("rounded p-0.5 hover:bg-primary-100 dark:hover:bg-primary-900", focusRing)}
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      )}
    </span>
  );
}
