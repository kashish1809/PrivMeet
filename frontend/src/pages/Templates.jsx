import { useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  Briefcase,
  LayoutTemplate,
  MessagesSquare,
  NotebookPen,
  Sparkles,
  UserRound,
  Users,
} from "lucide-react";

import { api } from "../api";
import { Badge, Card, EmptyState, Skeleton } from "../ui";

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

/** Note templates (R1.10): what a meeting's summary focuses on. Backend: R1.9. */
export default function Templates() {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");

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
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">Templates</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          A template tells the AI what to focus on when it writes a meeting's notes.
        </p>
      </header>
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
