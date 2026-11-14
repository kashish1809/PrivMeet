import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";

import { isProcessing } from "../format";
import { Button, Card, ProgressBar } from "../ui";

// The stage the worker is in, in the words the rest of the app uses (see ui/Badge.jsx).
const STAGES = {
  queued: "Queued",
  converting: "Converting the audio",
  transcribing: "Transcribing",
  diarizing: "Finding speakers",
  summarizing: "Writing the notes",
};

/**
 * What the pipeline is doing, or why it stopped. One card:
 * - processing: the stage, a progress bar and the percentage.
 * - failed: the error and a Retry button.
 * - done: nothing at all.
 * R2.10 replaces this with the full step list, queue position, cancel and notifications.
 */
export default function ProcessingStatus({ meeting, onRetry }) {
  const processing = isProcessing(meeting);
  const failed = meeting.status === "failed";

  if (!processing && !failed) return null;

  if (failed) {
    return (
      <Card className="flex flex-wrap items-start justify-between gap-3 border-red-200 px-5 py-4 dark:border-red-900">
        <div className="flex min-w-0 items-start gap-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-red-700 dark:text-red-300">Processing failed</h2>
            <p role="alert" className="mt-1 text-sm break-words text-red-700 dark:text-red-300">
              {meeting.error || "The worker stopped without saying why."}
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Retry runs the whole pipeline again from the uploaded file.
            </p>
          </div>
        </div>
        <Button variant="secondary" icon={RotateCcw} onClick={onRetry}>
          Retry
        </Button>
      </Card>
    );
  }

  const stage = STAGES[meeting.status] || "Processing";
  return (
    <Card className="px-5 py-4">
      <div className="flex items-center gap-2">
        <Loader2 className="size-4 shrink-0 animate-spin text-primary-600 dark:text-primary-400" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{stage}</h2>
        <span className="ml-auto text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
          {Math.round(meeting.progress || 0)}%
        </span>
      </div>
      <ProgressBar value={meeting.progress} label={`${stage} progress`} className="mt-3" />
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        Everything runs on this machine. The transcript and notes appear here as each stage finishes.
      </p>
    </Card>
  );
}
