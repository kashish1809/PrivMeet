/** Day buckets for the meetings list: Today, Yesterday, Last week (2-7 days) and Older. */

const DAY = 24 * 60 * 60 * 1000;

/** Local midnight of the day `date` falls on, so "Today" is the user's today, not UTC. */
function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Split meetings into dated sections, newest first inside each one.
 * Returns [[label, meetings], ...] with empty sections dropped.
 */
export function groupByDay(meetings, now = new Date()) {
  const today = startOfDay(now);
  const buckets = { Today: [], Yesterday: [], "Last week": [], Older: [] };

  for (const m of meetings) {
    const days = Math.round((today - startOfDay(new Date(m.created))) / DAY);
    const label = days <= 0 ? "Today" : days === 1 ? "Yesterday" : days <= 7 ? "Last week" : "Older";
    buckets[label].push(m);
  }

  return Object.entries(buckets).filter(([, items]) => items.length > 0);
}

/** "10:00 AM" — the section header already carries the day. */
export function timeOfDay(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "Oct 28, 2026 · 10:00 AM" for the sections that span several days. */
export function dayAndTime(iso) {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${day} · ${timeOfDay(iso)}`;
}
