import { useCallback, useEffect, useId, useState } from "react";
import { AlertTriangle, Check, Cpu, Mic, Palette, PlugZap, Save, Settings as SettingsIcon, UserRound } from "lucide-react";

import { api } from "../api";
import { KEYS, TITLE_FORMATS, readPrefs, writePref } from "../record/prefs";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  FONTS,
  Input,
  Select,
  StatusDot,
  THEMES,
  Tabs,
  Toggle,
  cx,
  focusRing,
  tabPanelProps,
  useFont,
  useTheme,
} from "../ui";

const TABS = [
  { value: "general", label: "General" },
  { value: "ai", label: "AI Model" },
  { value: "recording", label: "Recording" },
  { value: "appearance", label: "Appearance" },
];

// Where the notes are written. Ollama is the only one that keeps everything on this machine.
const PROVIDERS = [
  { value: "ollama", label: "Ollama (on this machine)" },
  { value: "openai", label: "OpenAI" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "anthropic", label: "Anthropic" },
  { value: "custom", label: "Other OpenAI-compatible server" },
];
const CLOUD_NAME = { openai: "OpenAI", openrouter: "OpenRouter", anthropic: "Anthropic", custom: "that server" };

/** The swatches of each theme card: page, sidebar, card and accent, from the UI v2 spec. */
const PREVIEW = {
  indigo: ["#080C1A", "#0E0F2A", "#151D36", "#4942E3"],
  teal: ["#0E1D25", "#0D1D26", "#16303b", "#14B8A6"],
  amber: ["#1E1A1D", "#1D191D", "#2a2428", "#F59E0B"],
  slate: ["#EAECFC", "#E6E9FB", "#ffffff", "#6966E8"],
};

function useSaver() {
  const [state, setState] = useState({ busy: false, saved: false, error: "" });
  const run = useCallback(async (fn) => {
    setState({ busy: true, saved: false, error: "" });
    try {
      const out = await fn();
      setState({ busy: false, saved: true, error: "" });
      setTimeout(() => setState((s) => ({ ...s, saved: false })), 2500);
      return out;
    } catch (e) {
      setState({ busy: false, saved: false, error: e.message });
      return null;
    }
  }, []);
  return [state, run];
}

