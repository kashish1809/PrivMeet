import { useRef, useState } from "react";
import { Upload } from "lucide-react";

import { upload } from "../api";
import { Button, Card, ProgressBar } from "../ui";

// Mirrors ALLOWED_EXT in backend/meetings/views.py so a bad pick fails before the upload.
const ACCEPT = ".mp3,.wav,.mp4,.m4a,.webm,.ogg,.opus,.flac,.mkv,.mov";

/** Temporary upload page: T2.3 adds drag and drop, real validation and server errors. */
export default function NewMeeting() {
  const fileRef = useRef(null);
  const [title, setTitle] = useState("");
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Pick an audio or video file first.");
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
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">New meeting</h1>

      <Card className="flex flex-col gap-4 px-5 py-5">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Title
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Team sync"
              className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm font-normal text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Audio or video file
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              className="text-sm font-normal text-zinc-600 file:mr-3 file:rounded-lg file:border-0 file:bg-primary-600 file:px-3 file:py-1.5 file:text-sm file:text-white dark:text-zinc-300"
            />
          </label>

          {progress !== null && (
            <div className="flex flex-col gap-1.5">
              <ProgressBar value={progress * 100} label="Upload progress" />
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {progress < 1 ? `Uploading ${Math.round(progress * 100)}%` : "Uploaded, processing…"}
              </p>
            </div>
          )}

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {error}
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button type="submit" icon={Upload} disabled={progress !== null && progress < 1}>
              Upload
            </Button>
            <Button variant="ghost" onClick={() => (window.location.hash = "/record")}>
              Record instead
            </Button>
          </div>
        </form>
      </Card>
    </section>
  );
}
