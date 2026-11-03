import { useEffect, useState } from "react";

const KEY = "theme"; // "light" | "dark" | "system"

/** Set or clear the .dark class on <html>. Call once before React renders to avoid a flash. */
export function applyTheme(theme = localStorage.getItem(KEY) || "system") {
  const dark =
    theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

// shortcut: each useTheme() call holds its own state, so two mounted toggles do not sync live; lift to context if that happens.
export function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem(KEY) || "system");

  useEffect(() => {
    localStorage.setItem(KEY, theme);
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => applyTheme("system");
    mq.addEventListener("change", follow);
    return () => mq.removeEventListener("change", follow);
  }, [theme]);

  return [theme, setTheme];
}
