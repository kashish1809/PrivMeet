import { Cpu } from "lucide-react";

import Placeholder from "../layout/Placeholder";

/** Stub: R1.12 builds the models page (R1.11 adds the backend). The model can be picked in Settings. */
export default function Models() {
  return (
    <Placeholder title="Models" icon={Cpu} task="R1.12">
      Download, pick and remove speech and summary models. Until then, choose the model under{" "}
      <a href="#/settings" className="text-primary-600 underline dark:text-primary-400">
        Settings → AI Model
      </a>
      .
    </Placeholder>
  );
}
