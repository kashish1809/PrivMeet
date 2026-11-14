import { cx } from "./cx";

// Pixel buttons (theme.css "Pixel buttons"): a retro block in the look of the logo tile with a
// pixel font. The variant picks the colours; the theme presets re-colour every one of them.
const VARIANTS = {
  primary: "pm-btn-primary",
  secondary: "pm-btn-secondary",
  danger: "pm-btn-danger",
  ghost: "pm-btn-ghost",
};
// Heights land on the 2px pixel grid of the frame; the font steps with them.
const SIZES = { sm: "h-8 px-3 text-[11px] gap-1.5", md: "h-10 px-4 text-xs gap-2", lg: "h-12 px-5 text-sm gap-2.5" };

/** Text button with an optional lucide icon: <Button icon={Plus}>New Meeting</Button> */
export function Button({ variant = "primary", size = "md", icon: Icon, className, type = "button", children, ...props }) {
  return (
    <button type={type} className={cx("pm-btn", VARIANTS[variant], SIZES[size], className)} {...props}>
      {Icon && <Icon className="size-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />}
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
      className={cx("pm-btn", VARIANTS[variant], box, className)}
      {...props}
    >
      <Icon className="size-4" strokeWidth={2.25} aria-hidden="true" />
    </button>
  );
}
