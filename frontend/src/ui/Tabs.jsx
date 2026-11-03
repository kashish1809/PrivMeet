import { useId, useRef } from "react";
import { cx, focusRing } from "./cx";

/**
 * Underlined tabs (Transcript | Summary | Action Items). Controlled: value + onChange.
 * tabs: [{ value, label }]. Arrow keys, Home and End move between tabs (WAI-ARIA tabs pattern).
 * Wire the panel: const id = useId(); <Tabs id={id} …/> <div {...tabPanelProps(id, value)}>…</div>
 */
export function Tabs({ id: idProp, tabs, value, onChange, label, className }) {
  const ownId = useId();
  const id = idProp || ownId;
  const refs = useRef([]);

  function onKeyDown(e) {
    const i = tabs.findIndex((t) => t.value === value);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const j = (next + tabs.length) % tabs.length;
    onChange(tabs[j].value);
    refs.current[j]?.focus();
  }

  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className={cx("flex gap-1 border-b border-zinc-200 dark:border-zinc-800", className)}>
      {tabs.map((t, i) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            ref={(el) => (refs.current[i] = el)}
            type="button"
            role="tab"
            id={`${id}-tab-${t.value}`}
            aria-selected={active}
            aria-controls={`${id}-panel-${t.value}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.value)}
            className={cx(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "border-primary-600 text-primary-700 dark:border-primary-400 dark:text-primary-300"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200",
              focusRing,
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** Props for the panel shown under <Tabs id={id}>: role, id and aria-labelledby. */
export const tabPanelProps = (id, value) => ({
  role: "tabpanel",
  id: `${id}-panel-${value}`,
  "aria-labelledby": `${id}-tab-${value}`,
  tabIndex: 0,
});
