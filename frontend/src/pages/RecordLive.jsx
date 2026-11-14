import { useEffect, useState } from "react";
import { AlertTriangle, AudioLines, CloudUpload, Download, Info, MonitorUp, RotateCcw, Square } from "lucide-react";

import { navigate } from "../App";
import { duration } from "../format";
import ControlBar from "../record/ControlBar";
import NotesCard from "../record/NotesCard";
import OptionsDialog from "../record/OptionsDialog";
import { Waveform } from "../record/meters";
import * as rec from "../record/session";
import { ShareTile, YouTile } from "../record/Tile";
import { Badge, Button, Card, CardHeader, ProgressBar, cx, focusRing } from "../ui";

function Notice({ tone = "error", children, action }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx(
        "flex flex-wrap items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm",
        tone === "error"
          ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300"
          : "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300",
      )}
    >
      <span className="flex min-w-0 items-start gap-2">
        {tone === "error" ? (
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        ) : (
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        )}
        <span>{children}</span>
      </span>
      {action}
    </div>
  );
}

/** The right-hand panel: what is happening to the audio right now. */
function LivePanel({ s }) {
  const analyser = s.phase === "idle" || s.phase === "recording" || s.phase === "paused" ? rec.getMixer().mixAnalyser : null;
  return (
    <Card>
      <CardHeader title={s.phase === "uploading" ? "Uploading" : "Live audio"} icon={s.phase === "uploading" ? CloudUpload : AudioLines} />
      <div className="flex flex-col gap-3 px-5 pt-3 pb-5">
        {s.phase === "uploading" ? (
          <>
            <ProgressBar value={s.progress * 100} label="Upload progress" />
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              Sending the recording to your PrivMeet server… {Math.round(s.progress * 100)}%
            </p>
          </>
        ) : (
          <>
            <div className="rounded-xl bg-zinc-50 px-3 py-2 dark:bg-zinc-950">
              <Waveform analyser={analyser} paused={s.phase !== "recording"} />
            </div>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              {s.phase === "recording"
                ? "Recording. The transcript appears when you stop."
                : s.phase === "paused"
                  ? "Paused. Nothing is recorded until you resume."
                  : s.phase === "stopped"
                    ? "Stopped. The recording is still in this browser."
                    : "Press Record when you are ready. The waveform shows what will be recorded."}
            </p>
          </>
        )}
        <ul className="flex flex-col gap-1.5 border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <li>Audio stays in this browser until you stop, then goes only to your own PrivMeet server.</li>
          <li>
            Recording an online meeting? Use <MonitorUp className="inline size-3.5 align-[-2px]" aria-hidden="true" /> Share,
            pick the meeting tab and tick “Share tab audio”.
          </li>
          <li>Other people show up as speakers after processing.</li>
        </ul>
      </div>
    </Card>
  );
}

/**
 * Record / Live: mic plus optional camera and shared tab/window, mixed and recorded in the
 * browser, then uploaded as a new meeting. Layout from docs/ui/mockup-v1.webp (top screen),
 * colors and cards from v2. Reached from Home "Start Recording" and New Meeting.
 */
