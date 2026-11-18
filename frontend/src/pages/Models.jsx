import { useCallback, useEffect, useState } from "react";
import { AudioLines, Cpu, Download, Gauge, MemoryStick, MonitorCog, Sparkles, Trash2, Users } from "lucide-react";

import { api } from "../api";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Input,
  ProgressBar,
  Skeleton,
  Toggle,
  cx,
  focusRing,
  toast,
} from "../ui";

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

const sizeMb = (mb) => (mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb} MB`);

/** A list of choices as radio buttons; the chosen one is ringed in the accent. */
function Choice({ name, checked, onPick, children }) {
  return (
    <label
      className={cx(
        "flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors",
        checked
          ? "border-primary-500 bg-primary-50 dark:border-primary-400 dark:bg-primary-950/60"
          : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60",
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onPick} className={cx("accent-primary-600", focusRing)} />
      {children}
    </label>
  );
}

function WhisperCard({ whisper, ram, onSave }) {
  const rec = whisper.sizes.find((x) => x.name === whisper.recommended);
  const cur = whisper.sizes.find((x) => x.name === whisper.current);
  const tooBig = cur && rec && cur.ram_gb > rec.ram_gb;
  return (
    <Card className="pb-5">
      <CardHeader title="Speech to text" icon={AudioLines} />
      <p className="px-5 pt-1 text-sm text-zinc-600 dark:text-zinc-400">
        Larger Whisper models hear more accurately but need more memory and time. A model downloads on first use.
      </p>
      <fieldset className="mt-4 grid gap-2 px-5 sm:grid-cols-2">
        <legend className="sr-only">Whisper model</legend>
        {whisper.sizes.map((w) => (
          <Choice key={w.name} name="whisper" checked={w.name === whisper.current} onPick={() => onSave({ whisper_model: w.name })}>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{w.name}</span>
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                ~{w.ram_gb} GB RAM · {sizeMb(w.download_mb)} download
              </span>
            </span>
            {w.name === whisper.recommended && <Badge tone="primary">Recommended</Badge>}
            {w.downloaded && <Badge tone="green">Downloaded</Badge>}
          </Choice>
        ))}
      </fieldset>
      {tooBig && (
        <p role="status" className="mx-5 mt-3 flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
          <Badge tone="amber">Heavy</Badge>
          {cur.name} needs about {cur.ram_gb} GB, more than this {ram ? `${ram} GB ` : ""}machine is tuned for. Long
          meetings may be slow or run out of memory.
        </p>
      )}
    </Card>
  );
}

// "qwen2.5:7b" -> 7: the billions of parameters a name states, to compare sizes; null if none
const params = (name) => {
  const m = /(\d+(?:\.\d+)?)b\b/i.exec(name || "");
  return m ? Number(m[1]) : null;
};
const same = (a, b) => a?.replace(/:latest$/, "") === b?.replace(/:latest$/, "");

/** Download a model by name; shows the running (or last) pull with a progress bar. */
function PullBox({ pull, recommended, reachable, onPull }) {
  const [name, setName] = useState("");
  const running = pull?.running;
  return (
    <div className="mx-5 mt-5 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onPull(name.trim());
        }}
      >
        <Input
          label="Download model"
          hint={`An Ollama model name, e.g. ${recommended}.`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={recommended}
          className="min-w-56 flex-1"
          disabled={running || !reachable}
        />
        <Button type="submit" icon={Download} disabled={running || !reachable || !name.trim()} className="mb-6">
          Download
        </Button>
      </form>
      {pull && (
        <div className="mt-1 flex flex-col gap-1.5" aria-live="polite">
          <div className="flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-400">
            <span>
              {pull.model}: {pull.status === "success" ? "downloaded" : pull.status === "error" ? "failed" : pull.status}
            </span>
            <span>{pull.percent}%</span>
          </div>
          <ProgressBar value={pull.percent} label={`Downloading ${pull.model}`} />
          {pull.status === "error" && <p className="text-xs text-red-600 dark:text-red-400">{pull.error}</p>}
        </div>
      )}
    </div>
  );
}

function SummariesCard({ ollama, pull, onSave, onDelete, onPull }) {
  const cloud = ollama.provider !== "ollama";
  const big = params(ollama.current) > (params(ollama.recommended) ?? Infinity);
  return (
    <Card className="pb-5">
      <CardHeader title="Summaries" icon={Sparkles} />
      <p className="px-5 pt-1 text-sm text-zinc-600 dark:text-zinc-400">
        The Ollama model that writes summaries, key points and action items. Recommended here:{" "}
        <span className="font-medium text-zinc-900 dark:text-zinc-100">{ollama.recommended}</span>.
      </p>
      {cloud && (
        <p className="mx-5 mt-3 flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
          <Badge tone="amber">Cloud</Badge>
          Notes are written by {ollama.provider} now. These models are used when the provider in Settings is Ollama.
        </p>
      )}
      {!ollama.reachable ? (
        <p className="mx-5 mt-4 text-sm text-zinc-600 dark:text-zinc-400">
          Ollama is not answering, so its models cannot be listed. Check Settings → AI Model.
        </p>
      ) : ollama.installed.length === 0 ? (
        <p className="mx-5 mt-4 text-sm text-zinc-600 dark:text-zinc-400">No models installed yet. Download one below.</p>
      ) : (
        <fieldset className="mt-4 flex flex-col gap-2 px-5">
          <legend className="sr-only">Summary model</legend>
          {ollama.installed.map((m) => {
            const current = same(m.name, ollama.current);
            return (
              <div key={m.name} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <Choice name="llm" checked={current} onPick={() => onSave({ llm_model: m.name.replace(/:latest$/, "") })}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{m.name}</span>
                      <span className="block text-xs text-zinc-500 dark:text-zinc-400">{(m.size / 1e9).toFixed(1)} GB on disk</span>
                    </span>
                    {same(m.name, ollama.recommended) && <Badge tone="primary">Recommended</Badge>}
                  </Choice>
                </div>
                {/* the model in use cannot be removed (the server refuses it too) */}
                <IconButton
                  icon={Trash2}
                  label={current && !cloud ? `${m.name} is in use` : `Delete ${m.name}`}
                  disabled={current && !cloud}
                  onClick={() => onDelete(m.name)}
                />
              </div>
            );
          })}
        </fieldset>
      )}
      {big && (
        <p role="status" className="mx-5 mt-3 flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
          <Badge tone="amber">Heavy</Badge>
          {ollama.current} is larger than this machine's {ollama.recommended}. Summaries may be slow.
        </p>
      )}
      <PullBox pull={pull} recommended={ollama.recommended} reachable={ollama.reachable} onPull={onPull} />
    </Card>
  );
}

function SpeakersCard({ diarization, onSave }) {
  return (
    <Card className="pb-5">
      <CardHeader title="Speakers" icon={Users} />
      <div className="flex flex-col gap-3 px-5 pt-3">
        <Toggle
          checked={diarization.enabled}
          onChange={(on) => onSave({ diarize: on })}
          label="Tell speakers apart (Speaker 1, Speaker 2…)"
        />
        <p className="flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          {diarization.available ? (
            <Badge tone="green" dot>
              Models present
            </Badge>
          ) : (
            <Badge tone="amber" dot>
              Models missing
            </Badge>
          )}
          {diarization.available
            ? "Runs after transcription, on this machine. Adds a little time to each meeting."
            : "Speaker labels are skipped until the diarization models are in the models folder."}
        </p>
      </div>
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

  const [deleting, setDeleting] = useState(null);
  async function remove() {
    const name = deleting;
    setDeleting(null);
    try {
      await api(`/api/models/${encodeURIComponent(name)}`, { method: "DELETE" });
      toast(`Deleted ${name}`, "green");
      load();
    } catch (e) {
      toast(e.message, "red");
    }
  }

  // Poll every 2 s, but only while a download runs (it moves; nothing else here does).
  const pulling = !!data?.pull?.running;
  useEffect(() => {
    if (!pulling) return undefined;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [pulling, load]);

  async function pull(name) {
    // The server queues the download and answers at once; start polling anyway, so a slow
    // answer never delays the progress bar.
    const poll = setTimeout(load, 800);
    try {
      await api("/api/models/pull", { method: "POST", body: { model: name } });
    } catch (e) {
      toast(e.message, "red");
    } finally {
      clearTimeout(poll);
      load();
    }
  }

  // Picks go to the settings store, the same one Settings -> AI Model writes (R1.7).
  async function save(patch) {
    try {
      await api("/api/settings/", { method: "PATCH", body: patch });
      toast("Saved. The next meeting uses it.", "green");
      load();
    } catch (e) {
      toast(e.message, "red");
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">Models</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          The models that turn speech into text and write your notes.
          {/* only claim "all local" when it is: a cloud provider sends the transcript out */}
          {data?.ollama.provider === "ollama" && " Everything here runs on this machine."}
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
        <>
          <HardwareCard hw={data.hardware} />
          <WhisperCard whisper={data.whisper} ram={data.hardware.ram_gb} onSave={save} />
          <SummariesCard ollama={data.ollama} pull={data.pull} onSave={save} onDelete={setDeleting} onPull={pull} />
          <SpeakersCard diarization={data.diarization} onSave={save} />
          <ConfirmDialog open={deleting !== null} title="Delete model?" onConfirm={remove} onCancel={() => setDeleting(null)}>
            {deleting} is removed from Ollama. You can download it again later.
          </ConfirmDialog>
        </>
      )}
    </div>
  );
}
