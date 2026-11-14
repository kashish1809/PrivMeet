import { useCallback, useEffect, useId, useState } from "react";
import { NotebookPen, Users } from "lucide-react";

import { deleteMeeting, getMeeting, patchMeeting, retryMeeting } from "../api";
import { isProcessing } from "../format";
import { Avatar, Button, Card, CardHeader, ConfirmDialog, EmptyState, Tabs, tabPanelProps } from "../ui";
import { navigate, useRoute } from "../App";
import ActionItemsPanel from "../components/ActionItemsPanel";
import MeetingHeader from "../components/MeetingHeader";
import ProcessingStatus from "../components/ProcessingStatus";
import SummaryPanel from "../components/SummaryPanel";
import TranscriptPanel from "../components/TranscriptPanel";

const POLL_MS = 2000;

const TABS = [
  { value: "summary", label: "Summary" },
  { value: "transcript", label: "Transcript" },
  { value: "actions", label: "Action Items" },
  { value: "notes", label: "Notes" },
];

/** Everyone the transcript mentions, in speaking order, with the saved name when there is one. */
function participants(meeting) {
  const seen = new Map();
  for (const s of meeting.segments || []) {
    if (s.speaker === null || s.speaker === undefined || seen.has(s.speaker)) continue;
    seen.set(s.speaker, meeting.speaker_names?.[s.speaker] || `Speaker ${s.speaker + 1}`);
  }
  return [...seen.entries()].map(([key, name]) => ({ key, name }));
}

/**
 * Meeting detail, laid out like docs/ui/mockup.webp: breadcrumb and Share/Download, the
 * logo tile and title, then Summary | Transcript | Action Items | Notes with the compact
 * action items and the participants in the right column.
 *
 * The page polls every 2 s while the pipeline works. `?t=<seconds>` opens the Transcript
 * tab and seeks there. R2.3 replaces the participants list, R2.4 fills in the Notes tab.
 */
export default function MeetingDetail({ id }) {
  const { query } = useRoute();
  const [meeting, setMeeting] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("summary");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const tabsId = useId();

  const startAt = Math.max(0, Number(query.get("t")) || 0);

  const load = useCallback(() => {
    getMeeting(id)
      .then((m) => {
        setMeeting(m);
        setError("");
      })
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll every 2 s only while the pipeline is still working (AGENTS.md project rules).
  useEffect(() => {
    if (!isProcessing(meeting)) return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [meeting?.status, load]);

  // ?t= means "show me this moment", so it wins over whichever tab was open.
  useEffect(() => {
    if (startAt) setTab("transcript");
  }, [startAt, id]);

  const onSave = useCallback(
    async (patch) => {
      const updated = await patchMeeting(id, patch);
      setMeeting(updated);
      return updated;
    },
    [id],
  );

  async function removeMeeting() {
    setConfirmingDelete(false);
    try {
      await deleteMeeting(id);
      navigate("/meetings");
    } catch (e) {
      setError(e.message || "Could not delete this meeting.");
    }
  }

  if (error && !meeting) {
    return (
      <div className="mx-auto max-w-3xl">
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
        <Button className="mt-4" variant="secondary" onClick={load}>
          Try again
        </Button>
      </div>
    );
  }

  if (!meeting) return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading meeting…</p>;

  const people = participants(meeting);
  const busy = isProcessing(meeting);

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <MeetingHeader
        meeting={meeting}
        onRename={(title) => onSave({ title })}
        onDelete={() => setConfirmingDelete(true)}
      />

      {/* A failed rename, retry or delete has to be visible, not only a failed first load. */}
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <ProcessingStatus
        meeting={meeting}
        onRetry={() => retryMeeting(id).then(load).catch((e) => setError(e.message))}
      />

      {/* Phones: the four labels do not fit, so they scroll sideways instead of wrapping. */}
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <Tabs
          id={tabsId}
          tabs={TABS}
          value={tab}
          onChange={setTab}
          label="Meeting sections"
          className="min-w-max"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div {...tabPanelProps(tabsId, tab)} className="min-w-0">
          {tab === "summary" && <SummaryPanel meeting={meeting} onSave={onSave} />}

          {tab === "transcript" && (
            <Card className="px-4 py-4 sm:px-5">
              <TranscriptPanel meeting={meeting} startAt={startAt} />
            </Card>
          )}

          {tab === "actions" && <ActionItemsPanel meeting={meeting} onSave={onSave} />}

          {tab === "notes" && (
            <Card>
              <EmptyState icon={NotebookPen} title="Notes">
                Your own notes and tags for this meeting arrive with the next update (R2.4).
              </EmptyState>
            </Card>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <ActionItemsPanel meeting={meeting} onSave={onSave} compact />

          <Card>
            <CardHeader title="Participants" icon={Users} />
            {people.length ? (
              <ul className="grid grid-cols-2 gap-3 px-5 pt-3 pb-5">
                {people.map((person) => (
                  <li key={person.key} className="flex items-center gap-2">
                    <Avatar name={person.name} colorKey={person.key} size="sm" />
                    <span className="truncate text-sm text-zinc-700 dark:text-zinc-300">{person.name}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 pt-3 pb-5 text-sm text-zinc-500 dark:text-zinc-400">
                {busy ? "Speakers appear after the transcript is ready." : "No speakers were detected."}
              </p>
            )}
          </Card>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        title="Delete meeting?"
        confirmLabel="Delete"
        onConfirm={removeMeeting}
        onCancel={() => setConfirmingDelete(false)}
      >
        “{meeting.title}” and its audio file will be removed. This cannot be undone.
      </ConfirmDialog>
    </section>
  );
}
