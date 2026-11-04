import { Download, ExternalLink, Trash2 } from "lucide-react";

import { meetingExportUrl } from "../api";
import { Badge, Card, Menu, ProgressBar } from "../ui";
import { duration, isProcessing } from "../format";
import { dayAndTime, timeOfDay } from "./meetingGroups";

/** The export endpoint sends Content-Disposition, so a plain anchor download works. */
function exportMeeting(meeting) {
  const a = document.createElement("a");
  a.href = meetingExportUrl(meeting.id);
  a.download = `${meeting.title}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * One meeting row: title, duration/participants/time, status badge with the progress
 * percentage, and a kebab menu. The title is the link, so the menu button is never
 * nested inside an anchor.
 */
export default function MeetingRow({ meeting, group, onDelete }) {
  // shortcut: the list endpoint returns no speaker count, so participants only shows once
  // names were saved; upgrade when the API returns a per-meeting speaker count (U1.4).
  const participants = Object.keys(meeting.speaker_names || {}).length;
  const when = group === "Older" ? dayAndTime(meeting.created) : timeOfDay(meeting.created);
  const processing = isProcessing(meeting);

  return (
    <Card className="px-4 py-3 sm:px-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <a
            href={`#/m/${meeting.id}`}
            className="block truncate text-sm font-medium text-zinc-900 hover:text-primary-700 dark:text-zinc-100 dark:hover:text-primary-300"
          >
            {meeting.title}
          </a>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {duration(meeting.duration)}
            {participants > 0 && ` · ${participants} participant${participants === 1 ? "" : "s"}`}
            {` · ${when}`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {processing && (
            <span className="text-xs font-medium text-zinc-500 tabular-nums dark:text-zinc-400">
              {meeting.progress}%
            </span>
          )}
          <Badge status={meeting.status} />
          <Menu
            label={`Actions for ${meeting.title}`}
            items={[
              {
                label: "Open",
                icon: ExternalLink,
                onSelect: () => {
                  window.location.hash = `/m/${meeting.id}`;
                },
              },
              { label: "Export", icon: Download, onSelect: () => exportMeeting(meeting) },
              { label: "Delete", icon: Trash2, danger: true, onSelect: () => onDelete(meeting) },
            ]}
          />
        </div>
      </div>

      {processing && <ProgressBar value={meeting.progress} label={`${meeting.title} progress`} className="mt-3" />}
    </Card>
  );
}
