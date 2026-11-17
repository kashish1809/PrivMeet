import { useCallback, useEffect, useState } from "react";
import { Cpu, Gauge, MemoryStick, MonitorCog } from "lucide-react";

import { api } from "../api";
import { Badge, Card, CardHeader, EmptyState, Skeleton } from "../ui";

/** One "label: value" line in a card. */
function Fact({ icon: Icon, label, children }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-950 dark:text-primary-400">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
        <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{children}</div>
      </div>
    </div>
  );
}

function HardwareCard({ hw }) {
  return (
    <Card className="pb-5">
      <CardHeader title="Hardware" icon={MonitorCog} />
      <div className="grid gap-4 px-5 pt-4 sm:grid-cols-3">
        <Fact icon={Gauge} label="Tier">
          <span className="capitalize">{hw.tier}</span>
        </Fact>
        <Fact icon={MemoryStick} label="Memory">
          {hw.ram_gb ? `${hw.ram_gb} GB` : "Unknown"}
        </Fact>
        <Fact icon={Cpu} label="Runs on">
          {hw.gpu ? "NVIDIA GPU" : "CPU"}
        </Fact>
      </div>
      {hw.cuda_error && (
        <p className="mx-5 mt-4 rounded-lg bg-zinc-100 p-3 text-xs text-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-300">
          <Badge tone="amber">GPU unusable</Badge> {hw.cuda_error}
        </p>
      )}
    </Card>
  );
}

/** Models (R1.12): what runs where, and the models to pick, download or remove. Backend: R1.11. */
export default function Models() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(
    () =>
      api("/api/models/")
        .then((d) => {
          setData(d);
          setError("");
          return d;
        })
        .catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">Models</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          The models that turn speech into text and write your notes. Everything here runs on this machine.
        </p>
      </header>
      {error ? (
        <Card>
          <EmptyState icon={Cpu} title="Models are not available">
            {/404|not found/i.test(error) ? "This needs a newer PrivMeet server." : error}
          </EmptyState>
        </Card>
      ) : !data ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading models">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="flex flex-col gap-3 p-5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-10 w-full" />
            </Card>
          ))}
        </div>
      ) : (
        <HardwareCard hw={data.hardware} />
      )}
    </div>
  );
}
