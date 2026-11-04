import { Card, EmptyState } from "../ui";

/** Body for pages whose real screen lands in a later task; keeps every route inside the shell meanwhile. */
export default function Placeholder({ title, icon, task, action, children }) {
  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-4">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{title}</h1>
      <Card>
        <EmptyState icon={icon} title={`Coming in ${task}`} action={action}>
          {children}
        </EmptyState>
      </Card>
    </section>
  );
}
