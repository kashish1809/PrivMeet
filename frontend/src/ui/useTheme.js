import { useEffect, useState } from "react";

const KEY = "theme";

/** The four presets from the v2 mockup, then four more. `dark` decides the .dark class every
 *  dark: utility uses. Each one has its own landscape in PixelScape. */
export const THEMES = [
  { id: "indigo", name: "Indigo (Default)", caption: "Modern, professional, and focused.", dark: true },
  { id: "teal", name: "Teal", caption: "Clean and calm, great for long sessions.", dark: true },
  { id: "amber", name: "Amber", caption: "Warm and minimal with high clarity.", dark: true },
  { id: "slate", name: "Slate (Light)", caption: "Clean, minimal light theme for everyday use.", dark: false },
  { id: "rose", name: "Sakura", caption: "Plum night and cherry blossom, soft and quiet.", dark: true },
  { id: "forest", name: "Pine", caption: "Deep evergreen, easy on the eyes after dark.", dark: true },
  { id: "dawn", name: "Dawn (Light)", caption: "Warm cream and coral, like the first hour of light.", dark: false },
  { id: "glacier", name: "Glacier (Light)", caption: "Icy blue and crisp white, cool and clear.", dark: false },
  // `dark` here is only a default: the custom theme's own mode decides (see applyTheme()).
  { id: "custom", name: "Custom", caption: "Your colours, your world. Tap the pencil to edit.", dark: true },
  // The special one: its own renderer, not a recolour of the lake.
  { id: "neon", name: "Neon Drive", caption: "A synthwave night: a striped sun, a glowing grid, palms.", dark: true },
];
const IDS = new Set(THEMES.map((t) => t.id));

// ---------------------------------------------------------------- the custom theme

const CUSTOM_KEY = "customTheme";
/** The eight landscapes a custom theme can live in. */
export const SCENES = [
  { id: "indigo", name: "Starlit lake" },
  { id: "teal", name: "Fjord" },
  { id: "amber", name: "Desert" },
  { id: "slate", name: "Sailing bay" },
  { id: "rose", name: "Cherry blossom" },
  { id: "forest", name: "Pine woods" },
  { id: "dawn", name: "Balloon sunrise" },
  { id: "glacier", name: "Icebergs" },
  { id: "neon", name: "Neon Drive" },
];
/** Home's hero text. The presets always use this; the custom theme can change it. */
export const HERO_DEFAULT = {
  title: "Welcome back, {name}",
  line: "Turn your meetings into structured, actionable insights.",
};
export const HERO_LIMITS = { title: 60, line: 140 };
export const CUSTOM_DEFAULT = {
  name: "My theme",
  accent: "#8b5cf6",
  mode: "dark",
  neutralHue: null,
  tint: 45,
  scene: "indigo",
  heroTitle: HERO_DEFAULT.title,
  heroLine: HERO_DEFAULT.line,
};
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const HEX = /^#[0-9a-f]{6}$/i;

/** Read back whatever was saved, keeping only valid values, so a hand-edited or old entry can
 *  never break the app: every field falls back to its default on its own. */
export function cleanCustom(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  const num = (v, lo, hi, d) => (v !== null && v !== "" && Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
  return {
    name: text(c.name, 30, CUSTOM_DEFAULT.name),
    accent: HEX.test(c.accent) ? c.accent.toLowerCase() : CUSTOM_DEFAULT.accent,
    mode: c.mode === "light" ? "light" : "dark",
    neutralHue: num(c.neutralHue, 0, 360, null),
    tint: num(c.tint, 0, 100, CUSTOM_DEFAULT.tint),
    scene: SCENES.some((x) => x.id === c.scene) ? c.scene : CUSTOM_DEFAULT.scene,
    heroTitle: text(c.heroTitle, HERO_LIMITS.title, HERO_DEFAULT.title),
    heroLine: text(c.heroLine, HERO_LIMITS.line, HERO_DEFAULT.line),
  };
}

/** A text field, kept exactly as typed and only capped. Trimming or swapping in a default
 *  here ran on every keystroke: a trailing space vanished, so "My theme" could not be typed,
 *  and clearing a field snapped the default back in. Empty is handled where it is shown. */
function text(v, limit, fallback) {
  return typeof v === "string" ? v.slice(0, limit) : fallback;
}

/** What to show for a text field that may be empty or only spaces. */
export const shown = (v, fallback) => (typeof v === "string" && v.trim() ? v.trim() : fallback);

export function loadCustom() {
  try {
    return cleanCustom(JSON.parse(localStorage.getItem(CUSTOM_KEY) || "null"));
  } catch {
    return { ...CUSTOM_DEFAULT };
  }
}

function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}

export function hslToHex(h, s, l) {
  const S = s / 100;
  const L = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return "#" + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
}

// Lightness per step, shaped like Tailwind's own scales: airy at 50, deep at 950.
// 300 and 400 sit a little high on purpose: they are the accent's text colours on a dark page,
// and at 65 the default violet's links measured 4.3:1, just under WCAG AA.
const ACCENT_L = [97, 93.5, 86, 78, 69, 56, 48, 40, 33, 26, 16];
const NEUTRAL_L = [96.5, 92.5, 86.5, 76, 61, 46, 33, 24, 16.5, 10.5, 6];

