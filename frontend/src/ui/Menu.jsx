import { useEffect, useId, useRef, useState } from "react";
import { MoreVertical } from "lucide-react";
import { cx, focusRing } from "./cx";
import { IconButton } from "./Button";

/**
 * Kebab menu (Open / Export / Delete). items: [{ label, icon, onSelect, danger }]
 * Keyboard: Enter/Space opens, ArrowUp/Down/Home/End move, Escape closes and returns focus.
 */
export function Menu({ items, label = "More actions", icon = MoreVertical, align = "right", className }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef(null);
  const trigger = useRef(null);
  const itemRefs = useRef([]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    const outside = (e) => !root.current?.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function onKeyDown(e) {
    const i = itemRefs.current.indexOf(document.activeElement);
    const n = items.length;
    const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: n - 1 }[e.key];
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      setOpen(false);
    } else if (next !== undefined) {
      e.preventDefault();
      itemRefs.current[(next + n) % n]?.focus();
    }
  }

  return (
    <div ref={root} className={cx("relative inline-block", className)} onKeyDown={open ? onKeyDown : undefined}>
      <IconButton
        ref={trigger}
        icon={icon}
        label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <div
          id={id}
          role="menu"
          aria-label={label}
          className={cx(
            "absolute z-30 mt-1 min-w-44 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {items.map((item, i) => (
            <button
              key={item.label}
              ref={(el) => (itemRefs.current[i] = el)}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                close();
                item.onSelect();
              }}
              className={cx(
                "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm",
                item.danger
                  ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                  : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800",
                focusRing,
              )}
            >
              {item.icon && <item.icon className="size-4" aria-hidden="true" />}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
