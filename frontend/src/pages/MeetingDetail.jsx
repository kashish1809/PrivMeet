import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";

import { getMeeting, meetingAudioUrl, patchMeeting, retryMeeting } from "../api";
import { dateTime, duration, isProcessing } from "../format";
import { Badge, Button, Card, ProgressBar } from "../ui";
import ActionItemsPanel from "../components/ActionItemsPanel";
import MeetingInfo from "../components/MeetingInfo";
import ProcessingStatus from "../components/ProcessingStatus";
import QABox from "../components/QABox";
import SummaryPanel from "../components/SummaryPanel";

const POLL_MS = 2000;

/** Temporary detail page: T2.4 adds tabs, a synced transcript and the right-hand info column. */
export default function MeetingDetail({ id }) {
  const [meeting, setMeeting] = useState(null);
  const [error, setError] = useState("");
  const audio = useRef(null);

  const load = useCallback(() => {
    getMeeting(id)
      .then((m) => {
        setMeeting(m);
        setError("");
      })
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(load, [load]);

  // Poll every 2 s only while the pipeline is still working (AGENTS.md project rules).
  useEffect(() => {
    if (!isProcessing(meeting)) return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [meeting?.status, load]);

  const onSave = useCallback(
    async (patch) => {
      const updated = await patchMeeting(id, patch);
      setMeeting(updated);
      return updated;
    },
    [id],
  );

  const seek = useCallback((seconds) => {
    const el = audio.current;
    if (!el) return;
    el.currentTime = Math.max(0, seconds);
    el.play().catch(() => {}); // autoplay may be blocked until the user interacts
  }, []);

  if (error && !meeting) {
    return (
      <div className="mx-auto max-w-3xl">
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
        <Button className="mt-4" variant="secondary" onClick={load}>Try again</Button>
      </div>
    );
  }

  if (!meeting) return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading meeting…</p>;

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-4">
      <div>
        <a href="#/meetings" className="text-xs text-zinc-500 hover:underline dark:text-zinc-400">
          ← Back to meetings
        </a>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{meeting.title}</h1>
          <div className="flex items-center gap-3">
            <Badge status={meeting.status} />
            {isProcessing(meeting) && (
              <ProgressBar value={meeting.progress} label="Processing progress" className="w-32" />
            )}
          </div>
        </div>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {dateTime(meeting.created)} · {duration(meeting.duration)}
          {meeting.language ? ` · ${meeting.language}` : ""}
        </p>
      </div>

      <ProcessingStatus
        meeting={meeting}
        onRetry={() => retryMeeting(id).then(load).catch((e) => setError(e.message))}
      />

      <Card className="px-5 py-4">
        <audio ref={audio} controls src={meetingAudioUrl(id)} className="w-full" />
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="flex flex-col gap-2 px-5 py-4 lg:col-span-2">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Transcript</h2>
          {meeting.segments?.length ? (
            <ol className="flex flex-col gap-2 text-sm">
              {meeting.segments.map((s, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => seek(s.start)}
                    className="flex w-full gap-3 rounded-md px-1 py-0.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    <span className="font-mono text-xs text-zinc-400">{duration(s.start)}</span>
                    <span className="text-zinc-700 dark:text-zinc-300">
                      {s.speaker !== null && (
                        <span className="font-medium">{meeting.speaker_names?.[s.speaker] || `Speaker ${s.speaker + 1}`}: </span>
                      )}
                      {s.text}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {isProcessing(meeting) ? "Transcript appears when processing finishes." : "No transcript."}
            </p>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <MeetingInfo meeting={meeting} onSave={onSave} />
          <SummaryPanel meeting={meeting} onSave={onSave} />
          <ActionItemsPanel meeting={meeting} onSave={onSave} />
          <QABox meetingId={id} onSeek={seek} />
        </div>
      </div>
    </section>
  );
}
