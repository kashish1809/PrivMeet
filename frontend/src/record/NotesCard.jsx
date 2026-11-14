import { useState } from "react";
import { NotebookPen } from "lucide-react";

import { Card, CardHeader, Input, TagChip, Textarea } from "../ui";

const MAX_TAGS = 10;
const MAX_TAG = 30;

/**
 * Title, notes and tags typed while recording. They go up with the recording as `title`,
 * `notes` and `tags`; the server keeps the last two once U1.4 is merged.
 */
export default function NotesCard({ title, notes, tags, onChange, disabled }) {
  const [draft, setDraft] = useState("");

  function addTag() {
    const tag = draft.trim().slice(0, MAX_TAG);
    setDraft("");
    if (!tag || tags.includes(tag) || tags.length >= MAX_TAGS) return;
    onChange({ tags: [...tags, tag] });
  }

  return (
    <Card>
      <CardHeader title="Meeting notes" icon={NotebookPen} />
      <div className="flex flex-col gap-4 px-5 pt-3 pb-5">
        <Input
          label="Title"
          value={title}
          maxLength={200}
          onChange={(e) => onChange({ title: e.target.value })}
          disabled={disabled}
        />
        <Textarea
          label="Notes"
          rows={5}
          placeholder="Add meeting notes…"
          value={notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          disabled={disabled}
        />
        <div className="flex flex-col gap-2">
          <Input
            label="Tags"
            placeholder={tags.length >= MAX_TAGS ? "10 tags at most" : "Type a tag, press Enter"}
            value={draft}
            maxLength={MAX_TAG}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addTag();
              }
            }}
            onBlur={addTag}
            disabled={disabled || tags.length >= MAX_TAGS}
          />
          {tags.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
              {tags.map((t) => (
                <li key={t}>
                  <TagChip onRemove={disabled ? undefined : () => onChange({ tags: tags.filter((x) => x !== t) })}>{t}</TagChip>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
