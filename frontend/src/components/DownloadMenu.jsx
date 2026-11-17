import { useEffect, useId, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  Download,
  FileAudio,
  FileJson,
  FileText,
  FileType,
  Music,
  Subtitles,
  Table,
} from "lucide-react";

import { exportUrl, meetingAudioUrl } from "../api";
import { IconButton, toast, cx, focusRing } from "../ui";
import { actionItemRows, downloadCsv, fileName, saveBlob, transcriptRows } from "./exportCsv";

/**
 * The Download menu: every format the meeting can leave in, grouped by what it is.
 *
 * Markdown needs nothing from the server beyond the export endpoint every version has; the
 * rest is shown only when GET /api/system/ lists the flag that adds it, so a menu never
 * offers a file the running server cannot make. Empty groups are dropped.
 */

const outline =
  "inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 " +
  "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800";

/** The original upload, named from the type the server sends back. */
const EXTENSIONS = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "video/quicktime": "mov",
};

/** Follow a download link the way a click does. */
function follow(url) {
  const a = document.createElement("a");
  a.href = url;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Fetch, then save. This is what gives the slow entries a spinner - the MP3 and the Opus
 * are converted on the server before the first byte arrives - and the original audio the
 * extension its content type implies.
 */
async function downloadFile(url, title, fallbackExt) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) {
    let message = "Could not download that file.";
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      // an HTML or empty error body: keep the generic message
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const type = (blob.type || "").split(";")[0];
  saveBlob(blob, fileName(title, EXTENSIONS[type] || fallbackExt));
}

/**
 * "Friday", "today", "Oct 30", "the 14th" and the like may become a calendar to-do; "end of
 * quarter" cannot. This only decides whether the Calendar entry looks worth offering - the
 * server decides for real, and its message is shown when it says no.
 */
export function hasDatedActionItem(meeting) {
  const relative =
    /^(today|tomorrow|tonight|mon(day)?|tue(sday)?|wed(nesday)?|thu(rsday)?|fri(day)?|sat(urday)?|sun(day)?|next week|next month|the \d{1,2}(st|nd|rd|th)?)\b/i;
  const monthDay =
    /\b(\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2})\b/i;
  return (meeting?.action_items || []).some((item) => {
    const due = (item.due || "").trim();
    return relative.test(due) || monthDay.test(due);
  });
}

/** Every group of downloads for this meeting, in menu order. */
export function downloadGroups(meeting, features) {
  const has = (key) => !!features?.has?.(key);
  const id = meeting?.id;
  const groups = [];

  const notes = [{ label: "Markdown (.md)", icon: FileText, onSelect: () => follow(exportUrl(id, "md")) }];
  if (has("exports")) {
    notes.push({ label: "Plain text (.txt)", icon: FileText, onSelect: () => follow(exportUrl(id, "txt")) });
    notes.push({ label: "JSON (.json)", icon: FileJson, onSelect: () => follow(exportUrl(id, "json")) });
  }
  if (has("exports-office")) {
    notes.push({ label: "Word (.docx)", icon: FileType, onSelect: () => follow(exportUrl(id, "docx")) });
    notes.push({ label: "OpenDocument (.odt)", icon: FileType, onSelect: () => follow(exportUrl(id, "odt")) });
  }
  groups.push({ key: "notes", label: "Notes", items: notes });

  const transcript = [
    { label: "Transcript (CSV)", icon: Table, onSelect: () => downloadCsv(fileName(meeting.title, "transcript.csv"), transcriptRows(meeting)) },
  ];
  if (has("exports")) {
    transcript.push({ label: "Subtitles (SRT)", icon: Subtitles, onSelect: () => follow(exportUrl(id, "srt")) });
    transcript.push({ label: "Subtitles (VTT)", icon: Subtitles, onSelect: () => follow(exportUrl(id, "vtt")) });
  }
  groups.push({ key: "transcript", label: "Transcript", items: transcript });

  const items = meeting?.action_items || [];
  const actions = [];
  if (items.length) {
    actions.push({
      label: "Action items (CSV)",
      icon: Table,
      onSelect: () => downloadCsv(fileName(meeting.title, "action-items.csv"), actionItemRows(meeting)),
    });
  }
  if (has("exports-ics")) {
    actions.push({
      label: "Calendar (.ics)",
      icon: CalendarDays,
      disabled: !items.length || !hasDatedActionItem(meeting),
      hint: "No action item has a date",
      // Fetched rather than followed: when no due date resolves, the server answers 404 with
      // the reason, and that message is worth showing.
      onSelect: () => downloadFile(exportUrl(id, "ics"), meeting.title, "ics"),
    });
  }
  groups.push({ key: "actions", label: "Action items", items: actions });

  const audio = [];
  if (meeting?.has_audio !== false) {
    audio.push({
      label: "Audio file (original)",
      icon: FileAudio,
      onSelect: () => downloadFile(meetingAudioUrl(id), meeting.title, "audio"),
    });
  }
  if (has("audio-exports")) {
    audio.push({ label: "Audio (MP3)", icon: Music, slow: true, onSelect: () => downloadFile(exportUrl(id, "mp3"), meeting.title, "mp3") });
    audio.push({ label: "Audio (Opus, smallest)", icon: Music, slow: true, onSelect: () => downloadFile(exportUrl(id, "opus"), meeting.title, "opus") });
  }
  groups.push({ key: "audio", label: "Audio", items: audio });

  return groups.filter((group) => group.items.length);
}

