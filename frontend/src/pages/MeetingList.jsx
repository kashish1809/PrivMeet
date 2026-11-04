import { useCallback, useEffect, useState } from "react";
import { Mic, Plus } from "lucide-react";

import { listMeetings } from "../api";
import MeetingRow from "../components/MeetingRow";
import { groupByDay } from "../components/meetingGroups";
import { Button, Card, EmptyState } from "../ui";

/**
 * "Meetings" screen: rows grouped by day with a status badge, a New Meeting button and
 * (in the next commits) search, kebab actions and polling while processing.
 */
export default function MeetingList() {
  const [meetings, setMeetings] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(
    () =>
      listMeetings()
        .then((data) => {
          setMeetings(data.meetings);
          setError("");
        })
        .catch((e) => setError(e.message)),
    [],
  );

  useEffect(load, [load]);

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Meetings</h1>
        <Button icon={Plus} onClick={() => (window.location.hash = "/new")}>New Meeting</Button>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {meetings === null && !error && (
        <p className="px-1 py-6 text-sm text-zinc-500 dark:text-zinc-400">Loading meetings…</p>
      )}

      {meetings?.length === 0 && (
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

      {meetings && groupByDay(meetings).map(([label, items]) => (
        <div key={label} className="flex flex-col gap-2">
          <h2 className="px-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            {label}
          </h2>
          {items.map((m) => (
            <MeetingRow key={m.id} meeting={m} group={label} />
          ))}
        </div>
      ))}
    </section>
  );
}
