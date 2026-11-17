import { useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";

import { useFeatures } from "../api";
import { minutes, participants as participantCount, shortDate, statusBadge } from "../format";
import { Badge, LogoMark, Menu, cx, focusRing } from "../ui";
import DownloadMenu from "./DownloadMenu";
import ShareMenu from "./ShareMenu";

const outline =
  "inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 " +
  "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800";

/**
 * Detail page header: the breadcrumb and Share / Download at the top, then the logo tile,
 * title, date · length · participants and the status pill.
 *
 * Share is the ShareMenu: the summary as text, the link, the system share sheet and, when
 * the server has it, the single-file share page. Download is the DownloadMenu: Markdown
 * always, and every other format the server's flags allow.
 *
 * The title is a button: click it (or press Enter on it) to rename the meeting in place.
 * Enter or leaving the field saves, Escape throws the edit away.
 *
 * The kebab next to Download holds "Delete meeting"; the page owns the confirmation and
 * the navigation, so this component only asks.
 *
 */
export default function MeetingHeader({ meeting, onRename, onDelete }) {
  const features = useFeatures();
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
          <ShareMenu meeting={meeting} />
          <DownloadMenu meeting={meeting} features={features} />
          {onDelete && (
            <Menu
              label="Meeting actions"
              items={[{ label: "Delete meeting", icon: Trash2, danger: true, onSelect: onDelete }]}
            />
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex items-start gap-4">
        <LogoMark size={48} />
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
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {[
                shortDate(meeting.created),
                minutes(meeting.duration),
                people ? `${people} ${people === 1 ? "participant" : "participants"}` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <Badge {...statusBadge(meeting)} />
          </div>
        </div>
      </div>
    </div>
  );
}