function SaveRow({ state, onSave, disabled }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      {state.error && (
        <p role="alert" className="mr-auto text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
      <span aria-live="polite" className="text-sm text-zinc-500 dark:text-zinc-400">
        {state.saved ? "Saved" : ""}
      </span>
      <Button icon={state.saved ? Check : Save} onClick={onSave} disabled={disabled || state.busy}>
        {state.busy ? "Saving…" : "Save Settings"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- General

function General({ settings, onSaved }) {
  const [name, setName] = useState(settings.display_name || "");
  const [titleFormat, setTitleFormat] = useState(readPrefs().titleFormat);
  const [state, save] = useSaver();

  return (
    <Card>
      <CardHeader title="General" icon={UserRound} />
      <div className="flex flex-col gap-5 px-5 pt-3 pb-5">
        <Input
          label="Display name"
          value={name}
          maxLength={60}
          placeholder="Your name"
          hint="Shown on Home and as the initials of your avatar."
          onChange={(e) => setName(e.target.value)}
        />
        <Select
          label="Default title for new recordings"
          value={titleFormat}
          onChange={(e) => setTitleFormat(e.target.value)}
          options={TITLE_FORMATS.map((f) => ({ value: f.id, label: f.label }))}
          hint="Uploaded files keep their file name."
        />
        <SaveRow
          state={state}
          onSave={() =>
            save(async () => {
              writePref(KEYS.titleFormat, titleFormat);
              onSaved(await api("/api/settings/", { method: "PATCH", body: { display_name: name.trim() || null } }));
            })
          }
        />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- AI Model

function Connection({ result }) {
  if (!result) return null;
  return result.connected ? (
    <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
      <StatusDot tone="green" label="Connected" /> Connected
      {result.models.length ? ` · ${result.models.length} model${result.models.length === 1 ? "" : "s"}` : ""}
    </p>
  ) : (
    <p role="alert" className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
      <StatusDot tone="red" label="Not connected" className="mt-1" /> {result.error}
    </p>
  );
}

function AiModel({ settings, system, onSaved }) {
  const [form, setForm] = useState(() => ({
    llm_provider: settings.llm_provider || "ollama",
    ollama_url: settings.ollama_url || "",
    llm_model: settings.llm_model || "",
    api_base_url: settings.api_base_url || "",
    api_key: "",
    api_model: settings.api_model || "",
    num_ctx: settings.num_ctx ?? "",
    cpu_threads: settings.cpu_threads ?? "",
    diarize: settings.diarize ?? null,
  }));
  const [advanced, setAdvanced] = useState(false);
  const [pending, setPending] = useState(null); // a cloud provider waiting for the privacy OK
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);
  const [state, save] = useSaver();
  const listId = useId();
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const cloud = form.llm_provider !== "ollama";

  // Values this tab sends; empty means "use the tier default" (null removes the override).
  const payload = () => {
    const blank = (v) => (v === "" || v === undefined ? null : v);
    const body = {
      llm_provider: cloud ? form.llm_provider : null,
      ollama_url: blank(form.ollama_url.trim()),
      llm_model: blank(form.llm_model),
      num_ctx: blank(form.num_ctx === "" ? "" : Number(form.num_ctx)),
      cpu_threads: blank(form.cpu_threads === "" ? "" : Number(form.cpu_threads)),
      diarize: form.diarize,
    };
    if (cloud) {
      body.api_model = blank(form.api_model.trim());
      body.api_base_url = form.llm_provider === "custom" ? blank(form.api_base_url.trim()) : null;
      if (form.api_key.trim()) body.api_key = form.api_key.trim(); // empty keeps the saved key
    }
    return body;
  };

  async function runTest() {
    setTesting(true);
    try {
      const body = payload();
      setTest(await api("/api/settings/test", { method: "POST", body: { ...body, llm_provider: form.llm_provider } }));
    } catch (e) {
      setTest({ connected: false, models: [], error: e.message });
    } finally {
      setTesting(false);
    }
  }

  // Ask Ollama for its models once, so the model list is there without a click.
  useEffect(() => {
    if (!cloud) runTest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.llm_provider]);

  const ollamaModels = !cloud && test?.connected ? test.models : [];
  const tierDefault = system?.llm_provider === "ollama" || !system ? system?.llm_model : "";

  return (
    <Card>
      <CardHeader title="AI Model" icon={Cpu} />
      <div className="flex flex-col gap-5 px-5 pt-3 pb-5">
        <Select
          label="Model provider"
          value={form.llm_provider}
          onChange={(e) => {
            const next = e.target.value;
            // Leaving the local model: ask first, the transcripts would leave this machine.
            if (form.llm_provider === "ollama" && next !== "ollama") setPending(next);
            else {
              set({ llm_provider: next });
              setTest(null);
            }
          }}
          options={PROVIDERS}
          hint={cloud ? undefined : "Run models locally for full privacy."}
        />

        {cloud && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              Transcripts are sent to {CLOUD_NAME[form.llm_provider]} to write summaries and answer questions, and
              that provider bills your API key. Audio never leaves this machine: transcription and speakers stay
              local. Signing in with a ChatGPT or Claude subscription is not possible; use an API key.
            </span>
          </div>
        )}

        {!cloud ? (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <Input
                label="Server URL"
                className="min-w-64 flex-1"
                value={form.ollama_url}
                placeholder="http://localhost:11434 (from OLLAMA_URL)"
                onChange={(e) => set({ ollama_url: e.target.value })}
              />
              <Button variant="secondary" icon={PlugZap} onClick={runTest} disabled={testing}>
                {testing ? "Testing…" : "Test Connection"}
              </Button>
            </div>
            <Connection result={test} />
            <Select
              label="Model name"
              value={form.llm_model}
              onChange={(e) => set({ llm_model: e.target.value })}
              options={[
                { value: "", label: `Tier default${tierDefault ? ` (${tierDefault})` : ""}` },
                ...ollamaModels.map((m) => ({ value: m, label: m })),
                ...(form.llm_model && !ollamaModels.includes(form.llm_model) ? [{ value: form.llm_model, label: `${form.llm_model} (not installed)` }] : []),
              ]}
              hint={
                <>
                  The next meeting uses it. Download or remove models on the{" "}
                  <a href="#/models" className={cx("text-primary-600 underline dark:text-primary-400", focusRing)}>
                    Models
                  </a>{" "}
                  page.
                </>
              }
            />
          </>
        ) : (
          <>
            {form.llm_provider === "custom" && (
              <Input
                label="Server URL"
                value={form.api_base_url}
                placeholder="http://localhost:1234/v1"
                hint="The base URL of the OpenAI-compatible API (it serves /chat/completions)."
                onChange={(e) => set({ api_base_url: e.target.value })}
              />
            )}
            <Input
              label="API key"
              type="password"
              autoComplete="off"
              value={form.api_key}
              placeholder={settings.api_key_set ? "Saved. Type a new key to replace it." : "Paste your API key"}
              hint="Stored only in this PrivMeet server's settings file; never shown again."
              onChange={(e) => set({ api_key: e.target.value })}
            />
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-64 flex-1">
                <Input
                  label="Model"
                  value={form.api_model}
                  list={listId}
                  placeholder="The model id from your provider"
                  onChange={(e) => set({ api_model: e.target.value })}
                />
                <datalist id={listId}>
                  {(test?.models || []).map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>
              <Button variant="secondary" icon={PlugZap} onClick={runTest} disabled={testing}>
                {testing ? "Testing…" : "Test Connection"}
              </Button>
            </div>
            <Connection result={test} />
          </>
        )}

        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800">
          <button
            type="button"
            aria-expanded={advanced}
            onClick={() => setAdvanced((a) => !a)}
            className={cx("flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-zinc-800 dark:text-zinc-100", focusRing)}
          >
            Advanced Options
            <span className="text-zinc-400" aria-hidden="true">
              {advanced ? "−" : "+"}
            </span>
          </button>
          {advanced && (
            <div className="grid gap-4 border-t border-zinc-200 px-4 py-4 sm:grid-cols-2 dark:border-zinc-800">
              <Input
                label="Context length (num_ctx)"
                type="number"
                min={512}
                max={131072}
                step={512}
                value={form.num_ctx}
                placeholder="Tier default"
                hint="Tokens the model reads at once. Bigger uses more RAM."
                onChange={(e) => set({ num_ctx: e.target.value })}
              />
              <Input
                label="CPU threads"
                type="number"
                min={1}
                max={256}
                value={form.cpu_threads}
                placeholder="Half the cores"
                hint="Used by Whisper and the local model."
                onChange={(e) => set({ cpu_threads: e.target.value })}
              />
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Toggle
                  checked={form.diarize ?? !!system?.diarize}
                  onChange={(on) => set({ diarize: on })}
                  label="Find speakers (diarization)"
                />
                <p className="pl-12 text-xs text-zinc-500 dark:text-zinc-400">
                  {form.diarize === null ? "Following the hardware tier. " : ""}Off on the low tier to save RAM.
                  {form.diarize !== null && (
                    <button type="button" onClick={() => set({ diarize: null })} className={cx("ml-1 underline", focusRing)}>
                      Use the tier default
                    </button>
                  )}
                </p>
              </div>
            </div>
          )}
        </div>

        <ConfirmDialog
          open={!!pending}
          title="Privacy might be compromised"
          confirmLabel={`Use ${PROVIDERS.find((p) => p.value === pending)?.label || "it"}`}
          danger={false}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            set({ llm_provider: pending });
            setTest(null);
            setPending(null);
          }}
        >
          <span className="flex flex-col gap-2">
            <span>
              With {CLOUD_NAME[pending] || "a cloud provider"}, the text of every meeting transcript is sent off this
              machine to write summaries and answer questions. It may be stored or logged under that provider&apos;s
              terms, and your API key is billed.
            </span>
            <span>Audio, transcription and speaker detection still stay on this machine.</span>
            <span>Keep Ollama for meetings that must not leave your computer. Nothing changes until you save.</span>
          </span>
        </ConfirmDialog>

        <SaveRow
          state={state}
          disabled={cloud && !form.api_model.trim()}
          onSave={() => save(async () => onSaved(await api("/api/settings/", { method: "PATCH", body: payload() })))}
        />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- Recording

function Recording() {
  const [prefs, setPrefs] = useState(readPrefs);
  const [devices, setDevices] = useState([]);
  const [saved, setSaved] = useState("");

  const listMics = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === "audioinput").map((d, i) => ({ value: d.deviceId, label: d.label || `Microphone ${i + 1}` })));
    } catch {
      setDevices([]);
    }
  }, []);
  useEffect(() => {
    listMics();
  }, [listMics]);

  // Device names stay hidden until the site may use the mic once.
  async function allow() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      listMics();
    } catch {
      setSaved("The browser blocked the microphone.");
    }
  }

  const update = (key, value) => {
    writePref(KEYS[key], value);
    setPrefs((p) => ({ ...p, [key]: value }));
    setSaved("Saved in this browser");
    setTimeout(() => setSaved(""), 2000);
  };
  const named = devices.some((d) => !d.label.startsWith("Microphone "));

  return (
    <Card>
      <CardHeader title="Recording" icon={Mic} />
      <div className="flex flex-col gap-5 px-5 pt-3 pb-5">
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label="Default microphone"
            className="min-w-64 flex-1"
            value={prefs.mic}
            onChange={(e) => update("mic", e.target.value)}
            options={[{ value: "", label: "Browser default" }, ...devices]}
          />
          {!named && devices.length > 0 && (
            <Button variant="secondary" icon={Mic} onClick={allow}>
              Show device names
            </Button>
          )}
        </div>
        <Toggle checked={prefs.systemAudio} onChange={(on) => update("systemAudio", on)} label="Include tab or system audio when sharing" />
        <Toggle checked={prefs.camera} onChange={(on) => update("camera", on)} label="Turn the camera on when the recorder opens" />
        <p aria-live="polite" className="text-xs text-zinc-500 dark:text-zinc-400">
          {saved || "These defaults are kept in this browser only."}
        </p>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- Appearance

function ThemeCard({ theme, selected, onPick }) {
  const [page, side, card, accent] = PREVIEW[theme.id];
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onPick}
      className={cx(
        "flex flex-col gap-3 rounded-2xl border p-3 text-left transition-shadow",
        selected
          ? "border-primary-500 ring-2 ring-primary-500 dark:border-primary-400 dark:ring-primary-400"
          : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700",
        focusRing,
      )}
    >
      {/* A tiny drawing of the app in this theme: sidebar, hero, rows. */}
      <span aria-hidden="true" className="flex h-24 overflow-hidden rounded-lg" style={{ background: page }}>
        <span className="flex w-1/4 flex-col gap-1 p-1.5" style={{ background: side }}>
          <span className="h-2 w-full rounded-sm" style={{ background: accent }} />
          <span className="h-1.5 w-3/4 rounded-sm opacity-40" style={{ background: accent }} />
          <span className="h-1.5 w-3/4 rounded-sm opacity-40" style={{ background: accent }} />
        </span>
        <span className="flex flex-1 flex-col gap-1.5 p-2">
          <span className="h-8 rounded" style={{ background: `linear-gradient(120deg, ${card}, ${accent})` }} />
          {[0, 1].map((i) => (
            <span key={i} className="flex h-3 items-center gap-1 rounded px-1" style={{ background: card }}>
              <span className="size-1.5 rounded-sm" style={{ background: accent }} />
              <span className="h-1 flex-1 rounded-sm opacity-30" style={{ background: accent }} />
            </span>
          ))}
        </span>
      </span>
      <span className="flex items-start gap-2.5">
        <span className="mt-1 size-3 shrink-0 rounded-full" style={{ background: accent }} aria-hidden="true" />
        <span>
          <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{theme.name}</span>
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">{theme.caption}</span>
        </span>
      </span>
    </button>
  );
}

