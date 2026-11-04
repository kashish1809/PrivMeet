import { House, Mic, Upload } from "lucide-react";

import Placeholder from "../layout/Placeholder";
import { Button } from "../ui";

/** Stub: U1.4 adds recent meetings, open action items and the Local AI card. */
export default function Home() {
  return (
    <Placeholder
      title="Home"
      icon={House}
      task="U1.4"
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button icon={Mic} onClick={() => (window.location.hash = "/record")}>Record</Button>
          <Button icon={Upload} variant="secondary" onClick={() => (window.location.hash = "/new")}>
            Upload
          </Button>
        </div>
      }
    >
      Recent meetings and open action items will show here.
    </Placeholder>
  );
}
