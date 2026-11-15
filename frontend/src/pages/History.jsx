import { History as HistoryIcon } from "lucide-react";

import Placeholder from "../layout/Placeholder";

/** Stub. v2 folds History into the Meetings list: R2.11 adds the date filter and the sort. */
export default function History() {
  return (
    <Placeholder
      title="History"
      icon={HistoryIcon}
      task="R2.11"
      action={
        <a href="#/meetings" className="text-primary-600 underline dark:text-primary-400">
          Open Meetings
        </a>
      }
    >
      A timeline of every meeting. R2.11 puts it on the Meetings list as a date filter (Today,
      Last 7 days, Last 30 days, a custom range) and a sort, rather than a page of its own.
    </Placeholder>
  );
}
