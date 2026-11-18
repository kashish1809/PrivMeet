import { useEffect, useId, useRef, useState } from "react";
import { NotebookPen, Tag } from "lucide-react";

import { Card, CardHeader, TagChip, Textarea, cx, focusRing } from "../ui";

/**
 * The Notes tab: your own notes for the meeting, saved 800 ms after you stop typing.
 *
 * Every save goes through the page's onSave, the same PATCH the title and the action items
 * use, so the meeting on screen is the one the server has.
 *
 * Leaving the field, switching tab, going to another page or closing the window all save
 * first: the debounce is a convenience, not the only way the text reaches the server.
 *
 * Tags sit under the editor: Enter adds one, the chip's x removes it. Both save at once,
 * because a tag is a single decision rather than a held edit.
 */

// One save per pause in typing, not one per key press.
const SAVE_MS = 800;
// The server's limits (native/server/src/meetings.rs: MAX_TAGS, MAX_TAG_LEN); checked here too so
// the user is told before a request is refused.
const MAX_TAGS = 10;
const MAX_TAG_LEN = 30;

export default function NotesTab({ meeting, onSave, features }) {
  const enabled = features?.has?.("notes");
  const id = useId();
  // Without the flag the PATCH would be rejected, so the editor explains itself instead.
  const [draft, setDraft] = useState(meeting.notes ?? "");
  const [status, setStatus] = useState(""); // "", "saving", "saved", "error"
  const [error, setError] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [tagError, setTagError] = useState("");

  const tags = meeting.tags || [];
  const canTag = features?.has?.("tags");
  const saved = useRef(meeting.notes ?? "");
  const latest = useRef(draft);
  latest.current = draft;

  /** Write the notes back if they differ from what the server has. */
  async function save() {
    const notes = latest.current;
    if (!enabled || notes === saved.current) return;
    setStatus("saving");
    try {
      await onSave({ notes });
      saved.current = notes;
      setStatus("saved");
      setError("");
    } catch (e) {
      setStatus("error");
      setError(e.message || "Could not save the notes.");
    }
  }

  /** Add what is in the tag field: trimmed, capped, no duplicates, at most ten. */
  async function addTag() {
    const name = tagDraft.trim();
    if (!name) return;
    if (name.length > MAX_TAG_LEN) {
      setTagError(`A tag can be at most ${MAX_TAG_LEN} characters.`);
      return;
    }
    if (tags.some((t) => t.toLowerCase() === name.toLowerCase())) {
      setTagDraft("");
      return;
    }
    if (tags.length >= MAX_TAGS) {
      setTagError(`A meeting can have at most ${MAX_TAGS} tags.`);
      return;
    }
    setTagError("");
    try {
      await onSave({ tags: [...tags, name] });
      setTagDraft("");
    } catch (e) {
      setTagError(e.message || "Could not add that tag.");
    }
  }

  async function removeTag(name) {
    setTagError("");
    try {
      await onSave({ tags: tags.filter((t) => t !== name) });
    } catch (e) {
      setTagError(e.message || "Could not remove that tag.");
    }
  }

  // Saved on the way out through whichever path the browser takes.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const flush = () => saveRef.current();
    const onHide = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
      flush(); // unmounting: another tab, the summary, the list
    };
  }, []);

  // A poll or another tab may bring new notes in; take them unless this editor is dirty.
  useEffect(() => {
    const incoming = meeting.notes ?? "";
    if (incoming === saved.current || latest.current !== saved.current) return;
    saved.current = incoming;
    setDraft(incoming);
  }, [meeting.notes]);

  useEffect(() => {
    if (!enabled || draft === saved.current) return;
    const timer = setTimeout(save, SAVE_MS);
    return () => clearTimeout(timer);
    // save() reads the newest draft from the ref, so draft is the only dependency that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, enabled]);

  return (
    <Card>
      <CardHeader
        title="Notes"
        icon={NotebookPen}
        actions={
          enabled ? (
            <span aria-live="polite" className="text-xs text-zinc-500 dark:text-zinc-400">
              {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : ""}
            </span>
          ) : null
        }
      />
      <div className="px-5 pt-3 pb-5">
        <Textarea
          label="Your notes"
          rows={14}
          value={draft}
          disabled={!enabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          placeholder="Write down what you want to remember, or what to do next…"
          hint={
            enabled
              ? "Saved automatically while you type."
              : "Notes need a newer PrivMeet server."
          }
        />
        {error && (
          <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        {canTag && (
          <div className="mt-5">
            <p className="flex items-center gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              <Tag className="size-4 text-primary-600 dark:text-primary-400" aria-hidden="true" />
              Tags
            </p>
            {tags.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {tags.map((name) => (
                  <li key={name}>
                    <TagChip onRemove={enabled ? () => removeTag(name) : undefined}>{name}</TagChip>
                  </li>
                ))}
              </ul>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                addTag();
              }}
              className="mt-2 flex flex-col gap-1"
            >
              <label htmlFor={`${id}-tag`} className="sr-only">
                Add a tag
              </label>
              <input
                id={`${id}-tag`}
                value={tagDraft}
                maxLength={MAX_TAG_LEN}
                disabled={!enabled || tags.length >= MAX_TAGS}
                onChange={(e) => {
                  setTagDraft(e.target.value);
                  setTagError("");
                }}
                placeholder={tags.length >= MAX_TAGS ? `${MAX_TAGS} tags is the limit` : "Add a tag, then Enter"}
                className={cx(
                  "h-9 w-full max-w-xs rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900",
                  "placeholder:text-zinc-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30",
                  "disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500",
                  focusRing,
                )}
              />
            </form>
            {tagError && (
              <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
                {tagError}
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
