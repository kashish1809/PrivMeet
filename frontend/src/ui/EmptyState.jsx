import { cx } from "./cx";

/** Centered placeholder for empty lists: icon, title, hint and an optional action button. */
export function EmptyState({ icon: Icon, title, children, action, className }) {
  return (
    <div className={cx("flex flex-col items-center justify-center gap-3 px-6 py-14 text-center", className)}>
      {Icon && (
        <div className="flex size-12 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-950 dark:text-primary-400">
          <Icon className="size-6" aria-hidden="true" />
        </div>
      )}
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
      {children && <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">{children}</p>}
      {action}
    </div>
  );
}
