import { useState } from "react";
import { Upload } from "lucide-react";

import { upload } from "../api";
import UploadDropzone, { checkFile } from "../components/UploadDropzone";
import { Button, Card, Input, ProgressBar } from "../ui";

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
    <section className="mx-auto flex max-w-xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">New meeting</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Add a recording and get a transcript, speaker labels and notes.
        </p>
      </div>

      <Card className="px-5 py-5">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <UploadDropzone
            file={file}
            onSelect={choose}
            onClear={() => {
              setFile(null);
              setError("");
            }}
            disabled={busy}
            invalid={!!error && !file}
          />

          <Input
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Team sync"
            hint="Optional. The file name is used when this is blank."
            disabled={busy}
          />

          {busy && (
            <div className="flex flex-col gap-1.5">
              <ProgressBar value={progress * 100} label="Upload progress" />
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {progress < 1 ? `Uploading ${Math.round(progress * 100)}%` : "Uploaded, starting the pipeline…"}
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

          <div className="flex items-center gap-3">
            <Button type="submit" icon={Upload} disabled={busy || !file}>
              {busy ? "Uploading…" : "Upload"}
            </Button>
            <Button variant="ghost" onClick={() => (window.location.hash = "/record")} disabled={busy}>
              Record instead
            </Button>
          </div>
        </form>
      </Card>
    </section>
  );
}
