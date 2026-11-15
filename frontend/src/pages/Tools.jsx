import { AudioLines, CheckSquare, LayoutGrid, ListTree } from "lucide-react";

import Placeholder from "../layout/Placeholder";

/**
 * Stubs for the four Tools screens. v2 moves each one onto the page where the work happens
 * (docs/TASKS.md, "Not in the sidebar any more"), so every entry names the task that delivers
 * it and, where it already exists, links to where it lives now.
 */
export const TOOLS = {
  transcription: {
    title: "Transcription",
    icon: AudioLines,
    task: "R2.10",
    body: "What each meeting is doing while it processes. R2.10 shows the steps - Queued, Converting, Transcribing, Finding speakers, Summarizing - on the meeting itself, with the queue position and a Cancel button.",
    href: "#/meetings",
    hrefLabel: "Open Meetings",
  },
  summarization: {
    title: "Summarization",
    icon: ListTree,
    task: "R2.12",
    body: "Writing the notes again, with another template or another model. R1.14 adds the endpoint that re-runs only the LLM stage, and R2.12 puts Regenerate summary on the meeting page.",
    href: "#/settings",
    hrefLabel: "Choose the model in Settings",
  },
  actions: {
    title: "Action Items",
    icon: CheckSquare,
    task: "U1.4",
    done: true,
    body: "Already built. Every open action item across meetings is on Home, from GET /api/action-items/, and each meeting has its own Action Items tab.",
    href: "#/",
    hrefLabel: "See them on Home",
  },
  integrations: {
    title: "Integrations",
    icon: LayoutGrid,
    task: "R2.5",
    body: "Getting the notes out. R1.13 adds the export formats (txt, json, srt, vtt, docx, odt, ics, mp3) and the share page; R2.5 and R2.6 put them behind Download and Share on the meeting.",
    href: "#/meetings",
    hrefLabel: "Open Meetings",
  },
};

export default function Tools({ tool }) {
  const t = TOOLS[tool];
  if (!t) return null;
  return (
    <Placeholder
      title={t.title}
      icon={t.icon}
      task={t.done ? `${t.task} — already built` : t.task}
      action={
        <a href={t.href} className="text-primary-600 underline dark:text-primary-400">
          {t.hrefLabel}
        </a>
      }
    >
      {t.body}
    </Placeholder>
  );
}
