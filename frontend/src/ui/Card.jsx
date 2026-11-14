import { cx } from "./cx";

/** Rounded panel used for list rows, summary blocks and side panels. */
export function Card({ as: Tag = "div", className, children, ...props }) {
  return (
    <Tag
      className={cx(
        // 88% opaque: the scenery behind the app shows through a little, text stays crisp.
        "rounded-xl border border-zinc-200 bg-white/[0.88] shadow-sm dark:border-zinc-800 dark:bg-zinc-900/[0.88]",
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  );
}

/** Optional header row with a title and right-side actions. */
export function CardHeader({ title, icon: Icon, actions, className }) {
  return (
    <div className={cx("flex items-center justify-between gap-3 px-5 pt-4", className)}>
      <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {Icon && <Icon className="size-4 text-primary-600 dark:text-primary-400" aria-hidden="true" />}
        {title}
      </h3>
      {actions}
    </div>
  );
}
