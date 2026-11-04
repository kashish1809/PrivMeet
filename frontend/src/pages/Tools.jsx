import { AudioLines, Blocks, SquareCheckBig, TextQuote } from "lucide-react";

import Placeholder from "../layout/Placeholder";

// Keys are the #/tools/<key> routes; the sidebar uses the same titles and icons.
export const TOOLS = {
  transcription: { title: "Transcription", icon: AudioLines, hint: "Processing queue and progress." },
  summarization: { title: "Summarization", icon: TextQuote, hint: "Re-run a summary with the current model." },
  "action-items": { title: "Action Items", icon: SquareCheckBig, hint: "Every action item across meetings." },
  integrations: { title: "Integrations", icon: Blocks, hint: "Export Markdown or JSON, copy a summary." },
};

/** Stub: U1.5 builds the four tool pages. */
export default function Tools({ tool }) {
  const { title, icon, hint } = TOOLS[tool];
  return (
    <Placeholder title={title} icon={icon} task="U1.5">
      {hint}
    </Placeholder>
  );
}
