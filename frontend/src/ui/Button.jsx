import { cx, focusRing } from "./cx";

const VARIANTS = {
  primary: "bg-primary-600 text-white hover:bg-primary-700 disabled:bg-primary-300 dark:disabled:bg-primary-900",
  secondary:
    "border border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300",
  ghost: "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
};
const SIZES = { sm: "h-8 px-3 text-xs gap-1.5", md: "h-9 px-4 text-sm gap-2", lg: "h-11 px-5 text-sm gap-2" };

/** Text button with an optional lucide icon: <Button icon={Plus}>New Meeting</Button> */
export function Button({ variant = "primary", size = "md", icon: Icon, className, type = "button", children, ...props }) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex items-center justify-center rounded-lg font-medium transition-colors disabled:cursor-not-allowed",
        VARIANTS[variant],
        SIZES[size],
        focusRing,
        className,
      )}
      {...props}
    >
      {Icon && <Icon className="size-4 shrink-0" aria-hidden="true" />}
      {children}
    </button>
  );
}

/** Icon-only button. `label` is required: it becomes the accessible name and tooltip. */
export function IconButton({ icon: Icon, label, variant = "ghost", size = "md", className, type = "button", ...props }) {
  const box = { sm: "size-8", md: "size-9", lg: "size-11" }[size];
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        box,
        focusRing,
        className,
      )}
      {...props}
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
}
