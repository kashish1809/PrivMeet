import { useId, useMemo, useState } from "react";
import { Users } from "lucide-react";

import { Avatar, Card, CardHeader, cx, focusRing } from "../ui";

/**
 * Who spoke, in the right-column card of the mockup: two columns of avatar and name, with
 * the share of the talking time each person had.
 *
 * Clicking a name renames that speaker in place: Enter or leaving the field saves, Escape
 * throws the edit away. The name is saved through the page's onSave, so the transcript,
 * the header and the exports all agree at once.
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

export default function ParticipantsCard({ meeting, onSave }) {
  const [editing, setEditing] = useState(null); // speaker key being renamed
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const id = useId();

  const people = useMemo(() => speakers(meeting), [meeting]);
  const canRename = typeof onSave === "function";

  function startRename(person) {
    if (!canRename) return;
    setDraft(person.name);
    setEditing(person.key);
    setError("");
  }

  async function saveName(person) {
    if (saving) return;
    const name = draft.trim().slice(0, 60);
    if (!name || name === person.name) {
      setEditing(null);
      return;
    }
    setSaving(true);
    try {
      // The whole map goes back. PATCH merges keys, so a single entry is enough, but
      // sending it whole means two renames in a row cannot half-apply.
      await onSave({ speaker_names: { ...(meeting.speaker_names || {}), [person.key]: name } });
      setEditing(null);
      setError("");
    } catch (e) {
      setError(e.message || "Could not rename this speaker.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Participants" icon={Users} />
      {people.length ? (
        <ul className="grid grid-cols-2 gap-x-3 gap-y-3 px-5 pt-3 pb-5">
          {people.map((person) => (
            <li key={person.key} className="flex min-w-0 items-center gap-2">
              <Avatar name={person.name} colorKey={person.key} size="sm" />
              <div className="min-w-0 flex-1">
                {editing === person.key ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      saveName(person);
                    }}
                  >
                    <label htmlFor={`${id}-${person.key}`} className="sr-only">
                      Name for {person.name}
                    </label>
                    <input
                      id={`${id}-${person.key}`}
                      autoFocus
                      value={draft}
                      maxLength={60}
                      disabled={saving}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => saveName(person)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setEditing(null);
                        }
                      }}
                      className={cx(
                        "w-full min-w-0 rounded border border-zinc-300 bg-white px-1 py-0.5 text-sm text-zinc-900",
                        "dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100",
                        focusRing,
                      )}
                    />
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => startRename(person)}
                    disabled={!canRename}
                    title={canRename ? `Rename ${person.name}` : undefined}
                    className={cx(
                      "block max-w-full truncate rounded text-left text-sm text-zinc-700 dark:text-zinc-300",
                      canRename && "hover:text-primary-700 dark:hover:text-primary-300",
                      focusRing,
                    )}
                  >
                    {person.name}
                  </button>
                )}
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

      {error && (
        <p role="alert" className="px-5 pb-4 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </Card>
  );
}
