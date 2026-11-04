import { Settings as SettingsIcon } from "lucide-react";

import Placeholder from "../layout/Placeholder";

/** Stub: U1.5 adds the General, AI Model, Recording and Appearance tabs. */
export default function Settings() {
  return (
    <Placeholder title="Settings" icon={SettingsIcon} task="U1.5">
      Model, server URL, recording defaults and theme.
    </Placeholder>
  );
}
