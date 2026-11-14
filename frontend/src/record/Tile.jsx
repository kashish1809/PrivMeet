import { useEffect, useRef } from "react";
import { MicOff, MonitorUp, VolumeX } from "lucide-react";

import { cx } from "../ui";
import { LevelMeter } from "./meters";

/** <video> bound to a MediaStream (srcObject cannot be set through a prop). */
function StreamVideo({ stream, mirror, className, label }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream || null;
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted // the tile never plays sound back: that would echo into the mic
      aria-label={label}
      className={cx("absolute inset-0 h-full w-full object-cover", mirror && "-scale-x-100", className)}
    />
  );
}

const frame =
  "relative aspect-video overflow-hidden rounded-2xl border bg-zinc-900 text-white shadow-sm dark:bg-zinc-950";

/**
 * The "You" tile: camera preview when the camera is on, otherwise a big initial. The ring
 * lights up in the accent color while the mic picks up sound.
 */
export function YouTile({ name = "You", analyser, muted, cameraStream, cameraOn }) {
  const tile = useRef(null);
  const initial = (name || "Y").trim().charAt(0).toUpperCase();
  return (
    <div ref={tile} className={cx(frame, "border-zinc-800 transition-shadow duration-150")}>
      {cameraOn && cameraStream ? (
        <StreamVideo stream={cameraStream} mirror label="Your camera" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            aria-hidden="true"
            className="flex size-20 items-center justify-center rounded-full bg-gradient-to-br from-primary-400 to-primary-700 text-3xl font-semibold"
          >
            {initial}
          </span>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/60 to-transparent px-3 py-2 text-sm">
        <span className="font-medium">{name}</span>
        {muted ? (
          <span className="flex items-center gap-1 text-xs text-red-300">
            <MicOff className="size-4" aria-hidden="true" /> Muted
          </span>
        ) : (
          <LevelMeter
            analyser={analyser}
            muted={muted}
            onLevel={(v) => {
              // Ring while speaking; set on the element so this does not re-render the page.
              if (tile.current)
                tile.current.style.boxShadow =
                  v > 0.12 ? "0 0 0 2px var(--color-primary-500), 0 0 24px -4px var(--color-primary-500)" : "";
            }}
          />
        )}
      </div>
    </div>
  );
}

/** Tile for the shared tab or window. */
export function ShareTile({ stream, hasAudio, onStop }) {
  const label = stream?.getVideoTracks()[0]?.label || "Shared screen";
  return (
    <div className={cx(frame, "border-zinc-800")}>
      <StreamVideo stream={stream} label={`Shared: ${label}`} className="object-contain" />
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 py-2 text-sm">
        <span className="flex min-w-0 items-center gap-1.5 font-medium">
          <MonitorUp className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{label}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {!hasAudio && (
            <span className="flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-xs text-amber-200">
              <VolumeX className="size-3.5" aria-hidden="true" /> No audio
            </span>
          )}
          <button
            type="button"
            onClick={onStop}
            className="rounded-md bg-white/15 px-2 py-0.5 text-xs hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
          >
            Stop sharing
          </button>
        </span>
      </div>
    </div>
  );
}
