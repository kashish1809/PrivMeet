import { useState } from "react";

import { navigate } from "../App";
import { SearchInput } from "../ui";

/** The bar above every page: search now; the AI pill, settings and avatar follow. */
export default function TopBar() {
  const [q, setQ] = useState("");

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
          label="Search meetings and notes"
          placeholder="Search meetings, notes..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </form>
    </div>
  );
}
