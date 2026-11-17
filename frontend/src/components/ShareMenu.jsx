import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Link2, Share2 } from "lucide-react";

import { toast, cx, focusRing } from "../ui";

/**
 * The Share menu of the meeting header.
 *
 * "Copy summary" puts the notes into the clipboard as plain text, ready to paste into an
 * email; "Copy link" is the page's address, which only opens on this computer.
 */

const outline =
  "inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-50 " +
  "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800";

/** "Oct 28, 2026" in the visitor's locale, no time. */
function day(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Everything the meeting is worth, as plain text: the shape you can paste into an email
 * without the reader needing PrivMeet. Empty sections are left out rather than left blank.
 */
export function summaryText(meeting) {
  const out = [meeting.title || "Meeting"];
  const meta = [day(meeting.created), meeting.duration ? `${Math.round(meeting.duration / 60)} min` : ""]
    .filter(Boolean)
    .join(" · ");
  if (meta) out.push(meta);

  if (meeting.summary?.trim()) out.push("", "Summary", meeting.summary.trim());

  const points = (meeting.decisions || []).filter((d) => String(d).trim());
  if (points.length) out.push("", "Key points", ...points.map((point) => `- ${String(point).trim()}`));

  const items = (meeting.action_items || []).filter((item) => (item.task || "").trim());
  if (items.length) {
    out.push("", "Action items");
    for (const item of items) {
      const who = [item.owner, item.due].map((v) => (v || "").trim()).filter(Boolean).join(", ");
      out.push(`- [${item.done ? "x" : " "}] ${item.task.trim()}${who ? ` (${who})` : ""}`);
    }
  }

  return out.join("\n");
}

/**
 * Copy through the clipboard API when the page is a secure context, and through a hidden
 * textarea with execCommand otherwise: http://127.0.0.1 is not secure on every browser,
 * and this app is served from there.
 */
export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const box = document.createElement("textarea");
  box.value = text;
  box.setAttribute("readonly", "");
  box.style.position = "fixed";
  box.style.opacity = "0";
  document.body.appendChild(box);
  box.select();
  const ok = document.execCommand("copy");
  box.remove();
  if (!ok) throw new Error("copy was refused");
}

export default function ShareMenu({ meeting, className }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState("");
  const id = useId();
  const root = useRef(null);
  const trigger = useRef(null);
  const itemRefs = useRef([]);

  function copy(what, text, message) {
    setOpen(false);
    copyText(text)
      .then(() => {
        setCopied(message);
        window.setTimeout(() => setCopied(""), 2500);
      })
      .catch(() => toast(`Could not copy the ${what}. Select it and copy it by hand.`, "red"));
  }

  const items = [
    {
      label: "Copy summary",
      icon: Share2,
      onSelect: () => copy("summary", summaryText(meeting), "Copied summary"),
    },
    {
      label: "Copy link",
      icon: Link2,
      hint: "Opens only on this computer",
      onSelect: () => copy("link", window.location.href, "Copied link"),
    },
  ];

  const positions = items.map((item, i) => (item.disabled ? -1 : i)).filter((i) => i >= 0);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[positions[0]]?.focus();
    const outside = (e) => !root.current?.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
    // Only on open: the entries change with the meeting's flags, not while the menu is open.
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
    try {
      await item.onSelect();
    } catch (e) {
      toast(e.message || `Could not ${item.label.toLowerCase()}.`, "red");
    }
  }

  return (
    <div ref={root} className={cx("relative inline-block", className)} onKeyDown={open ? onKeyDown : undefined}>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        className={cx(outline, focusRing)}
      >
        {copied ? <Check className="size-4" aria-hidden="true" /> : <Share2 className="size-4" aria-hidden="true" />}
        {copied || "Share"}
        <ChevronDown className="size-3.5" aria-hidden="true" />
      </button>
      {/* The label changes back after 2.5 s, so the copy is announced here instead. */}
      <span aria-live="polite" className="sr-only">
        {copied}
      </span>

      {open && (
        <div
          id={id}
          role="menu"
          aria-label="Share"
          className={cx(
            // Left-aligned: Share is the first button of the header group, so on a phone the
            // group wraps to the left edge and a right-aligned panel would hang off the screen.
            "absolute left-0 z-30 mt-1 min-w-56 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg",
            "dark:border-zinc-700 dark:bg-zinc-900",
          )}
        >
          {items.map((item, i) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                ref={(el) => (itemRefs.current[i] = el)}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => choose(item)}
                className={cx(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800",
                  focusRing,
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span className="flex-1">
                  {item.label}
                  {item.hint && <span className="block text-[11px] text-zinc-400 dark:text-zinc-500">{item.hint}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
