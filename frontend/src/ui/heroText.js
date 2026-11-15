import { HERO_DEFAULT, shown, useCustomTheme } from "./useTheme";

export { HERO_DEFAULT, HERO_LIMITS } from "./useTheme";

/** The title with `{name}` filled in. With no name, ", {name}" and the like drop out cleanly
 *  so "Welcome back, {name}" reads "Welcome back", not "Welcome back, ". */
export function heroTitle(title, name) {
  if (name) return title.replaceAll("{name}", name);
  // drop "{name}'s " whole, then "{name}" with the comma or space in front of it; what
  // follows it, a "!" or ". Ready?", stays as written
  return title.replace(/\{name\}['’]s\s+/g, "").replace(/[\s,·:-]*\{name\}/g, "").trim();
}

/**
 * The words on Home's hero card: the custom theme's own while it is the active theme (they
 * are part of it, edited in its editor and carried in its share code), the defaults otherwise.
 */
export function useHeroText() {
  const [cfg] = useCustomTheme();
  if (document.documentElement.dataset.theme !== "custom") return { ...HERO_DEFAULT };
  return { title: shown(cfg.heroTitle, HERO_DEFAULT.title), line: shown(cfg.heroLine, HERO_DEFAULT.line) };
}
