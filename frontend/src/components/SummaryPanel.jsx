import { Sparkles } from "lucide-react";

import { Card } from "../ui";

/**
 * Summary tab: one card with "AI Summary" and "Key Points" (decisions), as in the mockup.
 * `meeting` is the full JSON from GET /api/meetings/<id>/; `onSave` is kept for the contract
 * (regenerate lives on the page, R2.12).
 */
export default function SummaryPanel({ meeting }) {
  const summary = (meeting?.summary || "").trim();
  const points = meeting?.decisions ?? [];
  const done = meeting?.status === "done";

  return (
    <Card>
      <div className="flex items-center gap-2 px-5 pt-4">
        <Sparkles className="size-4 text-primary-600 dark:text-primary-400" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">AI Summary</h3>
      </div>
      <p className="px-5 pt-3 text-sm leading-relaxed whitespace-pre-line text-zinc-700 dark:text-zinc-300">
        {summary || (done ? "No summary was written for this meeting." : "The summary appears when processing finishes.")}
      </p>

      <div className="mx-5 mt-4 border-t border-zinc-200 dark:border-zinc-800" />

      <h4 className="px-5 pt-4 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Key Points</h4>
      {points.length ? (
        <ul className="list-disc space-y-2 px-5 pt-3 pb-5 pl-10 text-sm text-zinc-700 marker:text-primary-500 dark:text-zinc-300">
          {points.map((point, i) => (
            <li key={i}>{point}</li>
          ))}
        </ul>
      ) : (
        <p className="px-5 pt-3 pb-5 text-sm text-zinc-500 dark:text-zinc-400">No key points were recorded.</p>
      )}
    </Card>
  );
}
