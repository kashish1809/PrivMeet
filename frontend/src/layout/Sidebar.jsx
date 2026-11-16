import { Calendar, ChevronRight, Cpu, History, House, LayoutTemplate, Settings } from "lucide-react";

import { TOOLS } from "../pages/Tools";
import { LogoMark, StatusDot, cx, focusRing } from "../ui";
import { useRecording } from "./recording";

// `page` is the route without "#/" and slashes: "", "meetings", "m/<id>", "record".
// Exactly the five items of the v2 mockup, with no group headings. Record / Live is reached
// from Home and from New Meeting; History and the Tools pages are gone (docs/TASKS.md).
const MAIN = [
  { href: "#/", label: "Home", icon: House, active: (p) => p === "" },
  {
    href: "#/meetings",
    label: "Meetings",
    icon: Calendar,
    // Recording and every meeting screen belong to Meetings, so the pill never goes dark.
    active: (p) => p === "meetings" || p === "new" || p === "record" || p.startsWith("m/"),
    record: true,
  },
  { href: "#/templates", label: "Templates", icon: LayoutTemplate, active: (p) => p === "templates" },
  { href: "#/models", label: "Models", icon: Cpu, active: (p) => p === "models" },
  { href: "#/settings", label: "Settings", icon: Settings, active: (p) => p === "settings" },
];

// Screens v2 moves elsewhere. They are kept visible, under their own heading, so the plan is
// not invisible: each page says which task delivers the feature and where it will live.
const PLANNED = [
  { href: "#/history", label: "History", icon: History, active: (p) => p === "history" },
  ...Object.entries(TOOLS).map(([key, t]) => ({
    href: `#/tools/${key}`,
    label: t.title,
    icon: t.icon,
    active: (p) => p === `tools/${key}`,
  })),
];

// In the desktop column (`rail`), text hides below 900 px and only icons stay; the phone drawer always shows text.
const railText = (rail) => (rail ? "sr-only min-[900px]:not-sr-only" : "");

function NavItem({ item, page, rail, recording }) {
  const on = item.active(page);
  const Icon = item.icon;
  return (
    <li>
      <a
        href={item.href}
        aria-current={on ? "page" : undefined}
        title={rail ? item.label : undefined}
        className={cx(
          "flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors",
          rail && "max-[899px]:justify-center max-[899px]:px-0",
          on
            ? "bg-primary-50 font-medium text-primary-700 dark:bg-primary-950/70 dark:text-primary-200"
            : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
          focusRing,
        )}
      >
        <span className="relative flex">
          {item.record && recording ? (
            <StatusDot tone="red" pulse label="Recording" className="m-[3px]" />
          ) : (
            <Icon className="size-4.5 shrink-0" aria-hidden="true" />
          )}
        </span>
        <span className={railText(rail)}>{item.label}</span>
      </a>
    </li>
  );
}

export function Logo({ rail }) {
  return (
    <a href="#/" className={cx("flex items-center gap-2.5 rounded-lg", rail && "max-[899px]:justify-center", focusRing)}>
      <LogoMark size={36} />
      <span className={cx("leading-tight", railText(rail))}>
        <span className="block text-base font-semibold text-zinc-900 dark:text-zinc-100">PrivMeet</span>
        <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">Self-hosted AI meeting notes</span>
      </span>
    </a>
  );
}

/** Bottom card: green dot once /api/system/ answered, grey while connecting or offline. */
/** The mockup's bottom card: green dot, "Self-hosted", "Your data. Your server."
 *
 * It only says that while everything really is local. A cloud provider or cloud transcription
 * is opt-in, and the card then names the provider instead of claiming self-hosted, so the one
 * line in the window that speaks about privacy is never the one telling a lie.
 */
function LocalAI({ system, error, rail }) {
  const provider = system?.llm_provider && system.llm_provider !== "ollama" ? system.llm_provider : "";
  // Short enough for the card: "Notes written by groq" lost the provider to the ellipsis.
  const title = !system ? "Local AI" : provider ? "Cloud model" : "Self-hosted";
  const line = !system ? (error ? "Backend offline" : "Connecting…") : provider ? `Notes by ${provider}` : "Your data. Your server.";
  return (
    <a
      href="#/settings"
      title={rail ? `${title} · ${line}` : undefined}
      className={cx(
        "flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-left hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800",
        rail && "max-[899px]:justify-center max-[899px]:border-0 max-[899px]:bg-transparent max-[899px]:px-0",
        focusRing,
      )}
    >
      <StatusDot
        tone={!system ? "gray" : provider ? "amber" : "green"}
        label={!system ? "Backend not reachable" : provider ? "Using a cloud model" : "Self-hosted"}
      />
      <span className={cx("min-w-0 flex-1 leading-tight", railText(rail))}>
        <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{title}</span>
        <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{line}</span>
      </span>
      <ChevronRight
        className={cx("size-4 shrink-0 text-zinc-400", rail && "max-[899px]:hidden")}
        aria-hidden="true"
      />
    </a>
  );
}

/** Sidebar contents. `rail` = the desktop column that shrinks to icons below 900 px. */
export default function Sidebar({ page, system, error, rail = false }) {
  const recording = useRecording();
  return (
    <div className="flex h-full flex-col gap-6 px-3 py-5">
      <div className="px-1">
        <Logo rail={rail} />
      </div>
      <nav aria-label="Main" className="flex flex-1 flex-col gap-6 overflow-y-auto">
        <ul className="flex flex-col gap-0.5">
          {MAIN.map((item) => (
            <NavItem key={item.href} item={item} page={page} rail={rail} recording={recording} />
          ))}
        </ul>
        <div>
          <h2
            className={cx(
              "mb-1 px-3 text-[11px] font-semibold tracking-wider text-zinc-400 uppercase dark:text-zinc-500",
              railText(rail),
            )}
          >
            Planned
          </h2>
          <ul className="flex flex-col gap-0.5">
            {PLANNED.map((item) => (
              <NavItem key={item.href} item={item} page={page} rail={rail} recording={recording} />
            ))}
          </ul>
        </div>
      </nav>
      <LocalAI system={system} error={error} rail={rail} />
    </div>
  );
}
