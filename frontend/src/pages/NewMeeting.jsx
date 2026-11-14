import { useState } from "react";
import { FileAudio, Mic, Sparkles, Upload, Users } from "lucide-react";

import { upload } from "../api";
import UploadDropzone, { checkFile, fileSize } from "../components/UploadDropzone";
import { Button, Card, CardHeader, Input, ProgressBar } from "../ui";

/** The three stages the worker runs, so people know what the wait is for. */
const STAGES = [
  { icon: FileAudio, title: "Transcribe", text: "Whisper turns the audio into text on this machine." },
  { icon: Users, title: "Label speakers", text: "Diarization groups the lines by who said them." },
  { icon: Sparkles, title: "Write notes", text: "A local model adds the summary and action items." },
];

/**
 * "New meeting": pick or drop one audio/video file, an optional title, then upload.
 * Finishing sends the user straight to the meeting page, which shows processing.
 * R2.9 adds the template picker, language and multi-file queue.
 */
export default function NewMeeting() {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [progress, setProgress] = useState(null); // null = not uploading, else 0..1
  const [error, setError] = useState("");

  const busy = progress !== null;

  function choose(next) {
    setFile(next);
    setError(checkFile(next) || "");
  }

  function clear() {
    setFile(null);
    setError("");
  }

  async function onSubmit(e) {
    e.preventDefault();
    const problem = checkFile(file);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setProgress(0);

    const form = new FormData();
    form.append("file", file);
    if (title.trim()) form.append("title", title.trim());

    try {
      const meeting = await upload("/api/meetings/", form, setProgress);
      window.location.hash = `/m/${meeting.id}`;
    } catch (err) {
      setProgress(null);
      setError(err.message);
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">New meeting</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Add a recording and get a transcript, speaker labels and notes, all on this machine.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <Card className="px-5 py-5">
          <form onSubmit={onSubmit} className="flex flex-col gap-4" aria-busy={busy}>
            <UploadDropzone file={file} onSelect={choose} onClear={clear} disabled={busy} invalid={!!error && !file} />

            <Input
              label="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Team sync"
              hint="Optional. The file name is used when this is blank."
              maxLength={200}
              disabled={busy}
            />

            {busy && (
              <div className="flex flex-col gap-1.5">
                <ProgressBar value={progress * 100} label="Upload progress" />
                <p aria-live="polite" className="text-xs text-zinc-500 dark:text-zinc-400">
                  {progress < 1
                    ? `Uploading ${file.name} · ${fileSize(file.size * progress)} of ${fileSize(file.size)} · ${Math.round(progress * 100)}%`
                    : `Uploaded ${file.name}, starting the pipeline…`}
                </p>
              </div>
            )}

            {error && (
              <p
                role="alert"
                className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
              >
                {error}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" icon={Upload} disabled={busy || !file}>
                {busy ? "Uploading…" : "Upload"}
              </Button>
              {file && !busy && (
                <Button variant="ghost" onClick={clear}>
                  Clear
                </Button>
              )}
            </div>
          </form>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Record instead" icon={Mic} />
            <div className="flex flex-col gap-3 px-5 pt-2 pb-5">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Talk to your mic and stop when the meeting ends.
              </p>
              <Button
                variant="secondary"
                icon={Mic}
                className="w-full justify-center"
                disabled={busy}
                onClick={() => (window.location.hash = "/record")}
              >
                Open the recorder
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader title="What happens next" icon={Sparkles} />
            <ol className="flex flex-col gap-3 px-5 pt-3 pb-5">
              {STAGES.map(({ icon: Icon, title: stage, text }, i) => (
                <li key={stage} className="flex gap-3">
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-950 dark:text-primary-400">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {i + 1}. {stage}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </section>
  );
}
