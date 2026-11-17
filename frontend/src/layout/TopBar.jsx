import { useEffect, useRef, useState } from "react";
import { Menu, Search, Settings, User, X } from "lucide-react";

import { api } from "../api";
import { navigate } from "../App";
import { IconButton, SearchInput, StatusDot, cx, focusRing } from "../ui";
import { useRecording } from "./recording";
import { Logo } from "./Sidebar";

const pillBase =
  "inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-zinc-200 bg-white/70 px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700/60 dark:bg-zinc-800/70 dark:text-zinc-200 dark:hover:bg-zinc-800";

/** "Local AI": green once /api/system/ answered, grey while it has not. With a cloud provider
 *  it says so in amber, like the sidebar card, so the bar never claims audio stays local. */
function AIPill({ system, error }) {
  const cloud = system?.llm_provider && system.llm_provider !== "ollama" ? system.llm_provider : "";
  const tone = !system ? "gray" : cloud ? "amber" : "green";
  const text = cloud ? "Cloud AI" : "Local AI";
  const tip = !system
    ? error ? "Backend not reachable" : "Connecting…"
    : `${cloud ? `${cloud} · ` : ""}${system.llm_model || "no model"}`;
  return (
    <a href="#/models" title={tip} aria-label={`${text}: ${tip}`} className={cx(pillBase, focusRing)}>
      <StatusDot tone={tone} label={tip} />
      <span className="max-md:hidden">{text}</span>
    </a>
  );
}

/** "Vinayak Kamath" -> "VK", "vinayak" -> "V". */
const initials = (name) =>
  name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

/** Round avatar with the display name's initials; a user icon when there is no name or the
 *  settings endpoint is missing. Re-read on every route change, so a name saved in Settings
 *  shows as soon as the user leaves that page. */
function UserAvatar() {
  const [name, setName] = useState("");
  useEffect(() => {
    const load = () =>
      api("/api/settings/")
        .then((s) => setName((s?.display_name || "").trim()))
        .catch(() => setName(""));
    load();
    window.addEventListener("hashchange", load);
    return () => window.removeEventListener("hashchange", load);
  }, []);
  const text = initials(name);
  return (
    <a
      href="#/settings"
      title={name || "Set your name in Settings"}
      aria-label={name ? `${name}, settings` : "Your profile, settings"}
      className={cx(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-600 text-xs font-semibold text-white",
        text.length > 1 && "tracking-tighter",
        focusRing,
      )}
    >
      {text || <User className="size-4" aria-hidden="true" />}
    </a>
  );
}

/** The bar above every page: search, the AI pill, settings and the user's avatar. On phones
 *  (< 640 px) it is also the menu bar: the drawer button and the logo, with search behind an
 *  icon that opens the field over the bar. */
export default function TopBar({ system, error, onMenu }) {
  const [q, setQ] = useState("");
  const [phoneSearch, setPhoneSearch] = useState(false);
  const input = useRef(null);
  const recording = useRecording();

  // Opening the phone field mounts nothing new (it is only shown), so focus it after paint.
  useEffect(() => {
    if (phoneSearch) input.current?.focus();
  }, [phoneSearch]);

  // Ctrl/Cmd+K focuses search from anywhere, even inside a field: the top bar owns this key
  // (R2.13's shortcuts leave it alone).
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPhoneSearch(true);
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function onSubmit(e) {
    e.preventDefault();
    const text = q.trim();
    // The Meetings page reads q from the route (R2.2), so search works from any page.
    navigate(text ? `/meetings?q=${encodeURIComponent(text)}` : "/meetings");
    setPhoneSearch(false);
  }

  return (
    <div className="relative flex h-full items-center gap-2 sm:gap-3">
      <IconButton icon={Menu} label="Open menu" onClick={onMenu} className="sm:hidden" />
      <span className="sm:hidden">
        <Logo />
      </span>
      <form
        role="search"
        onSubmit={onSubmit}
        className={cx(
          "w-full max-w-md",
          // Phones: hidden behind the search icon, then laid over the whole bar.
          phoneSearch
            ? "max-sm:absolute max-sm:inset-0 max-sm:z-10 max-sm:flex max-sm:max-w-none max-sm:items-center max-sm:gap-2 max-sm:bg-zinc-50 max-sm:dark:bg-zinc-950"
            : "max-sm:hidden",
        )}
        onKeyDown={(e) => e.key === "Escape" && setPhoneSearch(false)}
      >
        <SearchInput
          ref={input}
          label="Search meetings and notes"
          aria-keyshortcuts="Control+K Meta+K"
          placeholder="Search meetings, notes..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-sm:flex-1"
        />
        <IconButton icon={X} label="Close search" onClick={() => setPhoneSearch(false)} className="sm:hidden" />
      </form>
      <div className="ml-auto flex items-center gap-2">
        <IconButton icon={Search} label="Search" onClick={() => setPhoneSearch(true)} className="sm:hidden" />
        {recording && (
          <a
            href="#/record"
            className={cx(
              "inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-red-600 px-3 text-xs font-semibold text-white hover:bg-red-700",
              focusRing,
            )}
          >
            <StatusDot tone="red" pulse label="Recording now" className="[&>span]:bg-white" />
            <span className="max-sm:sr-only">Recording</span>
          </a>
        )}
        <AIPill system={system} error={error} />
        <a
          href="#/settings"
          aria-label="Settings"
          title="Settings"
          className={cx(pillBase, "w-9 justify-center px-0 max-sm:hidden", focusRing)}
        >
          <Settings className="size-4" aria-hidden="true" />
        </a>
        <UserAvatar />
      </div>
    </div>
  );
}
