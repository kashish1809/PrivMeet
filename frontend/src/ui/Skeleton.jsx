import { cx } from "./cx";

/** Grey placeholder block while data loads: <Skeleton className="h-4 w-40" />. Size it with
 *  classes. Hidden from screen readers: the page announces loading in words (e.g. aria-busy
 *  on the list). The pulse stops for reduced motion. */
export function Skeleton({ className, rounded = "rounded-md" }) {
  return (
    <span
      aria-hidden="true"
      className={cx("block bg-zinc-200 motion-safe:animate-pulse dark:bg-zinc-800", rounded, className)}
    />
  );
}
