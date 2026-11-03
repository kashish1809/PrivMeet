import { useId } from "react";
import { ChevronDown, Search } from "lucide-react";
import { cx, focusRing } from "./cx";

const box =
  "w-full rounded-lg border border-zinc-200 bg-white text-sm text-zinc-900 placeholder:text-zinc-400 transition-colors " +
  "focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30 disabled:opacity-50 " +
  "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500";

/** Label + control + optional hint/error. Children get the generated id via render prop. */
export function Field({ label, hint, error, className, children }) {
  const id = useId();
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {label}
        </label>
      )}
      {children(id)}
      {(error || hint) && (
        <p className={cx("text-xs", error ? "text-red-600 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400")}>
          {error || hint}
        </p>
      )}
    </div>
  );
}

export function Input({ label, hint, error, className, ...props }) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(id) => <input id={id} aria-invalid={!!error} className={cx(box, "h-9 px-3")} {...props} />}
    </Field>
  );
}

export function Textarea({ label, hint, error, className, rows = 4, ...props }) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(id) => <textarea id={id} rows={rows} aria-invalid={!!error} className={cx(box, "resize-y px-3 py-2")} {...props} />}
    </Field>
  );
}

/** Native <select> (keyboard and screen readers for free) styled like the mockup dropdowns. */
export function Select({ label, hint, error, className, options, ...props }) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(id) => (
        <div className="relative">
          <select id={id} className={cx(box, "h-9 appearance-none pr-9 pl-3")} {...props}>
            {options.map((o) =>
              typeof o === "string" ? (
                <option key={o} value={o}>{o}</option>
              ) : (
                <option key={o.value} value={o.value}>{o.label}</option>
              ),
            )}
          </select>
          <ChevronDown className="pointer-events-none absolute top-2.5 right-3 size-4 text-zinc-400" aria-hidden="true" />
        </div>
      )}
    </Field>
  );
}

/** "Search meetings…" box. `label` is required for screen readers even though it is not shown. */
export function SearchInput({ label = "Search", className, ...props }) {
  return (
    <div className={cx("relative", className)}>
      <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-zinc-400" aria-hidden="true" />
      <input type="search" aria-label={label} className={cx(box, "h-9 pr-3 pl-9")} {...props} />
    </div>
  );
}

/** On/off switch (role="switch"). */
export function Toggle({ checked, onChange, label, disabled, className }) {
  return (
    <label className={cx("inline-flex cursor-pointer items-center gap-3 text-sm text-zinc-700 dark:text-zinc-300", className)}>
      <button
        type="button"
        role="switch"
        aria-checked={!!checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50",
          checked ? "bg-primary-600" : "bg-zinc-300 dark:bg-zinc-700",
          focusRing,
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform",
            checked && "translate-x-4",
          )}
        />
      </button>
      {label}
    </label>
  );
}
