import { useId, useMemo, useState } from "react";
import { Check, Merge, Users, X } from "lucide-react";

import { mergeSpeakers } from "../api";
import { Avatar, Card, CardHeader, ConfirmDialog, Menu, cx, focusRing } from "../ui";

/**
 * Who spoke, in the right-column card of the mockup: two columns of avatar and name, with
 * the share of the talking time each person had.
 *
 * Clicking a name renames that speaker in place: Enter or leaving the field saves, Escape
 * throws the edit away. The name is saved through the page's onSave, so the transcript,
 * the header and the exports all agree at once.
 *
 * Two controls arrive with later server work and stay hidden until the flag is there:
 * `suggestions` (R1.18) offers "Rename to <name>?" when the summary pass guessed a name,
 * and `speaker-merge` (R1.15) moves every line of one speaker onto another.
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

export default function ParticipantsCard({ meeting, onSave, features }) {
  const [editing, setEditing] = useState(null); // speaker key being renamed
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [merging, setMerging] = useState(null); // { from, to } waiting for the dialog
  const [dismissed, setDismissed] = useState(() => new Set());
  const id = useId();

  const people = useMemo(() => speakers(meeting), [meeting]);
  const suggestions = meeting?.speaker_suggestions || {};
  const canRename = typeof onSave === "function";
  const canMerge = features?.has?.("speaker-merge") && people.length > 1;

  function startRename(person) {
    if (!canRename) return;
    setDraft(person.name);
    setEditing(person.key);
    setError("");
  }

  async function saveName(person, next = draft) {
    if (saving) return;
    const name = next.trim().slice(0, 60);
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

  async function merge() {
    const { from, to } = merging;
    setMerging(null);
    try {
      await mergeSpeakers(meeting.id, from, to);
      // The merge rewrites transcript lines; a reload is the shortest way to show them.
      window.location.reload();
    } catch (e) {
      setError(e.message || "Could not merge those speakers.");
    }
  }

  /** The model's guess, when it has one, the flag is on, and it is not the current name. */
  function suggestionFor(person) {
    if (!features?.has?.("suggestions") || dismissed.has(person.key)) return "";
    const guess = (suggestions[person.key] || "").trim();
    return guess && guess !== person.name ? guess : "";
  }

  return (
    <Card>
      <CardHeader title="Participants" icon={Users} />
      {people.length ? (
        <ul className="grid grid-cols-2 gap-x-3 gap-y-3 px-5 pt-3 pb-5">
          {people.map((person) => {
            const guess = suggestionFor(person);
            return (
              <li key={person.key} className="min-w-0">
                <div className="flex items-center gap-2">
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
                  {canMerge && (
                    <Menu
                      label={`Merge ${person.name} into another speaker`}
                      icon={Merge}
                      items={people
                        .filter((other) => other.key !== person.key)
                        .map((other) => ({
                          label: `Merge into ${other.name}`,
                          onSelect: () => setMerging({ from: person.key, to: other.key }),
                        }))}
                    />
                  )}
                </div>

                {guess && (
                  <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                    Rename to {guess}?
                    <button
                      type="button"
                      onClick={() => saveName(person, guess)}
                      className={cx("inline-flex items-center gap-0.5 rounded text-primary-700 dark:text-primary-300", focusRing)}
                    >
                      <Check className="size-3" aria-hidden="true" /> Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => setDismissed((d) => new Set(d).add(person.key))}
                      className={cx("inline-flex items-center gap-0.5 rounded text-zinc-500 dark:text-zinc-400", focusRing)}
                    >
                      <X className="size-3" aria-hidden="true" /> No
                    </button>
                  </p>
                )}
              </li>
            );
          })}
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

      <ConfirmDialog
        open={!!merging}
        title="Merge speakers?"
        confirmLabel="Merge"
        onConfirm={merge}
        onCancel={() => setMerging(null)}
      >
        {merging &&
          `Every line from ${people.find((p) => p.key === merging.from)?.name} moves to ` +
            `${people.find((p) => p.key === merging.to)?.name}, and the first name is dropped. ` +
            "The transcript text does not change. This cannot be undone."}
      </ConfirmDialog>
    </Card>
  );
}
