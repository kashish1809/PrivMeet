import { useState } from "react";
import { Check, ClipboardPaste, Copy, Moon, RotateCcw, Shuffle, Sparkles, Sun } from "lucide-react";

import {
  Badge,
  Button,
  contrast,
  CUSTOM_DEFAULT,
  customScales,
  cx,
  focusRing,
  HERO_DEFAULT,
  HERO_LIMITS,
  heroTitle,
  Input,
  PixelScape,
  readShareCode,
  SCENES,
  shareCode,
  shown,
  surprise,
  useCustomTheme,
} from "../ui";

// Accents picked to look good in both modes, one per family round the colour wheel.
const SWATCHES = [
  "#ef4444", "#f97316", "#f59e0b", "#84cc16", "#10b981", "#14b8a6",
  "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6", "#d946ef", "#ec4899",
];

// The colour each landscape is known for, for its little marker.
const SCENE_DOT = {
  indigo: "#6366f1", teal: "#14b8a6", amber: "#f59e0b", slate: "#a5a4f8",
  rose: "#f43f78", forest: "#10b981", dawn: "#f05a33", glacier: "#38bdf8",
};

const HUES = "linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)";

function Section({ title, hint, children }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h4>
        {hint && <span className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** One readability check: the ratio, and whether it meets WCAG AA for body text. */
function ContrastPill({ label, ratio }) {
  const ok = ratio >= 4.5;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-zinc-100 px-3 py-2 text-xs dark:bg-zinc-800/70">
      <span className="text-zinc-600 dark:text-zinc-300">{label}</span>
      <Badge tone={ok ? "green" : ratio >= 3 ? "amber" : "red"} dot>
        {ratio.toFixed(1)}:1 {ok ? "AA" : ratio >= 3 ? "large text only" : "hard to read"}
      </Badge>
    </div>
  );
}

/** A small hero card in the theme being built. It redraws on its own as the colours change,
 *  because the custom theme writes them straight onto <html>. */
function Preview({ cfg }) {
  return (
    <div className="relative isolate h-44 overflow-hidden rounded-2xl border border-primary-200 bg-primary-50 dark:border-primary-900/60 dark:bg-zinc-950">
      <PixelScape
        scene="clouds"
        seed={4}
        orbX={0.82}
        className="absolute inset-0 [mask-image:linear-gradient(to_right,transparent_0%,rgb(0_0_0/0.5)_35%,black_70%)]"
      />
      <div className="relative flex h-full flex-col justify-center gap-2 p-5">
        <p className="text-[11px] font-semibold tracking-wider text-primary-700 uppercase dark:text-primary-300">
          {shown(cfg.name, "Custom")}
        </p>
        <p className="text-lg font-semibold text-zinc-900 dark:text-white">{heroTitle(shown(cfg.heroTitle, HERO_DEFAULT.title), "")}</p>
        <p className="line-clamp-2 max-w-[15rem] text-xs text-zinc-600 dark:text-zinc-300">{shown(cfg.heroLine, HERO_DEFAULT.line)}</p>
        <span className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white">
          <Sparkles className="size-3.5" aria-hidden="true" /> New Meeting
        </span>
      </div>
    </div>
  );
}

/**
 * The custom theme editor. Every control applies at once: the whole app re-colours behind it,
 * the landscape at the bottom of the page included, so the page itself is the preview.
 */
export default function CustomTheme({ onClose }) {
  const [cfg, update] = useCustomTheme();
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [copied, setCopied] = useState(false);

  const { primary, zinc, mode } = customScales(cfg);
  const dark = mode === "dark";
  const page = dark ? zinc[950] : zinc[50];
  const checks = [
    { label: "Body text", ratio: contrast(dark ? zinc[100] : zinc[900], page) },
    { label: "Links and accents", ratio: contrast(dark ? primary[400] : primary[600], page) },
    { label: "Button text", ratio: contrast("#ffffff", primary[600]) },
  ];
  const matchHue = cfg.neutralHue === null;

  async function copy() {
    const text = shareCode(cfg);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setCode(text); // no clipboard (plain http): show it so it can be copied by hand
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function paste() {
    try {
      update(readShareCode(code));
      setCode("");
      setCodeError("");
    } catch (e) {
      setCodeError(e.message);
    }
  }

  return (
    <div
      id="custom-theme-editor"
      className="mt-5 flex flex-col gap-6 rounded-2xl border border-primary-200 p-5 dark:border-primary-900/60"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Make it yours</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Changes apply as you go. The whole app is the preview.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={Shuffle} onClick={() => update(surprise())}>
            Surprise me
          </Button>
          <Button variant="ghost" icon={RotateCcw} onClick={() => update({ ...CUSTOM_DEFAULT })}>
            Reset
          </Button>
          {onClose && (
            <Button icon={Check} onClick={onClose}>
              Done
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="flex flex-col gap-6">
          <Input
            label="Name"
            value={cfg.name}
            maxLength={30}
            onChange={(e) => update({ name: e.target.value })}
            hint="Shown on the theme card."
          />

          <Section title="Home greeting" hint="The words on the big card on Home">
            <Input
              label="Title"
              value={cfg.heroTitle}
              maxLength={HERO_LIMITS.title}
              onChange={(e) => update({ heroTitle: e.target.value })}
              hint="{name} becomes your display name; with none set it drops out."
            />
            <Input
              label="Line under it"
              value={cfg.heroLine}
              maxLength={HERO_LIMITS.line}
              onChange={(e) => update({ heroLine: e.target.value })}
            />
            {(cfg.heroTitle !== HERO_DEFAULT.title || cfg.heroLine !== HERO_DEFAULT.line) && (
              <button
                type="button"
                onClick={() => update({ heroTitle: HERO_DEFAULT.title, heroLine: HERO_DEFAULT.line })}
                className={cx("w-fit text-xs text-primary-700 underline dark:text-primary-300", focusRing)}
              >
                Use the default words
              </button>
            )}
          </Section>

          <Section title="Accent" hint={cfg.accent.toUpperCase()}>
            <div className="flex flex-wrap items-center gap-2">
              <label
                className={cx("relative size-9 cursor-pointer overflow-hidden rounded-lg border border-zinc-300 dark:border-zinc-700", focusRing)}
                title="Pick any colour"
              >
                <span className="absolute inset-0" style={{ background: cfg.accent }} />
                <input
                  type="color"
                  value={cfg.accent}
                  onChange={(e) => update({ accent: e.target.value })}
                  className="absolute inset-0 cursor-pointer opacity-0"
                  aria-label="Pick any accent colour"
                />
              </label>
              <span className="mx-1 h-6 w-px bg-zinc-200 dark:bg-zinc-700" aria-hidden="true" />
              {SWATCHES.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => update({ accent: hex })}
                  aria-label={`Accent ${hex}`}
                  aria-pressed={cfg.accent === hex}
                  className={cx(
                    "grid size-7 place-items-center rounded-full ring-offset-2 ring-offset-white transition-transform hover:scale-110 dark:ring-offset-zinc-900",
                    cfg.accent === hex && "ring-2 ring-zinc-900 dark:ring-white",
                    focusRing,
                  )}
                  style={{ background: hex }}
                >
                  {cfg.accent === hex && <Check className="size-3.5 text-white" aria-hidden="true" />}
                </button>
              ))}
            </div>
            {/* the generated scale, so the eleven shades it makes are visible */}
            <div className="flex overflow-hidden rounded-lg" aria-hidden="true">
              {Object.values(primary).map((c) => (
                <span key={c} className="h-3 flex-1" style={{ background: c }} />
              ))}
            </div>
          </Section>

          <Section title="Mode">
            <div role="radiogroup" aria-label="Mode" className="grid grid-cols-2 gap-2">
              {[
                ["dark", "Night", Moon, "Moon, stars, and dark cards"],
                ["light", "Day", Sun, "Sun, clouds, and light cards"],
              ].map(([id, name, Icon, line]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={cfg.mode === id}
                  onClick={() => update({ mode: id })}
                  className={cx(
                    "flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left",
                    cfg.mode === id
                      ? "border-primary-500 bg-primary-50 dark:border-primary-400 dark:bg-primary-950/40"
                      : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700",
                    focusRing,
                  )}
                >
                  <Icon className="size-5 text-primary-600 dark:text-primary-400" aria-hidden="true" />
                  <span className="leading-tight">
                    <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{name}</span>
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">{line}</span>
                  </span>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Background tint" hint={`${cfg.tint}%`}>
            <input
              type="range"
              min={0}
              max={100}
              value={cfg.tint}
              onChange={(e) => update({ tint: Number(e.target.value) })}
              aria-label="Background tint strength"
              className={cx("w-full accent-primary-600 dark:accent-primary-400", focusRing)}
            />
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
                <input
                  type="checkbox"
                  checked={matchHue}
                  onChange={(e) => update({ neutralHue: e.target.checked ? null : 220 })}
                  className="size-4 accent-primary-600"
                />
                Tint with the accent
              </label>
              {!matchHue && (
                <input
                  type="range"
                  min={0}
                  max={360}
                  value={cfg.neutralHue}
                  onChange={(e) => update({ neutralHue: Number(e.target.value) })}
                  aria-label="Background hue"
                  className={cx("h-2 flex-1 cursor-pointer appearance-none rounded-full", focusRing)}
                  style={{ background: HUES }}
                />
              )}
            </div>
            {/* the neutral scale it makes: page, cards, borders and text all come from here */}
            <div className="flex overflow-hidden rounded-lg" aria-hidden="true">
              {Object.values(zinc).map((c) => (
                <span key={c} className="h-3 flex-1" style={{ background: c }} />
              ))}
            </div>
          </Section>

          <Section title="Landscape" hint="The world at the bottom of every page">
            <div role="radiogroup" aria-label="Landscape" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {SCENES.map((sc) => (
                <button
                  key={sc.id}
                  type="button"
                  role="radio"
                  aria-checked={cfg.scene === sc.id}
                  onClick={() => update({ scene: sc.id })}
                  className={cx(
                    "flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm",
                    cfg.scene === sc.id
                      ? "border-primary-500 bg-primary-50 text-zinc-900 dark:border-primary-400 dark:bg-primary-950/40 dark:text-zinc-100"
                      : "border-zinc-200 text-zinc-700 hover:border-zinc-300 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-700",
                    focusRing,
                  )}
                >
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: SCENE_DOT[sc.id] }} aria-hidden="true" />
                  {sc.name}
                </button>
              ))}
            </div>
          </Section>
        </div>

        <div className="flex flex-col gap-4">
          <Preview cfg={cfg} />
          <Section title="Readability">
            <div className="flex flex-col gap-1.5">
              {checks.map((c) => (
                <ContrastPill key={c.label} {...c} />
              ))}
            </div>
            {checks[2].ratio < 3 && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                White text is hard to read on this accent. A deeper shade of it reads better.
              </p>
            )}
          </Section>
          <Section title="Share">
            <Button variant="secondary" icon={copied ? Check : Copy} onClick={copy}>
              {copied ? "Code copied" : "Copy theme code"}
            </Button>
            <div className="flex gap-2">
              <input
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setCodeError("");
                }}
                placeholder="Paste a pm1: code"
                aria-label="Theme code to use"
                className={cx(
                  "min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 font-mono text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200",
                  focusRing,
                )}
              />
              <Button variant="secondary" icon={ClipboardPaste} onClick={paste} disabled={!code.trim()}>
                Use
              </Button>
            </div>
            {codeError && (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                {codeError}
              </p>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
