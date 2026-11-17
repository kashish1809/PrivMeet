import { useEffect, useRef, useState } from "react";
import { NotebookPen } from "lucide-react";

import { Card, CardHeader, Textarea } from "../ui";

/**
 * The Notes tab: your own notes for the meeting, saved 800 ms after you stop typing.
 *
 * Every save goes through the page's onSave, the same PATCH the title and the action items
 * use, so the meeting on screen is the one the server has.
 */

// One save per pause in typing, not one per key press.
const SAVE_MS = 800;

export default function NotesTab({ meeting, onSave, features }) {
  const enabled = features?.has?.("notes");
  // Without the flag the PATCH would be rejected, so the editor explains itself instead.
  const [draft, setDraft] = useState(meeting.notes ?? "");
  const [status, setStatus] = useState(""); // "", "saving", "saved", "error"
  const [error, setError] = useState("");

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
      </div>
    </Card>
  );
}
