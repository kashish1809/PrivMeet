import { CircleDot } from "lucide-react";

import Placeholder from "../layout/Placeholder";

/** Stub: U1.3 builds the recorder (mic, camera, tab audio, controls). */
export default function RecordLive() {
  return (
    <Placeholder title="Record / Live" icon={CircleDot} task="U1.3">
      Record a meeting from your mic and a shared tab, then get notes when you stop.
    </Placeholder>
  );
}
