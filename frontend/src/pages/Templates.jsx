import { useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  Briefcase,
  LayoutTemplate,
  MessagesSquare,
  NotebookPen,
  Plus,
  Sparkles,
  UserRound,
  Users,
} from "lucide-react";

import { api } from "../api";
import { Badge, Button, Card, EmptyState, Input, Modal, Skeleton, Textarea, toast } from "../ui";

// An icon per built-in; own templates get the notebook.
const ICONS = {
  general: Sparkles,
  standup: Users,
  "one-on-one": UserRound,
  "client-call": Briefcase,
  interview: MessagesSquare,
  lecture: BookOpen,
};

function TemplateCard({ t }) {
  const Icon = ICONS[t.id] || NotebookPen;
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-950 dark:text-primary-400">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t.name}</h2>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {t.is_default && (
              <Badge tone="green" dot>
                Default
              </Badge>
            )}
            {t.builtin && <Badge tone="gray">Built-in</Badge>}
          </div>
        </div>
      </div>
      <p className="flex-1 text-sm text-zinc-600 dark:text-zinc-400">{t.description || t.instructions}</p>
    </Card>
  );
}

const EMPTY = { name: "", description: "", instructions: "" };

/** New or edit: name, description and instructions, with the server's limits. */
function TemplateDialog({ open, initial, onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setForm(initial ? { name: initial.name, description: initial.description, instructions: initial.instructions } : EMPTY);
      setError("");
    }
  }, [open, initial]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = { name: form.name, description: form.description, instructions: form.instructions };
      const t = initial
        ? await api(`/api/templates/${initial.id}/`, { method: "PATCH", body })
        : await api("/api/templates/", { method: "POST", body });
      onSaved(t);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? "Edit template" : "New template"}
      className="w-[min(36rem,calc(100vw-2rem))]"
    >
      <form onSubmit={save} className="flex flex-col gap-4">
        <Input label="Name" value={form.name} onChange={set("name")} maxLength={60} required placeholder="Sprint retro" />
        <Input
          label="Description"
          value={form.description}
          onChange={set("description")}
          maxLength={200}
          placeholder="What went well, what did not, what to change."
        />
        <Textarea
          label="Instructions for the AI"
          hint={`${form.instructions.length} / 2000. Say what the summary should focus on.`}
          value={form.instructions}
          onChange={set("instructions")}
          maxLength={2000}
          rows={6}
          required
          placeholder="This is a sprint retrospective. List what went well, what went badly and the changes the team agreed to try."
        />
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : initial ? "Save" : "Create"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Note templates (R1.10): what a meeting's summary focuses on. Backend: R1.9. */
export default function Templates() {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  // the dialog: null closed, {} new, a template to edit it
  const [editing, setEditing] = useState(null);

  const load = useCallback(
    () =>
      api("/api/templates/")
        .then((d) => {
          setList(d.templates);
          setError("");
        })
        .catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">Templates</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            A template tells the AI what to focus on when it writes a meeting's notes.
          </p>
        </div>
        {list && (
          <Button icon={Plus} onClick={() => setEditing({})}>
            New Template
          </Button>
        )}
      </header>
      <TemplateDialog
        open={editing !== null}
        initial={editing?.id ? editing : null}
        onClose={() => setEditing(null)}
        onSaved={(t) => {
          setEditing(null);
          toast(`Saved "${t.name}"`, "green");
          load();
        }}
      />
      {error ? (
        <Card>
          <EmptyState icon={LayoutTemplate} title="Templates are not available">
            {error === "Not found" || /404/.test(error) ? "This needs a newer PrivMeet server." : error}
          </EmptyState>
        </Card>
      ) : !list ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading templates">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="flex flex-col gap-3 p-5">
              <Skeleton className="h-10 w-10" rounded="rounded-xl" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-full" />
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((t) => (
            <TemplateCard key={t.id} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}
