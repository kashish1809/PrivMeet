import { useEffect, useState } from "react";
import { MessageCircleQuestion, Send } from "lucide-react";

import { askMeeting, getMeeting, getQuestion } from "../api";
import { isProcessing } from "../format";
import { Button, Card, IconButton, Input } from "../ui";

const POLL_MS = 2000;
const CITE = /(\[\d{1,2}(?::\d{2}){1,2}\])/g;

/** "[01:23]" (or "[1:02:03]") in an answer becomes a button that seeks the player. */
function withCitations(text, onSeek) {
  return text.split(CITE).map((part, i) => {
    if (!part.startsWith("[") || !part.endsWith("]")) return part;
    const seconds = part
      .slice(1, -1)
      .split(":")
      .reduce((total, n) => total * 60 + Number(n), 0);
    return (
      <button
        key={i}
        type="button"
        onClick={() => onSeek?.(seconds)}
        className="rounded bg-primary-50 px-1 font-mono text-xs text-primary-700 hover:bg-primary-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 dark:bg-primary-950 dark:text-primary-300 dark:hover:bg-primary-900"
      >
        {part.slice(1, -1)}
      </button>
    );
  });
}

/**
 * Q&A under the transcript: question box, POST /ask, then poll /api/questions/<id>/
 * until the answer is no longer pending. Citations call `onSeek(seconds)`.
 * The back end only answers a `done` meeting, so the box stays disabled until then.
 */
export default function QABox({ meetingId, onSeek }) {
  const [ready, setReady] = useState(null); // null = still checking
  const [history, setHistory] = useState([]);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer;
    async function check() {
      try {
        const m = await getMeeting(meetingId);
        if (!alive) return;
        setReady(m.status === "done");
        if (isProcessing(m)) timer = setTimeout(check, POLL_MS); // it may finish while we look
      } catch {
        if (alive) setReady(false);
      }
    }
    check();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [meetingId]);

  const pending = history.filter((q) => q.status === "pending").map((q) => q.id).join(",");

  useEffect(() => {
    if (!pending) return undefined;
    const timer = setInterval(() => {
      Promise.all(pending.split(",").map((id) => getQuestion(id).catch(() => null))).then((answers) =>
        setHistory((list) => list.map((q) => answers.find((a) => a && a.id === q.id) ?? q)),
      );
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [pending]);

  async function submit(e) {
    e.preventDefault();
    const text = question.trim();
    if (!text || !ready || sending) return;
    setSending(true);
    setError("");
    try {
      const created = await askMeeting(meetingId, text);
      setHistory((list) => [...list, created]);
      setQuestion("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <div className="flex items-center gap-2 px-5 pt-4">
        <MessageCircleQuestion className="size-4 text-primary-600 dark:text-primary-400" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Ask about this meeting</h3>
      </div>

      {history.length > 0 && (
        <ol className="space-y-4 px-5 pt-4">
          {history.map((q) => (
            <li key={q.id}>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{q.question}</p>
              <p
                aria-live="polite"
                className="mt-1 text-sm whitespace-pre-line text-zinc-700 dark:text-zinc-300"
              >
                {q.status === "pending"
                  ? "Thinking…"
                  : q.status === "failed"
                    ? "That answer failed. Try asking again."
                    : withCitations(q.answer, onSeek)}
              </p>
            </li>
          ))}
        </ol>
      )}

      <form onSubmit={submit} className="flex items-end gap-2 px-5 py-4">
        <Input
          label="Your question"
          className="flex-1"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={ready ? "What did we decide about the launch date?" : "Available when processing finishes"}
          disabled={!ready}
        />
        <IconButton
          type="submit"
          icon={Send}
          label="Ask"
          variant="primary"
          disabled={!ready || sending || !question.trim()}
        />
      </form>

      {!ready && ready !== null && (
        <p className="-mt-2 px-5 pb-4 text-xs text-zinc-500 dark:text-zinc-400">
          Q&amp;A needs a finished transcript.
        </p>
      )}
      {error && (
        <p role="alert" className="px-5 pb-4 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </Card>
  );
}
