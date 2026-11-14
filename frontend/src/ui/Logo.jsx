import { cx } from "./cx";

/**
 * The PrivMeet mark: a pixel speech bubble with a two-pane window inside (the meeting and its
 * notes), drawn on a 32-cell grid. Texture in flat color bands: a light rim top-left, a dark
 * rim bottom-right, the body stepping from light to deep, the panes shaded like small screens.
 * docs/ui/logo.svg is the same art in the default Indigo colors.
 *
 * Animated (default): the panes are eyes that glance left and right and blink twice, and a
 * pixel sparkle pops on the corner, in one 7 s loop.
 * Both are CSS transform/opacity only and stop for reduced motion.
 *
 * Every fill is a primary-* or zinc-* class, so the mark follows the theme presets.
 *
 *   <Logo />                       mark on a theme tile (sidebar, phone header)
 *   <Logo tile={false} size={48} />  mark alone
 *   <Logo wordmark />              mark + "PrivMeet"
 */
const CELLS = [
  ["fill-zinc-950", "M11 3h10v1h-10zM9 4h2v1h-2zM21 4h2v1h-2zM8 5h1v1h-1zM23 5h1v1h-1zM7 6h1v1h-1zM24 6h1v1h-1zM6 7h1v1h-1zM25 7h1v1h-1zM5 8h1v1h-1zM26 8h1v1h-1zM5 9h1v1h-1zM26 9h1v1h-1zM4 10h1v1h-1zM27 10h1v1h-1zM4 11h1v1h-1zM27 11h1v1h-1zM4 12h1v1h-1zM27 12h1v1h-1zM4 13h1v1h-1zM27 13h1v1h-1zM4 14h1v1h-1zM27 14h1v1h-1zM4 15h1v1h-1zM27 15h1v1h-1zM4 16h1v1h-1zM27 16h1v1h-1zM4 17h1v1h-1zM27 17h1v1h-1zM4 18h1v1h-1zM27 18h1v1h-1zM5 19h1v1h-1zM26 19h1v1h-1zM5 20h1v1h-1zM26 20h1v1h-1zM6 21h1v1h-1zM25 21h1v1h-1zM7 22h1v1h-1zM24 22h1v1h-1zM8 23h1v1h-1zM23 23h1v1h-1zM8 24h1v1h-1zM21 24h2v1h-2zM8 25h1v1h-1zM18 25h3v1h-3zM8 26h1v1h-1zM13 26h5v1h-5zM8 27h5v1h-5z"],
  ["fill-primary-300", "M11 4h10v1h-10zM9 5h3v1h-3zM21 5h2v1h-2zM8 6h2v1h-2zM7 7h2v1h-2zM6 8h2v1h-2zM6 9h1v1h-1zM5 10h2v1h-2zM5 11h1v1h-1zM5 12h1v1h-1zM5 13h1v1h-1zM5 14h1v1h-1zM5 15h1v1h-1zM5 16h1v1h-1zM5 17h1v1h-1zM5 18h1v1h-1zM6 19h1v1h-1zM6 20h1v1h-1z"],
  ["fill-primary-400", "M12 5h8v1h-8zM10 6h11v1h-11zM23 6h1v1h-1zM9 7h16v1h-16z"],
  ["fill-primary-500", "M8 8h17v1h-17zM7 9h1v1h-1zM24 9h1v1h-1zM7 10h1v1h-1zM24 10h2v1h-2zM6 11h2v1h-2zM24 11h2v1h-2zM6 12h2v1h-2zM24 12h2v1h-2zM6 13h2v1h-2zM24 13h2v1h-2z"],
  ["fill-primary-600", "M6 14h2v1h-2zM24 14h2v1h-2zM6 15h2v1h-2zM24 15h2v1h-2zM6 16h2v1h-2zM24 16h2v1h-2zM6 17h2v1h-2zM24 17h2v1h-2zM6 18h2v1h-2zM24 18h1v1h-1zM7 19h1v1h-1zM24 19h1v1h-1z"],
  ["fill-primary-700", "M7 20h1v1h-1zM22 20h2v1h-2zM7 21h1v1h-1zM17 21h6v1h-6zM8 22h1v1h-1zM16 22h6v1h-6zM15 23h5v1h-5zM14 24h3v1h-3z"],
  ["fill-primary-800", "M25 8h1v1h-1zM25 9h1v1h-1zM26 10h1v1h-1zM26 11h1v1h-1zM26 12h1v1h-1zM26 13h1v1h-1zM26 14h1v1h-1zM26 15h1v1h-1zM26 16h1v1h-1zM26 17h1v1h-1zM25 18h2v1h-2zM25 19h1v1h-1zM24 20h2v1h-2zM23 21h2v1h-2zM22 22h2v1h-2zM20 23h3v1h-3zM17 24h4v1h-4zM13 25h5v1h-5zM12 26h1v1h-1z"],
  ["fill-white", "M8 9h15v1h-15zM8 10h15v1h-15zM8 11h15v1h-15zM8 12h2v1h-2zM15 12h2v1h-2zM22 12h1v1h-1zM8 13h15v1h-15zM8 14h3v1h-3zM15 14h2v1h-2zM21 14h2v1h-2zM8 15h3v1h-3zM15 15h2v1h-2zM21 15h2v1h-2zM8 16h3v1h-3zM15 16h2v1h-2zM21 16h2v1h-2zM8 17h3v1h-3zM15 17h2v1h-2zM21 17h2v1h-2zM8 18h15v1h-15zM8 19h14v1h-14zM8 20h9v1h-9zM9 21h7v1h-7zM9 22h6v1h-6zM9 23h5v1h-5zM9 24h4v1h-4zM9 25h3v1h-3z"],
  ["fill-primary-200", "M23 9h1v1h-1zM23 10h1v1h-1zM23 11h1v1h-1zM23 12h1v1h-1zM23 13h1v1h-1zM23 14h1v1h-1zM23 15h1v1h-1zM23 16h1v1h-1zM23 17h1v1h-1zM23 18h1v1h-1zM22 19h2v1h-2zM17 20h5v1h-5zM8 21h1v1h-1zM16 21h1v1h-1zM15 22h1v1h-1zM14 23h1v1h-1zM13 24h1v1h-1zM12 25h1v1h-1zM9 26h3v1h-3z"],
  ["fill-zinc-950", "M10 12h5v1h-5zM17 12h5v1h-5z"],
  ["fill-primary-400", "M12 14h3v1h-3zM18 14h3v1h-3z", "eyes"],
  ["fill-primary-600", "M11 15h4v1h-4zM17 15h4v1h-4z", "eyes"],
  ["fill-primary-800", "M11 16h4v1h-4zM17 16h4v1h-4zM11 17h4v1h-4zM17 17h4v1h-4z", "eyes"],
  ["fill-primary-100", "M11 14h1v1h-1zM17 14h1v1h-1z", "eyes"],
  ["fill-white", "M20 5h1v1h-1zM21 6h2v1h-2z", "glint"],
];

