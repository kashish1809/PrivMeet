import { useCallback, useEffect, useState } from "react";
import { Mic, Plus, SearchX } from "lucide-react";

import { deleteMeeting, listMeetings } from "../api";
import MeetingRow from "../components/MeetingRow";
import { groupByDay } from "../components/meetingGroups";
import { isProcessing } from "../format";
import { Button, Card, ConfirmDialog, EmptyState, SearchInput } from "../ui";

const POLL_MS = 2000;

/**
 * "Meetings" screen: rows grouped by day with a status badge, a New Meeting button and
 * (in the next commits) search, kebab actions and polling while processing.
 */
export default function MeetingList() {
  const [meetings, setMeetings] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState(""); // debounced query actually sent to the API
  const [pendingDelete, setPendingDelete] = useState(null);

  // 300 ms debounce: one request per pause, not one per key press.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(
    () =>
      listMeetings(search)
        .then((data) => {
          setMeetings(data.meetings);
          setError("");
        })
        .catch((e) => setError(e.message)),
    [search],
  );

  useEffect(load, [load]);

  // Poll only while something is still processing; a finished list stops the timer.
  const processing = (meetings || []).some(isProcessing);
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [processing, load]);

  // DELETE also removes the audio file on disk, so ask first.
  const confirmDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    try {
      await deleteMeeting(target.id);
      setMeetings((list) => (list || []).filter((m) => m.id !== target.id));
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Meetings</h1>
        <Button icon={Plus} onClick={() => (window.location.hash = "/new")}>New Meeting</Button>
      </div>

      <SearchInput
        label="Search meetings"
        placeholder="Search meetings and transcripts…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full max-w-md"
      />

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {meetings === null && !error && (
        <p className="px-1 py-6 text-sm text-zinc-500 dark:text-zinc-400">Loading meetings…</p>
      )}

      {meetings?.length === 0 && !search && (
        <Card>
          <EmptyState
            icon={Mic}
            title="No meetings yet"
            action={<Button onClick={() => (window.location.hash = "/new")}>Add your first meeting</Button>}
          >
            Upload an audio or video file to get a transcript, speaker labels and notes.
          </EmptyState>
        </Card>
      )}

      {meetings?.length === 0 && search && (
        <Card>
          <EmptyState icon={SearchX} title={`No matches for “${search}”`}>
            Searches run over meeting titles and transcript lines. Try a shorter word.
          </EmptyState>
        </Card>
      )}

      {meetings && groupByDay(meetings).map(([label, items]) => (
        <div key={label} className="flex flex-col gap-2">
          <h2 className="px-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            {label}
          </h2>
          {items.map((m) => (
            <MeetingRow key={m.id} meeting={m} group={label} onDelete={setPendingDelete} />
          ))}
        </div>
      ))}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete meeting?"
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      >
        “{pendingDelete?.title}” and its audio file will be removed. This cannot be undone.
      </ConfirmDialog>
    </section>
  );
}
