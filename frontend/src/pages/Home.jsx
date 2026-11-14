import { useCallback, useEffect, useState } from "react";
import {
  ChevronRight,
  CloudUpload,
  Download,
  ExternalLink,
  FileText,
  LayoutTemplate,
  Mic,
  Plus,
  Trash2,
  Users,
} from "lucide-react";

import { api, deleteMeeting, listMeetings, meetingExportUrl } from "../api";
import { navigate } from "../App";
import { isProcessing } from "../format";
import { Badge, Button, Card, ConfirmDialog, EmptyState, Menu, cx, focusRing } from "../ui";

const POLL_MS = 2000;
const RECENT = 5;

/** "Oct 28, 2026" */
function shortDate(iso) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
}

/** `Oct 28, 2026 · 42 min · 4 participants`, leaving out what is not known yet. */
function metaLine(m) {
  const parts = [shortDate(m.created)];
  if (m.duration) parts.push(`${Math.max(1, Math.round(m.duration / 60))} min`);
  if (m.speakers) parts.push(`${m.speakers} participant${m.speakers === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

/** The status pill contract from docs/TASKS.md: a done meeting without a summary is "Processed". */
function StatusPill({ m }) {
  if (m.status === "done" && m.has_summary === false)
    return (
      <Badge tone="blue" dot>
        Processed
      </Badge>
    );
  if (isProcessing(m) && m.progress > 0)
    return (
      <Badge status={m.status}>
        <span className="tabular-nums">{m.progress}%</span>
      </Badge>
    );
  return <Badge status={m.status} />;
}

/** Decorative waves in the accent color, drawn behind the hero text. */
function Waves() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 600 240"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-y-0 right-0 h-full w-[75%] text-primary-500"
    >
      <defs>
        <linearGradient id="home-wave" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="currentColor" stopOpacity="0" />
          <stop offset="0.55" stopColor="currentColor" stopOpacity="0.55" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <path
          key={i}
          d={`M0 ${200 - i * 6} C 150 ${210 - i * 14}, 260 ${120 + i * 10}, 380 ${110 - i * 8} S 560 ${10 + i * 12}, 600 ${20 + i * 8}`}
          fill="none"
          stroke="url(#home-wave)"
          strokeWidth={i === 2 ? 3 : 1.25}
          opacity={1 - i * 0.12}
        />
      ))}
      <path d="M0 240 C 160 230, 260 150, 390 140 S 560 40, 600 50 L600 240 Z" fill="url(#home-wave)" opacity="0.18" />
    </svg>
  );
}

function Hero({ name }) {
  return (
    <Card className="relative isolate overflow-hidden border-primary-200 bg-gradient-to-br from-primary-50 to-white dark:border-primary-900/60 dark:from-primary-950 dark:to-zinc-900">
      <Waves />
      <div className="relative flex min-h-56 flex-col justify-center gap-3 p-7 sm:p-9">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl dark:text-white">
          {name ? `Welcome back, ${name}` : "Welcome back"}
        </h1>
        <p className="max-w-md text-sm text-zinc-600 sm:text-base dark:text-zinc-300">
          Turn your meetings into structured, actionable insights.
        </p>
        <div className="mt-3">
          <Button size="lg" icon={Plus} onClick={() => navigate("/new")}>
            New Meeting
          </Button>
        </div>
      </div>
    </Card>
  );
}

const ACTIONS = [
  { href: "#/record", icon: Mic, title: "Start Recording", line: "Begin a new meeting" },
  { href: "#/new", icon: CloudUpload, title: "Upload Audio", line: "Process existing file" },
  { href: "#/templates", icon: LayoutTemplate, title: "View Templates", line: "Use a note template" },
];

function QuickActions() {
  return (
    <Card className="flex flex-col">
      <h2 className="px-5 pt-5 pb-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">Quick Actions</h2>
      <ul className="flex flex-1 flex-col gap-1 px-2 pb-3">
        {ACTIONS.map((a) => (
          <li key={a.href}>
            <a
              href={a.href}
              className={cx(
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/70",
                focusRing,
              )}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700 group-hover:bg-primary-50 group-hover:text-primary-600 dark:bg-zinc-800 dark:text-zinc-200 dark:group-hover:bg-primary-950 dark:group-hover:text-primary-300">
                <a.icon className="size-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{a.title}</span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">{a.line}</span>
              </span>
              <ChevronRight className="size-4 text-zinc-300 group-hover:text-zinc-500 dark:text-zinc-600" aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function MeetingRow({ m, onDelete }) {
  const Icon = m.speakers >= 5 ? Users : FileText;
  return (
    <li className="flex items-center gap-3 px-3 py-2.5 sm:gap-4 sm:px-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-950 dark:text-primary-300">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <a href={`#/m/${m.id}`} className={cx("min-w-0 flex-1 rounded-md", focusRing)}>
        <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{m.title}</span>
        <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{metaLine(m)}</span>
      </a>
      <StatusPill m={m} />
      <Menu
        label={`Actions for ${m.title}`}
        items={[
          { label: "Open", icon: ExternalLink, onSelect: () => navigate(`/m/${m.id}`) },
          { label: "Download", icon: Download, onSelect: () => (window.location.href = meetingExportUrl(m.id)) },
          { label: "Delete", icon: Trash2, danger: true, onSelect: () => onDelete(m) },
        ]}
      />
    </li>
  );
}

function RowSkeleton() {
  return (
    <li className="flex items-center gap-4 px-4 py-3" aria-hidden="true">
      <span className="size-10 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />
      <span className="flex-1 space-y-2">
        <span className="block h-3 w-1/3 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
        <span className="block h-2.5 w-1/2 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
      </span>
    </li>
  );
}

/**
 * Home, per docs/ui/mockup.webp: the hero card with the user's name, Quick Actions, and the
 * five newest meetings with their status. Polls every 2 s while one of them is processing.
 */
export default function Home() {
  const [name, setName] = useState("");
  const [meetings, setMeetings] = useState(null);
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);

  // display_name comes from the settings store (R1.7). Until that endpoint exists the
  // request fails and the hero says just "Welcome back".
  useEffect(() => {
    api("/api/settings/")
      .then((s) => setName((s?.display_name || "").trim()))
      .catch(() => setName(""));
  }, []);

  const load = useCallback(
    () =>
      listMeetings()
        .then((data) => {
          setMeetings(data.meetings.slice(0, RECENT));
          setError("");
        })
        .catch((e) => setError(e.message)),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  const processing = (meetings || []).some(isProcessing);
  useEffect(() => {
    if (!processing) return undefined;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [processing, load]);

  async function confirmDelete() {
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteMeeting(target.id);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Hero name={name} />
        <QuickActions />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Recent Meetings</h2>
          <a href="#/meetings" className={cx("rounded text-sm text-primary-600 hover:underline dark:text-primary-400", focusRing)}>
            View all
          </a>
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}
        <Card>
          {meetings === null && !error ? (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {[0, 1, 2].map((i) => (
                <RowSkeleton key={i} />
              ))}
            </ul>
          ) : meetings?.length ? (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {meetings.map((m) => (
                <MeetingRow key={m.id} m={m} onDelete={setPendingDelete} />
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={FileText}
              title="No meetings yet"
              action={
                <Button icon={Mic} onClick={() => navigate("/record")}>
                  Start Recording
                </Button>
              }
            >
              Record or upload a meeting and its transcript, summary and action items show up here.
            </EmptyState>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete this meeting?"
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      >
        “{pendingDelete?.title}” and its recording, transcript and notes are removed from this server.
      </ConfirmDialog>
    </section>
  );
}