/** Font choice: each card previews its font with the same sample. */
function FontCard({ font, selected, onPick }) {
  const family =
    font.id === "pixel" ? '"Monocraft", monospace' : '"Inter", ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif';
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onPick}
      className={cx(
        "flex flex-col gap-2 rounded-2xl border p-4 text-left",
        selected
          ? "border-primary-500 ring-2 ring-primary-500 dark:border-primary-400 dark:ring-primary-400"
          : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700",
        focusRing,
      )}
    >
      <span className="text-2xl text-zinc-900 dark:text-zinc-100" style={{ fontFamily: family }} aria-hidden="true">
        Aa · Project Sync 10:42
      </span>
      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
        {font.name}
        {font.id === "pixel" && <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">(default)</span>}
      </span>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">{font.caption}</span>
    </button>
  );
}

function Appearance() {
  const [theme, setTheme] = useTheme();
  const [font, setFont] = useFont();
  return (
    <Card>
      <CardHeader title="Appearance" icon={Palette} />
      <div className="px-5 pt-3 pb-5">
        <div role="radiogroup" aria-label="Theme" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {THEMES.map((t) => (
            <ThemeCard key={t.id} theme={t} selected={t.id === theme} onPick={() => setTheme(t.id)} />
          ))}
        </div>
        <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
          Each theme has its own landscape at the bottom of the page. Look closely: every one hides a few surprises.
        </p>
        <h3 className="mt-6 mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Font</h3>
        <div role="radiogroup" aria-label="Font" className="grid gap-4 sm:grid-cols-2">
          {FONTS.map((f) => (
            <FontCard key={f.id} font={f} selected={f.id === font} onPick={() => setFont(f.id)} />
          ))}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- page

/** Settings: General, AI Model, Recording and Appearance (layout from mockup-v1, v2 look). */
export default function Settings() {
  const [tab, setTab] = useState("general");
  const [settings, setSettings] = useState(null);
  const [system, setSystem] = useState(null);
  const [error, setError] = useState("");
  const tabsId = useId();

  const load = useCallback(() => {
    Promise.all([api("/api/settings/").catch(() => ({})), api("/api/system/").catch(() => null)])
      .then(([s, sys]) => {
        setSettings(s || {});
        setSystem(sys);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const saved = (s) => {
    setSettings(s);
    api("/api/system/").then(setSystem).catch(() => {});
  };

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <div className="flex items-center gap-3">
        <SettingsIcon className="size-6 text-primary-600 dark:text-primary-400" aria-hidden="true" />
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">Settings</h1>
        {system && (
          <Badge tone="primary" className="ml-auto">
            {system.tier} tier · {system.llm_model || "no model"}
          </Badge>
        )}
      </div>
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <Tabs id={tabsId} tabs={TABS} value={tab} onChange={setTab} label="Settings sections" className="min-w-max" />
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div {...tabPanelProps(tabsId, tab)}>
        {!settings ? (
          <Card className="h-48 animate-pulse" />
        ) : tab === "general" ? (
          <General settings={settings} onSaved={saved} />
        ) : tab === "ai" ? (
          <AiModel settings={settings} system={system} onSaved={saved} />
        ) : tab === "recording" ? (
          <Recording />
        ) : (
          <Appearance />
        )}
      </div>
    </section>
  );
}