export default function DownloadMenu({ meeting, features, variant = "button", className }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const id = useId();
  const root = useRef(null);
  const trigger = useRef(null);
  const itemRefs = useRef([]);

  const groups = downloadGroups(meeting, features);
  const rows = groups.flatMap((group) => group.items);
  // Each entry's place in the flat list, so its ref lands in the right slot.
  const place = new Map(rows.map((row, i) => [row, i]));
  // Only the entries that can be chosen take part in keyboard movement.
  const positions = rows.map((row, i) => (row.disabled ? -1 : i)).filter((i) => i >= 0);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[positions[0]]?.focus();
    const outside = (e) => !root.current?.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
    // Only when the menu opens or closes; positions change with the flags, not mid-menu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function onKeyDown(e) {
    const at = positions.indexOf(itemRefs.current.indexOf(document.activeElement));
    const n = positions.length;
    const step = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: n - 1 }[e.key];
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      setOpen(false);
    } else if (step !== undefined) {
      e.preventDefault();
      itemRefs.current[positions[(step + n) % n]]?.focus();
    }
  }

  async function choose(item) {
    setOpen(false);
    if (item.slow) setBusy(item.label);
    try {
      await item.onSelect();
    } catch (e) {
      toast(e.message || `Could not download ${item.label}.`, "red");
    } finally {
      // The download itself runs after this resolves; the spinner is for the wait before it.
      setBusy("");
    }
  }

  return (
    <div ref={root} className={cx("relative inline-block", className)} onKeyDown={open ? onKeyDown : undefined}>
      {variant === "button" ? (
        <button
          ref={trigger}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={() => setOpen((o) => !o)}
          className={cx(outline, focusRing)}
        >
          {busy ? (
            <span
              aria-label="Preparing the download"
              className="size-4 animate-spin rounded-full border-2 border-zinc-300 border-t-primary-600 dark:border-zinc-600 dark:border-t-primary-400"
            />
          ) : (
            <Download className="size-4" aria-hidden="true" />
          )}
          Download
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </button>
      ) : (
        <IconButton
          ref={trigger}
          icon={Download}
          label={`Download ${meeting.title}`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={() => setOpen((o) => !o)}
        />
      )}

      {open && (
        <div
          id={id}
          role="menu"
          aria-label="Download"
          className={cx(
            "absolute right-0 z-30 mt-1 min-w-56 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg",
            "dark:border-zinc-700 dark:bg-zinc-900",
          )}
        >
          {groups.map((group) => (
            <div key={group.key} role="group" aria-label={group.label} className="py-0.5">
              <p
                aria-hidden="true"
                className="px-3 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-zinc-400 uppercase dark:text-zinc-500"
              >
                {group.label}
              </p>
              {group.items.map((item) => {
                const at = place.get(item);
                const ref = (el) => (itemRefs.current[at] = el);
                const Icon = item.icon || FileText;
                return (
                  <button
                    key={item.label}
                    ref={ref}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    aria-disabled={item.disabled || undefined}
                    disabled={item.disabled}
                    onClick={() => choose(item)}
                    className={cx(
                      "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm",
                      item.disabled
                        ? "cursor-not-allowed text-zinc-400 dark:text-zinc-600"
                        : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800",
                      focusRing,
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    <span className="flex-1">
                      {item.label}
                      {item.disabled && item.hint && (
                        <span className="block text-[11px] text-zinc-400 dark:text-zinc-500">{item.hint}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
