import { useMemo } from "react";
import { Users } from "lucide-react";

import { Avatar, Card, CardHeader } from "../ui";

/**
 * Who spoke, in the right-column card of the mockup: two columns of avatar and name, with
 * the share of the talking time each person had.
 */

/** Everyone who spoke, in order of first appearance, with talking time and share of it. */
export function speakers(meeting) {
  const seen = new Map();
  let total = 0;
  for (const s of meeting?.segments || []) {
    const length = Math.max(0, (s.end || 0) - (s.start || 0));
    total += length;
    if (s.speaker === null || s.speaker === undefined) continue;
    const entry = seen.get(s.speaker) || { key: s.speaker, seconds: 0 };
    entry.seconds += length;
    seen.set(s.speaker, entry);
  }
  return [...seen.values()].map((e) => ({
    ...e,
    name: meeting?.speaker_names?.[e.key] || `Speaker ${e.key + 1}`,
    share: total ? Math.round((e.seconds / total) * 100) : 0,
  }));
}

/** "0:42" / "12:05" - a shorter form of format.js duration() for a tight two-column card. */
function talkTime(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function ParticipantsCard({ meeting }) {
  const people = useMemo(() => speakers(meeting), [meeting]);

  return (
    <Card>
      <CardHeader title="Participants" icon={Users} />
      {people.length ? (
        <ul className="grid grid-cols-2 gap-x-3 gap-y-3 px-5 pt-3 pb-5">
          {people.map((person) => (
            <li key={person.key} className="flex min-w-0 items-center gap-2">
              <Avatar name={person.name} colorKey={person.key} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-zinc-700 dark:text-zinc-300">{person.name}</p>
                <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                  {person.share}% · {talkTime(person.seconds)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 pt-3 pb-5 text-sm text-zinc-500 dark:text-zinc-400">
          {meeting?.status && meeting.status !== "done" && meeting.status !== "failed"
            ? "Speakers appear after the transcript is ready."
            : "No speakers were detected."}
        </p>
      )}
    </Card>
  );
}
