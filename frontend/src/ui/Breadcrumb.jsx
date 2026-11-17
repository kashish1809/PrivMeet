import { ArrowLeft, ChevronRight } from "lucide-react";

import { cx, focusRing } from "./cx";

/**
 * "← Meetings > Project Sync". items: [{ label, href }]; the last one is the current page and
 * needs no href. The first item carries the back arrow, as in the mockup.
 *   <Breadcrumb items={[{ label: "Meetings", href: "#/meetings" }, { label: meeting.title }]} />
 */
export function Breadcrumb({ items, className }) {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex min-w-0 items-center gap-1.5 text-sm">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className={cx("flex items-center gap-1.5", last && "min-w-0")}>
              {i > 0 && <ChevronRight className="size-4 shrink-0 text-zinc-400" aria-hidden="true" />}
              {last || !item.href ? (
                <span aria-current={last ? "page" : undefined} className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                  {item.label}
                </span>
              ) : (
                <a
                  href={item.href}
                  className={cx(
                    "inline-flex items-center gap-1.5 rounded-md text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
                    focusRing,
                  )}
                >
                  {i === 0 && <ArrowLeft className="size-4" aria-hidden="true" />}
                  {item.label}
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
