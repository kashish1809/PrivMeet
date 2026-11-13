import { useRef, useState } from "react";
import { FileAudio, FileVideo, Replace, Upload, X } from "lucide-react";

import { cx, focusRing } from "../ui";

/** Mirrors ALLOWED_EXT in backend/meetings/views.py, so a bad pick fails here, not after a long upload. */
export const ALLOWED_EXT = [".mp3", ".wav", ".mp4", ".m4a", ".webm", ".ogg", ".opus", ".flac", ".mkv", ".mov"];

const VIDEO_EXT = [".mp4", ".m4a", ".webm", ".mkv", ".mov"];
const ACCEPT = ALLOWED_EXT.join(",");

/** "4.2 MB" — one decimal, no dependency. */
export function fileSize(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

/** Extension of a File, lowercased. "" when the name has no dot. */
export function extensionOf(name = "") {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

/** Null when the file is acceptable, else the message to show. */
export function checkFile(file) {
  if (!file) return "Pick an audio or video file first.";
  const ext = extensionOf(file.name);
  if (!ALLOWED_EXT.includes(ext)) {
    return `${ext || "That file type"} is not supported. Use ${ALLOWED_EXT.join(", ")}.`;
  }
  return null;
}

/**
 * Drag-and-drop plus file picker for one meeting file. The dashed area is a button, so a
 * keyboard user reaches it with Tab and opens the picker with Enter or Space; dropping is
 * an extra, never the only way in.
 */
export default function UploadDropzone({ file, onSelect, onClear, disabled, invalid }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  function pick(files) {
    const next = files?.[0];
    if (next) onSelect(next);
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    pick(e.dataTransfer?.files);
  }

  // dragenter/dragleave fire for every child element, so count them instead of toggling.
  const [depth, setDepth] = useState(0);
  const dragProps = {
    onDragEnter: (e) => {
      e.preventDefault();
      if (disabled) return;
      setDepth((d) => d + 1);
      setDragging(true);
    },
    onDragOver: (e) => {
      e.preventDefault(); // without this the browser opens the file instead of dropping it
    },
    onDragLeave: (e) => {
      e.preventDefault();
      setDepth((d) => {
        const next = Math.max(0, d - 1);
        if (next === 0) setDragging(false);
        return next;
      });
    },
    onDrop,
  };

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPT}
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
      onChange={(e) => {
        pick(e.target.files);
        e.target.value = ""; // picking the same file twice must still fire onChange
      }}
    />
  );

  if (file) {
    const Icon = VIDEO_EXT.includes(extensionOf(file.name)) ? FileVideo : FileAudio;
    return (
      <div className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900/60">
        {input}
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-950 dark:text-primary-400">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{file.name}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{fileSize(file.size)}</p>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className={cx(
            "inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-600 hover:bg-white hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
            focusRing,
          )}
        >
          <Replace className="size-3.5" aria-hidden="true" />
          Replace
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={disabled}
          aria-label="Remove the chosen file"
          className={cx(
            "rounded-lg p-1.5 text-zinc-400 hover:bg-white hover:text-zinc-700 disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-200",
            focusRing,
          )}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div {...dragProps}>
      {input}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className={cx(
          "flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors disabled:opacity-60",
          dragging
            ? "border-primary-500 bg-primary-50 dark:bg-primary-950/40"
            : invalid
              ? "border-red-300 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20"
              : "border-zinc-200 bg-zinc-50/60 hover:border-primary-400 hover:bg-primary-50/40 dark:border-zinc-700 dark:bg-zinc-900/40 dark:hover:border-primary-600 dark:hover:bg-primary-950/20",
          focusRing,
        )}
      >
        <span className="flex size-11 items-center justify-center rounded-full bg-white text-primary-600 shadow-sm dark:bg-zinc-800 dark:text-primary-400">
          <Upload className="size-5" aria-hidden="true" />
        </span>
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {dragging ? "Drop the file to add it" : "Drag and drop an audio or video file"}
        </span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          or press Enter to choose one · mp3, wav, m4a, mp4, webm, mkv, mov and more
        </span>
      </button>
    </div>
  );
}
