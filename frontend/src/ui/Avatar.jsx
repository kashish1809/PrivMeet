import { cx } from "./cx";

// Matches the mockup's participant colors; kept as full class strings so Tailwind can see them.
const COLORS = [
  "bg-violet-200 text-violet-800 dark:bg-violet-900 dark:text-violet-200",
  "bg-blue-200 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  "bg-teal-200 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
  "bg-pink-200 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
  "bg-amber-200 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  "bg-emerald-200 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
];

/** Stable color index: speaker numbers map in order, names hash. */
export function speakerColor(key) {
  if (typeof key === "number") return COLORS[key % COLORS.length];
  let h = 0;
  for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

const SIZES = { sm: "size-6 text-[10px]", md: "size-8 text-xs", lg: "size-16 text-2xl" };

/** Initial in a colored circle. `colorKey` (speaker index) keeps colors stable across renames. */
export function Avatar({ name, colorKey = name, size = "md", className }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none",
        speakerColor(colorKey),
        SIZES[size],
        className,
      )}
    >
      {initial}
    </span>
  );
}

/** Overlapping avatars; shows "+N" after `max`. people: [{ name, colorKey }] */
export function AvatarStack({ people, max = 5, size = "sm", className }) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <div className={cx("flex -space-x-1.5", className)}>
      {shown.map((p, i) => (
        <Avatar key={i} {...p} size={size} className="ring-2 ring-white dark:ring-zinc-900" />
      ))}
      {extra > 0 && (
        <span
          className={cx(
            "inline-flex items-center justify-center rounded-full bg-zinc-200 font-medium text-zinc-700 ring-2 ring-white dark:bg-zinc-700 dark:text-zinc-200 dark:ring-zinc-900",
            SIZES[size],
          )}
        >
          +{extra}
        </span>
      )}
    </div>
  );
}
