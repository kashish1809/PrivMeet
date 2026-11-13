import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, SearchX } from "lucide-react";

import { meetingAudioUrl } from "../api";
import { duration, isProcessing } from "../format";
import { Avatar, cx, EmptyState, SearchInput, Toggle, focusRing } from "../ui";
import QABox from "./QABox";

/** Split text around the query so matches can be wrapped in <mark> without innerHTML. */
export function highlighted(text, query) {
  if (!query) return text;
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const parts = [];
  let at = 0;
  for (;;) {
    const i = lower.indexOf(needle, at);
    if (i === -1) break;
    if (i > at) parts.push(text.slice(at, i));
    parts.push(<mark key={i} className="rounded bg-amber-200/70 text-inherit dark:bg-amber-500/30">{text.slice(i, i + needle.length)}</mark>);
    at = i + needle.length;
  }
  if (!parts.length) return text;
  parts.push(text.slice(at));
  return parts;
}

/** Index of the segment being played: the last one that starts at or before `time`. */
export function segmentAt(segments, time) {
  let found = -1;
  for (let i = 0; i < segments.length; i += 1) {
    if (segments[i].start <= time) found = i;
    else break;
  }
  return found;
}

/**
 * Transcript tab: the meeting's audio player over the transcript list.
 *
 * - The segment being played is highlighted and scrolled into view; "Follow playback"
 *   turns the scrolling off for someone reading further down.
 * - Clicking a line (or its timestamp) seeks there and starts playing.
 * - The search box filters the list and highlights the matches in place; it does not
 *   hit the server, because the whole transcript is already in the meeting JSON.
 * - QABox sits under the list, and its [mm:ss] citations seek this same player.
 */
export default function TranscriptPanel({ meeting, startAt = 0 }) {
  const segments = meeting.segments || [];
  const audio = useRef(null);
  const rows = useRef({});
  const [time, setTime] = useState(startAt);
  const [playing, setPlaying] = useState(false);
  const [follow, setFollow] = useState(true);
  const [query, setQuery] = useState("");

  const current = segmentAt(segments, time);

  const seek = useCallback((seconds) => {
    const el = audio.current;
    if (!el) return;
    el.currentTime = Math.max(0, seconds);
    setTime(Math.max(0, seconds));
    el.play().catch(() => {}); // autoplay may be blocked until the user interacts
  }, []);

  // ?t=<seconds> from the hash: seek once the browser knows how long the file is.
  useEffect(() => {
    const el = audio.current;
    if (!el || !startAt) return;
    const jump = () => {
      el.currentTime = Math.min(startAt, el.duration || startAt);
      setTime(el.currentTime);
    };
    if (el.readyState >= 1) jump();
    else el.addEventListener("loadedmetadata", jump, { once: true });
  }, [startAt]);

  // Keep the playing line in view, but never yank the list while the user scrolls it.
  useEffect(() => {
    if (!follow || current < 0) return;
    rows.current[current]?.scrollIntoView({ block: "nearest" });
  }, [current, follow]);

  const matches = useMemo(() => {
    if (!query.trim()) return null;
    const needle = query.trim().toLowerCase();
    return segments
      .map((s, i) => ({ ...s, i }))
      .filter((s) => s.text.toLowerCase().includes(needle));
  }, [segments, query]);

  const shown = matches ?? segments.map((s, i) => ({ ...s, i }));
  const speakerName = (speaker) =>
    speaker === null || speaker === undefined
      ? "Speaker"
      : meeting.speaker_names?.[speaker] || `Speaker ${speaker + 1}`;

  if (!segments.length) {
    return (
      <EmptyState icon={FileText} title="No transcript yet">
        {isProcessing(meeting)
          ? "The transcript appears here when processing finishes."
          : "This meeting has no transcript. Retry the pipeline from the banner above."}
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          label="Search transcript"
          placeholder="Search transcript…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-48 flex-1"
        />
        <Toggle checked={follow} onChange={setFollow} label="Follow playback" />
        {matches && (
          <p aria-live="polite" className="text-xs text-zinc-500 dark:text-zinc-400">
            {matches.length === segments.length
              ? `${matches.length} lines`
              : `${matches.length} of ${segments.length} lines`}
          </p>
        )}
      </div>

      <audio
        ref={audio}
        controls
        preload="metadata"
        src={meetingAudioUrl(meeting.id)}
        className="w-full"
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onSeeked={(e) => setTime(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      >
        Your browser cannot play this recording.
      </audio>

      <ol
        className="max-h-[32rem] space-y-0.5 overflow-y-auto rounded-xl border border-zinc-200 p-1 dark:border-zinc-800"
        aria-label="Transcript"
      >
        {shown.map((s) => {
          const active = s.i === current && !matches;
          return (
            <li key={s.i} ref={(el) => (rows.current[s.i] = el)}>
              <button
                type="button"
                onClick={() => seek(s.start)}
                aria-current={active ? "true" : undefined}
                className={cx(
                  "flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors",
                  active
                    ? "bg-primary-50 dark:bg-primary-950/60"
                    : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60",
                  focusRing,
                )}
              >
                <Avatar name={speakerName(s.speaker)} colorKey={s.speaker ?? "?"} size="sm" className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-2">
                    <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
                      {speakerName(s.speaker)}
                    </span>
                    <span className="font-mono text-[11px] text-zinc-400 tabular-nums dark:text-zinc-500">
                      {duration(s.start)}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-sm text-zinc-700 dark:text-zinc-300">
                    {highlighted(s.text, query.trim())}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {matches && !matches.length && (
        <div className="flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
          <SearchX className="size-4 shrink-0" aria-hidden="true" />
          No line contains “{query.trim()}”.
        </div>
      )}

      {/* The player above is the one QABox seeks; the prop keeps QABox's contract unchanged. */}
      <QABox meetingId={meeting.id} onSeek={seek} />
      <span className="sr-only" aria-live="polite">
        {playing && current >= 0 ? `Playing ${duration(segments[current].start)}` : ""}
      </span>
    </div>
  );
}
