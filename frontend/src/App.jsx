import { useEffect, useState } from "react";

import { getSystem } from "./api";
import MeetingDetail from "./pages/MeetingDetail";
import MeetingList from "./pages/MeetingList";
import NewMeeting from "./pages/NewMeeting";
import { StatusDot } from "./ui";

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

/** Temporary header/footer: U1.2 replaces both with the sidebar shell. */
function SystemBar({ system, error }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-900">
      <a href="#/meetings" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        PrivMeet
      </a>
      <div className="flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
        <a href="#/meetings" className="hover:text-zinc-800 dark:hover:text-zinc-200">Meetings</a>
        <a href="#/new" className="hover:text-zinc-800 dark:hover:text-zinc-200">New meeting</a>
        <span className="text-zinc-300 dark:text-zinc-700">|</span>
        {error ? (
          <span className="inline-flex items-center gap-1.5 text-red-600 dark:text-red-400">
            <StatusDot tone="red" label="Backend offline" /> Backend offline: {error}
          </span>
        ) : system ? (
          <span className="inline-flex items-center gap-1.5">
            <StatusDot tone="green" label="Backend connected" />
            {system.tier} tier · {system.device} · {system.whisper_model} + {system.llm_model}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <StatusDot tone="gray" label="Connecting" /> Connecting…
          </span>
        )}
      </div>
    </header>
  );
}

function Footer({ system, error }) {
  return (
    <footer className="border-t border-zinc-200 px-6 py-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
      {system ? (
        <span className="inline-flex items-center gap-1.5">
          <StatusDot tone="green" label="Local AI ready" />
          Local AI · Ollama · {system.llm_model}
          {system.diarize ? " · speaker labels on" : ""}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <StatusDot tone={error ? "red" : "gray"} label={error ? "Local AI unreachable" : "Checking local AI"} />
          {error ? "Local AI unavailable — is the backend running?" : "Checking local AI…"}
        </span>
      )}
    </footer>
  );
}

/** Route table. U1.2 adds Home, Record / Live, History, Settings and the Tools pages. */
function Page({ path }) {
  const rest = path.replace(/^\/+|\/+$/g, "");
  if (rest === "" || rest === "meetings") return <MeetingList />;
  if (rest === "new") return <NewMeeting />;
  if (rest.startsWith("m/")) return <MeetingDetail id={rest.slice(2)} />;
  return (
    <section className="mx-auto max-w-xl">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Not built yet</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        <code className="font-mono">#{path}</code> arrives with the app shell (U1.2).{" "}
        <a href="#/meetings" className="text-primary-600 hover:underline dark:text-primary-400">Back to meetings</a>
      </p>
    </section>
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

  return (
    <div className="flex min-h-dvh flex-col">
      <SystemBar system={system} error={error} />
      <main className="flex-1 px-6 py-6">
        <Page path={path} />
      </main>
      <Footer system={system} error={error} />
    </div>
  );
}
