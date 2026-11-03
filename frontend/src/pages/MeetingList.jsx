import { useEffect, useState } from "react";
import { Mic } from "lucide-react";

import { listMeetings } from "../api";
import { duration, dateTime } from "../format";
import { Badge, Button, Card, EmptyState, ProgressBar } from "../ui";

/** Temporary list: T2.2 adds grouping, search, kebab actions and polling. */
export default function MeetingList() {
  const [meetings, setMeetings] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    listMeetings()
      .then((data) => setMeetings(data.meetings))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Meetings</h1>
        <Button onClick={() => (window.location.hash = "/new")}>New Meeting</Button>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>
      )}

      {meetings === null && !error && (
        <p className="px-1 py-6 text-sm text-zinc-500 dark:text-zinc-400">Loading meetings…</p>
      )}

      {meetings?.length === 0 && (
        <Card>
          <EmptyState
            icon={Mic}
            title="No meetings yet"
            action={
              <Button onClick={() => (window.location.hash = "/new")}>Add your first meeting</Button>
            }
          >
            Upload an audio or video file to get a transcript, speaker labels and notes.
          </EmptyState>
        </Card>
      )}

      {meetings?.map((m) => (
        <Card key={m.id} className="px-5 py-4">
          <a href={`#/m/${m.id}`} className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{m.title}</p>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                {duration(m.duration)} · {dateTime(m.created)}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge status={m.status} />
              {m.status !== "done" && m.status !== "failed" && (
                <ProgressBar value={m.progress} label={`${m.title} progress`} className="w-24" />
              )}
            </div>
          </a>
        </Card>
      ))}
    </section>
  );
}
