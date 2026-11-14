import { useState } from "react";
import { Check, ChevronLeft, ChevronRight, Download, Share2 } from "lucide-react";

import { meetingExportUrl } from "../api";
import { cx, focusRing } from "../ui";

/** "Oct 28, 2026" — local date, no time. R2.1 moves this into format.js as shortDate(). */
export function shortDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** 42 min, 0 min for a meeting we have no length for yet. R2.1: format.js minutes(). */
export function minutes(seconds = 0) {
  return `${Math.max(0, Math.round(seconds / 60))} min`;
}

/**
 * How many people were in the meeting. U1.4's list rows add `speakers`; until it is on
 * main this counts the saved names, then the distinct speakers in the transcript.
 * R2.1: format.js participants().
 */
export function participantCount(meeting) {
  if (typeof meeting?.speakers === "number") return meeting.speakers;
  const names = Object.keys(meeting?.speaker_names || {}).length;
  if (names) return names;
  const seen = new Set(
    (meeting?.segments || []).map((s) => s.speaker).filter((s) => s !== null && s !== undefined),
  );
  return seen.size;
}

const outline =
  "inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 " +
  "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800";

/**
 * Detail page header: the breadcrumb and Share / Download at the top, then the logo tile,
 * title, date · length · participants and the status pill.
 *
 * Share copies the page URL (R2.6 turns this into a menu with "Copy summary"), Download
 * is the Markdown export (R2.5 turns it into a format menu).
 * TODO(R1.3): swap the hand-drawn tile for <Logo variant="gradient" />.
 */
export default function MeetingHeader({ meeting }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function share() {
    setError("");
    const url = window.location.href;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        // http://127.0.0.1 is not a secure context on every browser, so clipboard may be absent.
        const box = document.createElement("textarea");
        box.value = url;
        box.setAttribute("readonly", "");
        box.style.position = "fixed";
        box.style.opacity = "0";
        document.body.appendChild(box);
        box.select();
        const ok = document.execCommand("copy");
        box.remove();
        if (!ok) throw new Error("copy was refused");
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Could not copy the link. Copy it from the address bar instead.");
    }
  }

  const people = participantCount(meeting);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
          <a
            href="#/meetings"
            className={cx(
              "inline-flex items-center gap-1 rounded-md text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
              focusRing,
            )}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            Meetings
          </a>
          <ChevronRight className="size-3.5 shrink-0 text-zinc-300 dark:text-zinc-600" aria-hidden="true" />
          <span className="truncate text-zinc-900 dark:text-zinc-100" aria-current="page">
            {meeting.title}
          </span>
        </nav>

        <div className="flex items-center gap-2">
          <button type="button" onClick={share} className={cx(outline, focusRing)}>
            {copied ? <Check className="size-4" aria-hidden="true" /> : <Share2 className="size-4" aria-hidden="true" />}
            {copied ? "Link copied" : "Share"}
          </button>
          <a
            href={meetingExportUrl(meeting.id)}
            download={`${meeting.title}.md`}
            className={cx(outline, focusRing)}
          >
            <Download className="size-4" aria-hidden="true" />
            Download
          </a>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {/* Announce the copy for screen readers, since the button label changes back after 2.5 s. */}
      <p aria-live="polite" className="sr-only">
        {copied ? "Meeting link copied to the clipboard" : ""}
      </p>

      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-400 to-primary-700 text-xl font-bold text-white shadow-sm"
        >
          P
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            {meeting.title}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {[shortDate(meeting.created), minutes(meeting.duration), people ? `${people} participants` : ""]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>
    </div>
  );
}
