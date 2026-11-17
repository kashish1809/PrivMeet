import { useSyncExternalStore } from "react";
import { X } from "lucide-react";

import { StatusDot } from "./Badge";
import { cx, focusRing } from "./cx";

// One store for the whole app, so toast() works from anywhere without a context provider.
let toasts = [];
let nextId = 1;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());
const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
// What the dot means, read before the message by screen readers.
const KIND = { red: "Error", amber: "Warning", green: "Done" };

export function dismissToast(id) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** Show a short message: toast("Saved", "green"). Tones are Badge's: gray, blue, amber, green,
 *  red, primary. Gone after 4 s (8 s for red, so an error can be read). Returns its id. */
export function toast(message, tone = "gray") {
  const id = nextId++;
  toasts = [...toasts.slice(-3), { id, message, tone }]; // at most four on screen
  emit();
  setTimeout(() => dismissToast(id), tone === "red" ? 8000 : 4000);
  return id;
}

/** Where toasts appear. Mount once (AppShell does). An aria-live region, so screen readers
 *  read each one without moving focus. */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => toasts);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:left-auto"
    >
      {list.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-xl border border-zinc-200 bg-white py-2.5 pr-2 pl-4 text-sm text-zinc-900 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        >
          <StatusDot tone={t.tone} label={KIND[t.tone] || "Note"} className="shrink-0" />
          <span className="min-w-0 flex-1">{t.message}</span>
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss"
            className={cx("rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800", focusRing)}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