export const TAGLINE = "Your meetings. Your data. Your control.";
export const SUBLINE = "Self-hosted AI meeting notes";

export function LogoMark({ size = 36, tile = true, animated = true, className, title }) {
  return (
    <svg
      viewBox={tile ? "0 0 32 32" : "3 2.5 26 26"}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : "true"}
      className={cx("shrink-0", className)}
    >
      {title && <title>{title}</title>}
      {tile && (
        <rect width="32" height="32" rx="7" className="fill-primary-100 dark:fill-primary-950" />
      )}
      {tile && <rect y="16" width="32" height="16" rx="7" className="fill-primary-200/60 dark:fill-zinc-950/50" />}
      {CELLS.filter(([, , part]) => !part).map(([fill, d]) => (
        <path key={fill + d.length} d={d} className={fill} />
      ))}
      {/* The panes blink and the highlight twinkles: CSS transform/opacity only (theme.css). */}
      <g className={animated ? "pm-eyes" : undefined}>
        {CELLS.filter(([, , part]) => part === "eyes").map(([fill, d]) => (
          <path key={fill} d={d} className={fill} />
        ))}
      </g>
      {CELLS.filter(([, , part]) => part === "glint").map(([fill, d]) => (
        <path key={fill} d={d} className={cx(fill, animated && "pm-twinkle")} />
      ))}
      {/* A pixel sparkle that pops on the top-right corner now and then (CSS only). */}
      {animated && (
        <path
          d="M25 1h1v1h-1zM25 3h1v1h-1zM24 2h1v1h-1zM26 2h1v1h-1zM25 2h1v1h-1z"
          className="pm-sparkle fill-white dark:fill-primary-100"
        />
      )}
    </svg>
  );
}

/** Mark plus the "PrivMeet" wordmark (and optionally the sub-line). */
export function Logo({ size = 36, tile = true, animated = true, wordmark = false, subline = false, className }) {
  if (!wordmark) return <LogoMark size={size} tile={tile} animated={animated} className={className} title="PrivMeet" />;
  return (
    <span className={cx("inline-flex items-center gap-2.5", className)}>
      <LogoMark size={size} tile={tile} animated={animated} />
      <span className="leading-tight">
        <span className="block text-base font-semibold text-zinc-900 dark:text-zinc-100">PrivMeet</span>
        {subline && <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">{SUBLINE}</span>}
      </span>
    </span>
  );
}
