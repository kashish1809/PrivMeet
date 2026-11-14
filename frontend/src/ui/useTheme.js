import { useEffect, useState } from "react";

const KEY = "theme";

/** The four presets from the v2 mockup. `dark` decides the .dark class every dark: utility uses. */
export const THEMES = [
  { id: "indigo", name: "Indigo (Default)", caption: "Modern, professional, and focused.", dark: true },
  { id: "teal", name: "Teal", caption: "Clean and calm, great for long sessions.", dark: true },
  { id: "amber", name: "Amber", caption: "Warm and minimal with high clarity.", dark: true },
  { id: "slate", name: "Slate (Light)", caption: "Clean, minimal light theme for everyday use.", dark: false },
];
const IDS = new Set(THEMES.map((t) => t.id));

/** A stored value from before the presets: light -> slate; dark, system or nothing -> indigo. */
export function normalizeTheme(value) {
  if (IDS.has(value)) return value;
  return value === "light" ? "slate" : "indigo";
}

function stored() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Set data-theme and the .dark class on <html>. Call once before React renders to avoid a flash. */
export function applyTheme(theme = stored()) {
  const id = normalizeTheme(theme);
  const root = document.documentElement;
  root.dataset.theme = id;
  root.classList.toggle("dark", THEMES.find((t) => t.id === id).dark);
  return id;
}

// shortcut: each useTheme() call holds its own state, so two mounted pickers do not sync live; lift to context if that happens.
export function useTheme() {
  const [theme, setTheme] = useState(() => normalizeTheme(stored()));

  useEffect(() => {
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // private window: the theme still applies for this visit
    }
    applyTheme(theme);
  }, [theme]);

  return [theme, (next) => setTheme(normalizeTheme(next))];
}
