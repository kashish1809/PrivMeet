import { useEffect, useState } from "react";

import { SearchX } from "lucide-react";

import { getSystem } from "./api";
import AppShell from "./layout/AppShell";
import History from "./pages/History";
import Home from "./pages/Home";
import MeetingDetail from "./pages/MeetingDetail";
import MeetingList from "./pages/MeetingList";
import NewMeeting from "./pages/NewMeeting";
import RecordLive from "./pages/RecordLive";
import Settings from "./pages/Settings";
import Tools, { TOOLS } from "./pages/Tools";
import { EmptyState } from "./ui";

/** Go to a route. Hash routing only, so there is no server rewrite to worry about. */
export function navigate(to) {
  window.location.hash = to;
}

/** Current route as { path, params }; re-renders on hashchange and keeps "?t=" for the detail page. */
export function useRoute() {
  const read = () => {
    const raw = window.location.hash.replace(/^#/, "") || "/";
    const [path, query = ""] = raw.split("?");
    return { path: path || "/", query: new URLSearchParams(query) };
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

/** Route table: every hash route from docs/TASKS.md "Routes". `page` is the path without slashes. */
function Page({ page }) {
  if (page === "") return <Home />;
  if (page === "meetings") return <MeetingList />;
  if (page === "new") return <NewMeeting />;
  if (page.startsWith("m/")) return <MeetingDetail id={page.slice(2)} />;
  if (page === "record") return <RecordLive />;
  if (page === "history") return <History />;
  if (page === "settings") return <Settings />;
  const tool = page.startsWith("tools/") && page.slice(6);
  if (tool && TOOLS[tool]) return <Tools tool={tool} />;
  return (
    <EmptyState icon={SearchX} title="Page not found">
      <code className="font-mono">#/{page}</code> is not a PrivMeet page.{" "}
      <a href="#/" className="text-primary-600 hover:underline dark:text-primary-400">Go home</a>
    </EmptyState>
  );
}

export default function App() {
  const { path } = useRoute();
  const [system, setSystem] = useState(null);
  const [error, setError] = useState("");

  // One call on load: reports the tier and, on the same response, sets the CSRF cookie.
  useEffect(() => {
    getSystem().then(setSystem).catch((e) => setError(e.message));
  }, []);

  const page = path.replace(/^\/+|\/+$/g, "");

  return (
    <AppShell page={page} system={system} error={error}>
      <Page page={page} />
    </AppShell>
  );
}
