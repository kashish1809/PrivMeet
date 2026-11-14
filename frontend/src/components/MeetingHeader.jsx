import { useEffect, useId, useRef, useState } from "react";
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
 *
 * The title is a button: click it (or press Enter on it) to rename the meeting in place.
 * Enter or leaving the field saves, Escape throws the edit away.
 *
 * TODO(R1.3): swap the hand-drawn tile for <Logo variant="gradient" />.
 */
export default function MeetingHeader({ meeting, onRename }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const titleId = useId();
  const titleButton = useRef(null);
  const restoreTitleFocus = useRef(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  function startEditing() {
    if (!onRename) return; // no handler (older server page): the title stays a heading
    setDraft(meeting.title);
    setError("");
    setEditing(true);
  }

  // The title button only exists once editing is over, so focus has to be restored after
  // the re-render. Clicking somewhere else (blur) must not pull focus back to the title.
  useEffect(() => {
    if (editing || !restoreTitleFocus.current) return;
    restoreTitleFocus.current = false;
    titleButton.current?.focus();
  }, [editing]);

  function stopEditing({ keepFocus = true } = {}) {
    restoreTitleFocus.current = keepFocus;
    setEditing(false);
    setSaving(false);
  }

  async function saveTitle({ fromBlur = false } = {}) {
    if (saving) return; // Enter and the blur that follows it must not send two PATCHes
    const next = draft.trim();
    if (!next || next === meeting.title) {
      stopEditing({ keepFocus: !fromBlur });
      return;
    }
    setSaving(true);
    try {
      await onRename(next);
      stopEditing({ keepFocus: !fromBlur });
    } catch (err) {
      setSaving(false);
      setError(err.message || "Could not rename this meeting.");
    }
  }

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
        <div className="min-w-0 flex-1">
          <h1 className="min-w-0">
            {editing ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  saveTitle();
                }}
                className="flex items-center gap-2"
              >
                <label htmlFor={titleId} className="sr-only">
                  Meeting title
                </label>
                <input
                  id={titleId}
                  ref={(el) => el?.focus()}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      stopEditing();
                    }
                  }}
                  onBlur={() => saveTitle({ fromBlur: true })}
                  disabled={saving}
                  maxLength={200}
                  autoComplete="off"
                  className={cx(
                    "w-full rounded-lg border border-zinc-300 bg-white px-2 py-1 text-2xl font-semibold tracking-tight text-zinc-900",
                    "dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100",
                    focusRing,
                  )}
                />
              </form>
            ) : (
              <button
                ref={titleButton}
                type="button"
                onClick={startEditing}
                disabled={!onRename}
                title={onRename ? "Rename meeting" : undefined}
                className={cx(
                  "-mx-1 block max-w-full truncate rounded-lg px-1 text-left text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100",
                  onRename && "hover:bg-zinc-100 dark:hover:bg-zinc-800",
                  focusRing,
                )}
              >
                {meeting.title}
              </button>
            )}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {[
              shortDate(meeting.created),
              minutes(meeting.duration),
              people ? `${people} ${people === 1 ? "participant" : "participants"}` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>
    </div>
  );
}
