import { cloneElement, useId, useState } from "react";

import { cx } from "./cx";

/**
 * A short hint shown on hover and on keyboard focus, wired to the child with
 * aria-describedby. Esc hides it until the pointer or focus leaves (WCAG 1.4.13).
 *   <Tooltip label="Delete meeting"><IconButton … /></Tooltip>
 * The child must be one element that takes aria-describedby (a button, link or input).
 */
export function Tooltip({ label, side = "top", children, className }) {
  const id = useId();
  const [hidden, setHidden] = useState(false);
  return (
    <span
      className={cx("group/tip relative inline-flex", className)}
      onKeyDown={(e) => e.key === "Escape" && setHidden(true)}
      onMouseLeave={() => setHidden(false)}
      onBlur={() => setHidden(false)}
    >
      {cloneElement(children, { "aria-describedby": id })}
      <span
        id={id}
        role="tooltip"
        className={cx(
          "pointer-events-none absolute left-1/2 z-40 w-max max-w-56 -translate-x-1/2 rounded-md bg-zinc-900 px-2 py-1 text-xs text-zinc-50 opacity-0 shadow-md transition-opacity dark:bg-zinc-100 dark:text-zinc-900",
          side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
          !hidden && "group-hover/tip:opacity-100 group-has-[:focus-visible]/tip:opacity-100",
        )}
      >
        {label}
      </span>
    </span>
  );
}
