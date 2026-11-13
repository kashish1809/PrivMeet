import { useEffect, useRef, useState } from "react";
import { ListChecks, Plus, Trash2 } from "lucide-react";

import { Button, Card, cx } from "../ui";

const BLANK = { owner: "", task: "", due: "", done: false };
const cell = "w-full rounded-md bg-transparent px-1 py-1 text-sm text-zinc-800 placeholder:text-zinc-400 hover:bg-zinc-50 focus:bg-white focus:ring-2 focus:ring-primary-500/30 focus:outline-none dark:text-zinc-100 dark:hover:bg-zinc-800 dark:focus:bg-zinc-900";

/**
 * Action Items. Without `compact` it is the tab's table (checkbox, task, owner, due, delete);
 * with `compact` it is the right-column card of the mockup. Every change is saved through
 * `onSave({ action_items })`, which patches the meeting and resolves to the updated JSON.
 */
export default function ActionItemsPanel({ meeting, onSave, compact }) {
  const [items, setItems] = useState(meeting?.action_items ?? []);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The copy the server has, so a focus/blur without a change sends no PATCH.
  const saved = useRef(meeting?.action_items ?? []);

  // A reload (after a summary or a rename) brings the server's copy back in.
  useEffect(() => {
    saved.current = meeting?.action_items ?? [];
    setItems(saved.current);
  }, [meeting?.action_items]);

  function commit(next) {
    setItems(next);
    if (JSON.stringify(next) === JSON.stringify(saved.current)) return;
    setError("");
    setBusy(true);
    onSave({ action_items: next })
      .then((updated) => {
        if (updated?.action_items) saved.current = updated.action_items;
      })
      .catch((e) => {
        setError(e.message);
        setItems(saved.current); // the server did not take it, show what it has
      })
      .finally(() => setBusy(false));
  }

  const edit = (i, patch) => setItems((list) => list.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const toggle = (i) => commit(items.map((it, j) => (j === i ? { ...it, done: !it.done } : it)));

  const field = (i, key) => ({
    value: items[i][key] ?? "",
    onChange: (e) => edit(i, { [key]: e.target.value }),
    onBlur: () => commit(items), // Enter and Tab both blur, so this covers both
  });

  const add = () => commit([...items, { ...BLANK }]);
  const remove = (i) => commit(items.filter((_, j) => j !== i));

  const checkbox = (i) => (
    <input
      type="checkbox"
      checked={!!items[i].done}
      disabled={busy}
      onChange={() => toggle(i)}
      aria-label={`Mark "${items[i].task || "action item"}" done`}
      className="size-4 shrink-0 cursor-pointer rounded border-zinc-300 accent-primary-600 dark:border-zinc-600"
    />
  );

  if (compact) {
    return (
      <Card>
        <div className="flex items-center gap-2 px-4 pt-4">
          <ListChecks className="size-4 text-primary-600 dark:text-primary-400" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Action Items</h3>
        </div>
        <ul className="space-y-1 px-2 pt-2">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-2 rounded-lg px-2 py-1.5">
              <span className="flex h-6 items-center">{checkbox(i)}</span>
              <input
                aria-label={`Task ${i + 1}`}
                placeholder="Task"
                {...field(i, "task")}
                className={cx(cell, "flex-1", item.done && "text-zinc-400 line-through dark:text-zinc-500")}
              />
              <input
                aria-label={`Owner ${i + 1}`}
                placeholder="Owner"
                {...field(i, "owner")}
                className={cx(cell, "w-20 shrink-0 text-right text-zinc-500 dark:text-zinc-400")}
              />
            </li>
          ))}
        </ul>
        {!items.length && <p className="px-4 pt-2 text-sm text-zinc-500 dark:text-zinc-400">No action items yet.</p>}
        <div className="px-4 py-3">
          <Button variant="secondary" size="sm" icon={Plus} onClick={add} disabled={busy} className="w-full">
            Add Action Item
          </Button>
        </div>
        {error && (
          <p role="alert" className="px-4 pb-3 text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </Card>
    );
  }

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full min-w-md text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <th scope="col" className="w-12 py-3 pl-5">
                <span className="sr-only">Done</span>
              </th>
              <th scope="col" className="py-3">Task</th>
              <th scope="col" className="w-36 py-3">Owner</th>
              <th scope="col" className="w-32 py-3">Due</th>
              <th scope="col" className="w-12 py-3 pr-5">
                <span className="sr-only">Delete</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                <td className="py-2 pl-5">{checkbox(i)}</td>
                <td className="py-2 pr-2">
                  <input aria-label={`Task ${i + 1}`} placeholder="Task" {...field(i, "task")} className={cell} />
                </td>
                <td className="py-2 pr-2">
                  <input aria-label={`Owner ${i + 1}`} placeholder="Owner" {...field(i, "owner")} className={cell} />
                </td>
                <td className="py-2 pr-2">
                  <input aria-label={`Due ${i + 1}`} placeholder="Due" {...field(i, "due")} className={cell} />
                </td>
                <td className="py-2 pr-5 text-right">
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    aria-label={`Delete ${item.task || "action item"}`}
                    className="rounded-md p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40 dark:hover:bg-red-950"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!items.length && (
        <p className="px-5 pt-4 text-sm text-zinc-500 dark:text-zinc-400">No action items yet.</p>
      )}

      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <Button variant="secondary" size="sm" icon={Plus} onClick={add} disabled={busy}>
          Add Action Item
        </Button>
        {error && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
    </Card>
  );
}
