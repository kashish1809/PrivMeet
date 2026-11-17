import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Download, FileJson, FileText, FileType } from "lucide-react";

import { exportUrl } from "../api";
import { IconButton, toast, cx, focusRing } from "../ui";

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

/** Follow a download link the way a click does. */
function follow(url) {
  const a = document.createElement("a");
  a.href = url;
  document.body.appendChild(a);
  a.click();
  a.remove();
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

  return groups.filter((group) => group.items.length);
}

export default function DownloadMenu({ meeting, features, variant = "button", className }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef(null);
  const trigger = useRef(null);
  const itemRefs = useRef([]);

  const groups = downloadGroups(meeting, features);
  const rows = groups.flatMap((group) => group.items);
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

  function choose(item) {
    setOpen(false);
    try {
      const result = item.onSelect();
      if (result?.catch) {
        result.catch((e) => toast(e.message || `Could not download ${item.label}.`, "red"));
      }
    } catch (e) {
      toast(e.message || `Could not download ${item.label}.`, "red");
    }
  }

  let index = -1;

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
          <Download className="size-4" aria-hidden="true" />
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
                index += 1;
                const ref = (el) => (itemRefs.current[index] = el);
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
                    <span className="flex-1">{item.label}</span>
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