/** The two scales a theme is made of, from the custom settings. */
export function customScales(raw) {
  const c = cleanCustom(raw);
  const [h, s] = hexToHsl(c.accent);
  const sat = Math.max(35, Math.min(95, s)); // a grey "accent" still needs some colour
  const primary = {};
  STEPS.forEach((step, i) => {
    // ease saturation off at the very light and very dark ends, where full colour looks neon
    const edge = i === 0 || i === STEPS.length - 1 ? 0.75 : 1;
    primary[step] = hslToHex(h, sat * edge, ACCENT_L[i]);
  });
  const nh = c.neutralHue === null ? h : c.neutralHue;
  const zinc = {};
  STEPS.forEach((step, i) => {
    // neutrals stay neutrals: at full tint they carry 36 % saturation, less in the darks
    const ns = (c.tint / 100) * (i > 7 ? 30 : 36);
    zinc[step] = hslToHex(nh, ns, NEUTRAL_L[i]);
  });
  return { primary, zinc, mode: c.mode, scene: c.scene, name: c.name };
}

/** WCAG contrast ratio of two hex colours. */
export function contrast(a, b) {
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** A share code: the settings as base64 JSON behind a version tag. */
export const shareCode = (cfg) => "pm1:" + btoa(JSON.stringify(cleanCustom(cfg)));
export function readShareCode(code) {
  const text = (code || "").trim();
  if (!text.startsWith("pm1:")) throw new Error("That is not a PrivMeet theme code.");
  try {
    return cleanCustom(JSON.parse(atob(text.slice(4))));
  } catch {
    throw new Error("That theme code is damaged.");
  }
}

/** A random theme that still looks good: a saturated accent, a matching or complementary
 *  neutral, and a world. */
export function surprise() {
  const h = Math.floor(Math.random() * 360);
  const offset = [null, 180, 30, -30][Math.floor(Math.random() * 4)];
  return cleanCustom({
    name: "Surprise",
    accent: hslToHex(h, 65 + Math.random() * 25, 55),
    mode: Math.random() < 0.6 ? "dark" : "light",
    neutralHue: offset === null ? null : (h + offset + 360) % 360,
    tint: 25 + Math.floor(Math.random() * 50),
    scene: SCENES[Math.floor(Math.random() * SCENES.length)].id,
  });
}

const VAR_NAMES = STEPS.flatMap((n) => ["--color-primary-" + n, "--color-zinc-" + n]);

/** Set or clear the custom theme's colours on <html>. */
function paintCustom(root, on) {
  if (!on) {
    VAR_NAMES.forEach((v) => root.style.removeProperty(v));
    delete root.dataset.scene;
    return null;
  }
  const sc = customScales(loadCustom());
  STEPS.forEach((n) => {
    root.style.setProperty("--color-primary-" + n, sc.primary[n]);
    root.style.setProperty("--color-zinc-" + n, sc.zinc[n]);
  });
  root.dataset.scene = sc.scene;
  return sc;
}

const CUSTOM_EVENT = "privmeet:custom-theme";

/** Save the custom settings; when the custom theme is on, it re-colours the app at once. */
export function saveCustom(cfg) {
  const clean = cleanCustom(cfg);
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(clean));
  } catch {
    // private window: it still applies for this visit
  }
  if (document.documentElement.dataset.theme === "custom") applyTheme("custom");
  window.dispatchEvent(new CustomEvent(CUSTOM_EVENT, { detail: clean }));
  return clean;
}

/** [settings, update] for the custom theme editor; every change is saved and applied live. */
export function useCustomTheme() {
  const [cfg, setCfg] = useState(loadCustom);
  useEffect(() => {
    const on = (e) => setCfg(e.detail);
    window.addEventListener(CUSTOM_EVENT, on);
    return () => window.removeEventListener(CUSTOM_EVENT, on);
  }, []);
  return [cfg, (patch) => setCfg(saveCustom({ ...loadCustom(), ...patch }))];
}

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
  const custom = paintCustom(root, id === "custom");
  root.dataset.theme = id;
  root.classList.toggle("dark", custom ? custom.mode === "dark" : THEMES.find((t) => t.id === id).dark);
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

const FONT_KEY = "font";
/** The two app fonts. "pixel" (Monocraft) is the default; "normal" is the regular sans font. */
export const FONTS = [
  { id: "pixel", name: "Pixel", caption: "Retro pixel letters, the PrivMeet look." },
  { id: "normal", name: "Normal", caption: "A regular sans font, easier for long transcripts." },
];

function storedFont() {
  try {
    return localStorage.getItem(FONT_KEY) === "normal" ? "normal" : "pixel";
  } catch {
    return "pixel";
  }
}

/** Set <html data-font>; theme.css swaps the font variables for "normal". Call before rendering. */
export function applyFont(font = storedFont()) {
  const id = font === "normal" ? "normal" : "pixel";
  document.documentElement.dataset.font = id;
  return id;
}

export function useFont() {
  const [font, setFont] = useState(storedFont);
  useEffect(() => {
    try {
      localStorage.setItem(FONT_KEY, font);
    } catch {
      // private window: applies for this visit only
    }
    applyFont(font);
  }, [font]);
  return [font, (next) => setFont(next === "normal" ? "normal" : "pixel")];
}
