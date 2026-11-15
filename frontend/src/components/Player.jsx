import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";

import { duration as clock } from "../format";
import { cx, focusRing, IconButton } from "../ui";

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const SKIP = 10;
const SPEED_KEY = "privmeet.playerSpeed";
const VOLUME_KEY = "privmeet.playerVolume";

/** localStorage is per browser and may be blocked, so every read and write is guarded and the
 *  player works the same when it is unavailable. */
function remembered(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function remember(key, value) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    /* private window, or site data blocked */
  }
}

/**
 * The recording, with controls of our own over a hidden <audio>.
 *
 * The browser's default controls cannot be themed: they stay a dark grey bar with a white
 * progress line, which reads as a foreign object on every one of the four themes and ignores
 * the pixel font. These controls are built from the same components as the rest of the app.
 *
 * `audioRef` is the real <audio> element, so a caller keeps seeking with
 * `audioRef.current.currentTime = seconds`, as the transcript does.
 */
export default function Player({
  audioRef,
  src,
  label,
  missing,
  durationHint = 0,
  onTime,
  onPlayingChange,
  className,
}) {
  const own = useRef(null);
  const el = audioRef || own;
  const bar = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [total, setTotal] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [speed, setSpeed] = useState(() => remembered(SPEED_KEY, 1));
  const [volume, setVolume] = useState(() => remembered(VOLUME_KEY, 1));
  const [muted, setMuted] = useState(false);
  const volumeId = useId();

  // The element is the source of truth: a seek from the transcript, or the keyboard, has to
  // move these numbers too.
  const sync = useCallback(
    (node) => {
      setTime(node.currentTime);
      onTime?.(node.currentTime);
    },
    [onTime],
  );

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    node.playbackRate = speed;
    node.volume = volume;
  }, [el, speed, volume]);

  const setPlayState = (on) => {
    setPlaying(on);
    onPlayingChange?.(on);
  };

  const toggle = () => {
    const node = el.current;
    if (!node) return;
    if (node.paused) node.play().catch(() => {});
    else node.pause();
  };

  const skip = (by) => {
    const node = el.current;
    if (!node) return;
    const cap = Number.isFinite(node.duration) ? node.duration : length || Infinity;
    node.currentTime = Math.min(Math.max(0, node.currentTime + by), cap);
    sync(node);
  };

  // A browser recording carries no duration in its header, so the element reports Infinity
  // until the whole file has been fetched. The server already knows the real length, so it is
  // used for the bar and for seeking; without it the bar sat at zero and never moved.
  const length = total > 0 ? total : durationHint > 0 ? durationHint : 0;

  const seekTo = (fraction) => {
    const node = el.current;
    if (!node || length <= 0) return;
    node.currentTime = Math.min(Math.max(0, fraction), 1) * length;
    sync(node);
  };

  const onBarPointer = (e) => {
    const box = bar.current?.getBoundingClientRect();
    if (box?.width) seekTo((e.clientX - box.left) / box.width);
  };

  if (missing) {
    return (
      <p className={cx("rounded-xl bg-zinc-100 px-4 py-3 text-sm text-zinc-600 dark:bg-zinc-800/70 dark:text-zinc-300", className)}>
        Audio was removed. Notes and transcript are kept.
      </p>
    );
  }

  const pct = length ? Math.min(100, (time / length) * 100) : 0;
  const bufferedPct = length ? Math.min(100, (buffered / length) * 100) : 0;

  return (
    <div
      className={cx(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/60",
        className,
      )}
    >
      <audio
        ref={el}
        preload="metadata"
        src={src}
        aria-label={label}
        onLoadedMetadata={(e) => {
          setTotal(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0);
          e.currentTarget.playbackRate = speed;
          e.currentTarget.volume = volume;
        }}
        onDurationChange={(e) => setTotal(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
        onTimeUpdate={(e) => sync(e.currentTarget)}
        onSeeked={(e) => sync(e.currentTarget)}
        onProgress={(e) => {
          const ranges = e.currentTarget.buffered;
          setBuffered(ranges.length ? ranges.end(ranges.length - 1) : 0);
        }}
        onPlay={() => setPlayState(true)}
        onPause={() => setPlayState(false)}
        onEnded={() => setPlayState(false)}
        onVolumeChange={(e) => setMuted(e.currentTarget.muted || e.currentTarget.volume === 0)}
      >
        Your browser cannot play this recording.
      </audio>

      <IconButton
        icon={playing ? Pause : Play}
        label={playing ? "Pause" : "Play"}
        variant="secondary"
        onClick={toggle}
      />
      <button
        type="button"
        onClick={() => skip(-SKIP)}
        aria-label={`Back ${SKIP} seconds`}
        title={`Back ${SKIP} seconds`}
        className={cx("rounded-lg px-2 py-1 text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50", focusRing)}
      >
        −{SKIP}s
      </button>

      <span className="tabular-nums text-xs text-zinc-600 dark:text-zinc-300">
        {clock(time)} <span className="text-zinc-400 dark:text-zinc-500">/ {clock(length)}</span>
      </span>

      {/* The bar is the slider: it carries the value, the keys and the label. */}
      <div
        ref={bar}
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(length) || 0}
        aria-valuenow={Math.round(time)}
        aria-valuetext={`${clock(time)} of ${clock(length)}`}
        onPointerDown={onBarPointer}
        onKeyDown={(e) => {
          const step = { ArrowLeft: -5, ArrowRight: 5, ArrowDown: -5, ArrowUp: 5, PageDown: -60, PageUp: 60 }[e.key];
          if (step !== undefined) {
            e.preventDefault();
            skip(step);
          } else if (e.key === "Home" || e.key === "End") {
            e.preventDefault();
            seekTo(e.key === "Home" ? 0 : 1);
          } else if (e.key === " " || e.code === "Space") {
            e.preventDefault();
            toggle();
          }
        }}
        className={cx("relative h-2 min-w-40 flex-1 cursor-pointer rounded-full bg-zinc-200 dark:bg-zinc-700", focusRing)}
      >
        <span className="absolute inset-y-0 left-0 rounded-full bg-zinc-300 dark:bg-zinc-600" style={{ width: `${bufferedPct}%` }} />
        <span className="absolute inset-y-0 left-0 rounded-full bg-primary-600 dark:bg-primary-500" style={{ width: `${pct}%` }} />
        <span
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-600 shadow dark:bg-primary-400"
          style={{ left: `${pct}%` }}
        />
      </div>

      <button
        type="button"
        onClick={() => skip(SKIP)}
        aria-label={`Forward ${SKIP} seconds`}
        title={`Forward ${SKIP} seconds`}
        className={cx("rounded-lg px-2 py-1 text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50", focusRing)}
      >
        +{SKIP}s
      </button>

      <label className="sr-only" htmlFor={`${volumeId}-speed`}>
        Playback speed
      </label>
      <select
        id={`${volumeId}-speed`}
        value={speed}
        title="Playback speed"
        onChange={(e) => {
          const next = Number(e.target.value);
          setSpeed(next);
          remember(SPEED_KEY, next);
        }}
        className={cx(
          "rounded-lg border border-zinc-200 bg-white px-1.5 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
          focusRing,
        )}
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>

      <div className="flex items-center gap-1.5">
        <IconButton
          icon={muted || volume === 0 ? VolumeX : Volume2}
          label={muted || volume === 0 ? "Unmute" : "Mute"}
          size="sm"
          onClick={() => {
            const node = el.current;
            if (!node) return;
            node.muted = !node.muted;
            setMuted(node.muted);
          }}
        />
        <label className="sr-only" htmlFor={`${volumeId}-volume`}>
          Volume
        </label>
        <input
          id={`${volumeId}-volume`}
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          title="Volume"
          onChange={(e) => {
            const next = Number(e.target.value);
            const node = el.current;
            setVolume(next);
            remember(VOLUME_KEY, next);
            if (node) {
              node.muted = next === 0;
              setMuted(next === 0);
            }
          }}
          className={cx("h-1 w-16 accent-primary-600 dark:accent-primary-400", focusRing)}
        />
      </div>
    </div>
  );
}