export default function RecordLive() {
  const s = rec.useRecordSession();
  const [options, setOptions] = useState(false);
  const live = s.phase === "recording" || s.phase === "paused";

  // Open the mic for the level meter (and the camera, if it is the saved default).
  useEffect(() => {
    if (s.mic.status === "off") rec.openMic();
    if (s.camera.wanted && !s.camera.on && s.phase === "idle") rec.toggleCamera();
    return rec.release; // keeps a running recording, frees idle devices
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function leave() {
    const meeting = await rec.stopAndSave();
    if (meeting?.id) navigate(`/m/${meeting.id}`);
  }

  async function saveAgain() {
    const meeting = await rec.save();
    if (meeting?.id) navigate(`/m/${meeting.id}`);
  }

  function onRecord() {
    if (s.phase === "recording") rec.pause();
    else if (s.phase === "paused") rec.resume();
    else rec.start();
  }

  if (!s.supported) {
    return (
      <section className="mx-auto max-w-3xl">
        <h1 className="mb-4 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Record</h1>
        <Notice>
          This browser cannot record audio here. Use a current Chrome, Edge or Firefox, or upload a recording from{" "}
          <a href="#/new" className={cx("underline", focusRing)}>New Meeting</a>.
        </Notice>
      </section>
    );
  }

  const when = s.startedAt || new Date();
  const dateLine = when.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  return (
    // Any click wakes the audio graph: browsers start it suspended until the page is used.
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-5" onPointerDown={() => rec.getMixer().resume()}>
      {/* Header: title, date, status pill with the timer, Stop Recording */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-950 dark:text-primary-300">
            <AudioLines className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <label htmlFor="rec-title" className="sr-only">
              Meeting title
            </label>
            <input
              id="rec-title"
              value={s.title}
              maxLength={200}
              onChange={(e) => rec.setNotes({ title: e.target.value })}
              disabled={s.phase === "uploading"}
              className={cx(
                "w-full truncate rounded-md bg-transparent text-2xl font-semibold tracking-tight text-zinc-900 outline-none hover:bg-zinc-100 focus:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800/60 dark:focus:bg-zinc-800/60",
                focusRing,
              )}
            />
            <p className="mt-1 text-sm text-zinc-500 tabular-nums dark:text-zinc-400">
              {dateLine} · {duration(s.elapsed / 1000)}
              {s.videoRecorded && live ? " · audio + video" : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {live && (
            <Badge tone={s.phase === "paused" ? "amber" : "red"} dot className="tabular-nums">
              {s.phase === "paused" ? "Paused" : "Recording"} · {duration(s.elapsed / 1000)}
            </Badge>
          )}
          {live ? (
            <Button variant="danger" icon={Square} onClick={leave}>
              Stop Recording
            </Button>
          ) : s.phase === "idle" ? (
            <Button onClick={() => rec.start()} disabled={s.mic.status !== "on" && !s.share.hasAudio}>
              Start Recording
            </Button>
          ) : null}
        </div>
      </header>

      {/* Problems, each with a way out */}
      {s.mic.error && (
        <Notice
          action={
            s.mic.status === "error" && (
              <Button size="sm" variant="secondary" icon={RotateCcw} onClick={() => rec.openMic()}>
                Try again
              </Button>
            )
          }
        >
          {s.mic.error}
          {s.share.supported && s.mic.status === "error" && " You can still record a shared tab's audio."}
        </Notice>
      )}
      {s.share.error && <Notice tone={s.share.stream ? "info" : "error"}>{s.share.error}</Notice>}
      {!s.share.supported && (
        <Notice tone="info">
          Sharing a tab or window is not available in this browser or app window, so meeting audio from another tab
          cannot be added. The microphone still records.
        </Notice>
      )}
      {s.camera.error && <Notice>{s.camera.error}</Notice>}
      {s.camera.on && !s.videoRecorded && live && (
        <Notice tone="info">The camera is a preview only: video is recorded when the camera is on before you press Record.</Notice>
      )}
      {s.uploadError && (
        <Notice
          action={
            <span className="flex flex-wrap gap-2">
              <Button size="sm" icon={RotateCcw} onClick={saveAgain}>
                Retry upload
              </Button>
              <Button size="sm" variant="secondary" icon={Download} onClick={rec.downloadBlob}>
                Download
              </Button>
            </span>
          }
        >
          The recording was not uploaded: {s.uploadError} It is kept in this tab until you retry or download it.
        </Notice>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <div className={cx("grid gap-4", s.share.stream && "md:grid-cols-2")}>
            <YouTile
              analyser={s.mic.status === "on" ? rec.getMixer().micAnalyser : null}
              muted={s.muted}
              cameraOn={s.camera.on}
              cameraStream={s.camera.stream}
            />
            {s.share.stream && <ShareTile stream={s.share.stream} hasAudio={s.share.hasAudio} onStop={rec.toggleShare} />}
          </div>

          <ControlBar
            s={s}
            onMute={rec.toggleMute}
            onCamera={rec.toggleCamera}
            onShare={rec.toggleShare}
            onRecord={onRecord}
            onMore={() => setOptions(true)}
            onLeave={leave}
          />
        </div>

        <aside className="flex flex-col gap-5">
          <LivePanel s={s} />
          <NotesCard title={s.title} notes={s.notes} tags={s.tags} onChange={rec.setNotes} disabled={s.phase === "uploading"} />
        </aside>
      </div>

      <OptionsDialog
        open={options}
        onClose={() => setOptions(false)}
        s={s}
        onDevice={rec.setMicDevice}
        onSystemAudio={rec.setSystemAudio}
        onDownload={rec.downloadBlob}
        onDiscard={() => {
          rec.reset();
          rec.openMic();
        }}
      />
    </section>
  );
}
