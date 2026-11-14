import {
  Camera,
  CameraOff,
  Circle,
  Ellipsis,
  LogOut,
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  Pause,
  Play,
} from "lucide-react";

import { cx } from "../ui";

/** Round control with its label under it, as in the mockup's control row. */
function Control({ icon: Icon, label, onClick, pressed, tone = "default", disabled, title }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-pressed={pressed}
        aria-label={label}
        title={title || label}
        className={cx(
          "pm-btn size-12",
          tone === "danger" ? "pm-btn-danger" : tone === "active" ? "pm-btn-primary" : "pm-btn-secondary",
        )}
      >
        <Icon className="size-5" aria-hidden="true" />
      </button>
      <span className={cx("font-pixel text-[11px]", tone === "danger" ? "text-red-600 dark:text-red-400" : "text-zinc-600 dark:text-zinc-400")}>
        {label}
      </span>
    </div>
  );
}

/**
 * Mic, Camera, Share, Record, More, then Leave. Record starts, pauses and resumes; Leave
 * stops and uploads. Toggles report their state with aria-pressed.
 */
export default function ControlBar({ s, onMute, onCamera, onShare, onRecord, onMore, onLeave }) {
  const live = s.phase === "recording" || s.phase === "paused";
  const busy = s.phase === "uploading";
  const micBroken = s.mic.status === "error" || s.mic.status === "off";
  const record =
    s.phase === "recording"
      ? { icon: Pause, label: "Pause" }
      : s.phase === "paused"
        ? { icon: Play, label: "Resume" }
        : { icon: Circle, label: "Record" };

  return (
    <div
      className="mx-auto flex flex-wrap items-start justify-center gap-x-5 gap-y-3 rounded-2xl border border-zinc-200 bg-white/[0.88] px-5 py-3 dark:border-zinc-800 dark:bg-zinc-900/[0.88]"
      role="toolbar"
      aria-label="Recorder controls"
    >
      <Control
        icon={s.muted || micBroken ? MicOff : Mic}
        label={s.muted ? "Unmute" : "Mic"}
        pressed={!s.muted && !micBroken}
        tone={s.muted ? "danger" : "default"}
        onClick={onMute}
        disabled={busy || micBroken}
        title={micBroken ? "Microphone is off" : s.muted ? "Unmute the microphone" : "Mute the microphone"}
      />
      <Control
        icon={s.camera.on ? Camera : CameraOff}
        label="Camera"
        pressed={s.camera.on}
        tone={s.camera.on ? "active" : "default"}
        onClick={onCamera}
        disabled={busy}
      />
      <Control
        icon={s.share.stream ? MonitorOff : MonitorUp}
        label={s.share.stream ? "Stop share" : "Share"}
        pressed={!!s.share.stream}
        tone={s.share.stream ? "active" : "default"}
        onClick={onShare}
        disabled={busy || !s.share.supported}
        title={s.share.supported ? "Share a tab or window and record its audio" : "Screen sharing is not available in this browser"}
      />
      <Control
        icon={record.icon}
        label={record.label}
        tone={s.phase === "recording" ? "danger" : "default"}
        onClick={onRecord}
        disabled={busy || s.phase === "stopped"}
      />
      <Control icon={Ellipsis} label="More" onClick={onMore} disabled={busy} />
      <div className="flex flex-col items-center gap-1.5 pl-2">
        <button
          type="button"
          onClick={onLeave}
          disabled={!live}
          className="pm-btn pm-btn-danger h-12 gap-2 px-5 text-sm"
        >
          <LogOut className="size-4" aria-hidden="true" />
          Leave
        </button>
        <span className="font-pixel text-[11px] text-zinc-500 dark:text-zinc-400">Stop &amp; save</span>
      </div>
    </div>
  );
}
