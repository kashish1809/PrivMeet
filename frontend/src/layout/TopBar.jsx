import { useEffect, useRef, useState } from "react";

import { navigate } from "../App";
import { SearchInput } from "../ui";

/** The bar above every page: search now; the AI pill, settings and avatar follow. */
export default function TopBar() {
  const [q, setQ] = useState("");
  const input = useRef(null);

  // Ctrl/Cmd+K focuses search from anywhere, even inside a field: the top bar owns this key
  // (R2.13's shortcuts leave it alone).
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
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
  }

  return (
    <div className="flex h-full items-center gap-3">
      <form role="search" onSubmit={onSubmit} className="w-full max-w-md">
        <SearchInput
          ref={input}
          label="Search meetings and notes"
          aria-keyshortcuts="Control+K Meta+K"
          placeholder="Search meetings, notes..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </form>
    </div>
  );
}
