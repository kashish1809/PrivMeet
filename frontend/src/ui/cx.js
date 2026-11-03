/** Join class names, skipping falsy values: cx("a", ok && "b"). */
export const cx = (...classes) => classes.filter(Boolean).join(" ");

/** Shared focus ring so every interactive element shows keyboard focus the same way. */
export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-900";
