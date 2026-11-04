import { History as HistoryIcon } from "lucide-react";

import Placeholder from "../layout/Placeholder";

/** Stub: U1.5 adds the month-by-month timeline with questions asked. */
export default function History() {
  return (
    <Placeholder title="History" icon={HistoryIcon} task="U1.5">
      A timeline of every meeting and the questions you asked about it.
    </Placeholder>
  );
}
