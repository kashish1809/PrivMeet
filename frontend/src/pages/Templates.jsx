import { LayoutTemplate } from "lucide-react";

import Placeholder from "../layout/Placeholder";

/** Stub: R1.10 builds the note templates page (R1.9 adds the backend). */
export default function Templates() {
  return (
    <Placeholder title="Templates" icon={LayoutTemplate} task="R1.10">
      Note templates (Stand-up, One-on-one, Client call…) that steer what the summary focuses on.
    </Placeholder>
  );
}
