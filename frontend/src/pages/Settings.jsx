import { useCallback, useEffect, useId, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  AudioLines,
  Check,
  Cloud,
  CloudUpload,
  Cpu,
  FileText,
  HardDrive,
  Info,
  Lock,
  MessageSquare,
  Mic,
  Palette,
  Pencil,
  PlugZap,
  Save,
  Settings as SettingsIcon,
  ShieldAlert,
  UserRound,
  Users,
  X,
} from "lucide-react";

import { api } from "../api";
import CustomTheme from "./CustomTheme";
import { KEYS, TITLE_FORMATS, readPrefs, writePref } from "../record/prefs";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  customScales,
  cx,
  focusRing,
  FONTS,
  IconButton,
  Input,
  Modal,
  Select,
  shown,
  StatusDot,
  tabPanelProps,
  Tabs,
  THEMES,
  Toggle,
  useCustomTheme,
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
  { value: "openai", label: "ChatGPT (OpenAI)" },
  { value: "anthropic", label: "Claude (Anthropic)" },
  { value: "gemini", label: "Gemini (Google)" },
  { value: "groq", label: "Groq" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "custom", label: "Other OpenAI-compatible server" },
];
const CLOUD_NAME = {
  openai: "OpenAI", openrouter: "OpenRouter", anthropic: "Anthropic", groq: "Groq",
  gemini: "Google", custom: "that server",
};
// Each provider keeps its own key (settings_store: <provider>_api_key), so linking one does
// not unlink another. "custom" keeps using the single api_key.
const LINKED = ["openai", "anthropic", "gemini", "groq", "openrouter"];
// Only these expose /audio/transcriptions, so only they can take transcription off this
// machine. Anthropic, Gemini and OpenRouter have no such endpoint.
const AUDIO_PROVIDERS = ["groq", "openai", "custom"];
const ASR_DEFAULT = { groq: "whisper-large-v3-turbo", openai: "whisper-1" };
const IS_ASR = /whisper|transcrib|speech|stt/i;
// Where the account's API key is created. An account is linked by pasting a key: no provider
// lets another app spend a ChatGPT Plus, Claude Pro or Gemini Advanced subscription.
// What to pick for someone who does not know model ids: the first match in order, against the
// list the account itself returned, so nothing is ever chosen that the account cannot use.
// Chat models good at summarising, cheapest first where quality allows.
const PREFERRED = {
  openai: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4o", "gpt-4.1"],
  anthropic: ["haiku", "sonnet"],
  gemini: ["flash", "pro"],
  groq: ["llama-3.3-70b-versatile", "gpt-oss-120b", "gpt-oss-20b", "llama-3.1-8b-instant", "qwen", "llama"],
  openrouter: ["gpt-4o-mini", "llama-3.3-70b", "haiku", "flash"],
};
// Last resort when an account carries none of the names above: families known to follow
// instructions in English. Without this the fallback was "whatever sorts first", which on a
// Groq account with no Llama models chose allam-2-7b, an Arabic model, to write English notes.
const FAMILIES = ["gpt-oss", "gpt-4", "gpt-5", "qwen", "llama", "mistral", "mixtral", "gemma", "instruct", "chat"];
// Names that are not chat models, so never offer them as the one that writes the notes.
// orpheus and playai are speech, prompt-guard and safeguard are classifiers.
const NOT_CHAT =
  /embed|whisper|tts|audio|image|vision-only|moderation|rerank|guard|dall-e|sora|orpheus|playai|speech/i;

/** The model to use when the user has not chosen one: a preferred id the account offers,
 *  else its first chat model. Returns "" when the list has nothing usable. */
function pickModel(models, provider) {
  const chat = (models || []).filter((m) => !NOT_CHAT.test(m));
  for (const want of [...(PREFERRED[provider] || []), ...FAMILIES]) {
    const hit = chat.find((m) => m.toLowerCase().includes(want.toLowerCase()));
    if (hit) return hit;
  }
  return chat[0] || "";
}

const KEY_PAGE = {
  openai: ["platform.openai.com/api-keys", "https://platform.openai.com/api-keys"],
  anthropic: ["console.anthropic.com/settings/keys", "https://console.anthropic.com/settings/keys"],
  gemini: ["aistudio.google.com/apikey", "https://aistudio.google.com/apikey"],
  groq: ["console.groq.com/keys", "https://console.groq.com/keys"],
  openrouter: ["openrouter.ai/keys", "https://openrouter.ai/keys"],
};

/** The swatches of each theme card: page, sidebar, card and accent, from the UI v2 spec. */
const PREVIEW = {
  indigo: ["#080C1A", "#0E0F2A", "#151D36", "#4942E3"],
  teal: ["#0E1D25", "#0D1D26", "#16303b", "#14B8A6"],
  amber: ["#1E1A1D", "#1D191D", "#2a2428", "#F59E0B"],
  slate: ["#EAECFC", "#E6E9FB", "#ffffff", "#6966E8"],
  rose: ["#130c13", "#1e151d", "#2c202a", "#F43F78"],
  forest: ["#0a140f", "#121f19", "#1c2d24", "#10B981"],
  dawn: ["#fdf5ee", "#f8eadf", "#ffffff", "#F05A33"],
  glacier: ["#edf5fa", "#e1edf5", "#ffffff", "#0EA5E9"],
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

function SaveRow({ state, onSave, disabled, why }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      {state.error && (
        <p role="alert" className="mr-auto text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
      {/* A greyed-out button with no reason on screen is a dead end, so say what is missing. */}
      {!state.error && disabled && why && (
        <p className="mr-auto text-sm text-zinc-500 dark:text-zinc-400">{why}</p>
      )}
      <span aria-live="polite" className="text-sm text-zinc-500 dark:text-zinc-400">
        {state.saved ? "Saved" : ""}
      </span>
      <Button
        icon={state.saved ? Check : Save}
        onClick={onSave}
        disabled={disabled || state.busy}
        title={disabled && why ? why : undefined}
      >
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

function Fact({ icon: Icon, children }) {
  return (
    <li className="flex items-start gap-2">
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}

/**
 * Asked before leaving the local model: what goes to the provider, what stays here, and the
 * fine print, laid out so it can be read at a glance. Nothing is saved until Save Settings.
 */
function PrivacyDialog({ provider, onCancel, onConfirm }) {
  const label = PROVIDERS.find((p) => p.value === provider)?.label || "";
  const name = CLOUD_NAME[provider] || "the provider";
  return (
    <Modal
      open={!!provider}
      onClose={onCancel}
      className="w-[min(38rem,calc(100vw-2rem))]!"
      title={
        <span className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            <ShieldAlert className="size-5" aria-hidden="true" />
          </span>
          Privacy might be compromised
        </span>
      }
      footer={
        <>
          <Button variant="secondary" icon={HardDrive} onClick={onCancel} autoFocus>
            Keep Ollama
          </Button>
          <Button icon={Cloud} onClick={onConfirm}>
            Use {label}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* where the notes are written, before and after */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
            <Lock className="size-3.5" aria-hidden="true" /> Ollama · on this machine
          </span>
          <ArrowRight className="size-4 text-zinc-400" aria-hidden="true" />
          <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <Cloud className="size-3.5" aria-hidden="true" /> {label} · on the internet
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            <p className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
              <CloudUpload className="size-4" aria-hidden="true" /> Leaves this machine
            </p>
            <ul className="flex flex-col gap-1.5 text-sm">
              <Fact icon={FileText}>The text of every meeting transcript</Fact>
              <Fact icon={MessageSquare}>Your questions in Q&amp;A</Fact>
            </ul>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
            <p className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
              <HardDrive className="size-4" aria-hidden="true" /> Stays on this machine
            </p>
            <ul className="flex flex-col gap-1.5 text-sm">
              <Fact icon={AudioLines}>Audio recordings</Fact>
              <Fact icon={Mic}>Transcription (Whisper)</Fact>
              <Fact icon={Users}>Speaker detection</Fact>
            </ul>
          </div>
        </div>

        <p className="flex items-start gap-2 rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800/70 dark:text-zinc-300">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {name} may store or log what it receives under its own terms, and bills your API key. Keep Ollama for
          meetings that must not leave your computer. Nothing changes until you press Save Settings.
        </p>
      </div>
    </Modal>
  );
}

/** The model saved for one provider: its own key, else the single api_model. */
function providerModel(settings, provider) {
  return (LINKED.includes(provider) ? settings[`${provider}_model`] : settings.api_model) || "";
}

/** Whether a key is already stored for this provider (GET /api/settings/ sends only booleans). */
function isLinked(settings, provider) {
  return !!(LINKED.includes(provider) ? settings[`${provider}_api_key_set`] : settings.api_key_set);
}

const DAY = 86400000;

/** A key's expiry as {tone, text, title}, or null when nothing reported one. */
function expiryInfo(iso) {
  const at = iso ? new Date(iso) : null;
  if (!at || Number.isNaN(at.getTime())) return null;
  const date = at.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const days = Math.ceil((at.getTime() - Date.now()) / DAY);
  const title = `Key expiry reported by the provider: ${at.toLocaleString()}`;
  if (days < 0) return { tone: "red", text: `Key expired ${date}`, title, days };
  if (days === 0) return { tone: "red", text: `Key expires today, ${date}`, title, days };
  if (days <= 7) return { tone: "red", text: `Key expires in ${days} day${days === 1 ? "" : "s"} · ${date}`, title, days };
  if (days <= 30) return { tone: "amber", text: `Key expires in ${days} days · ${date}`, title, days };
  return { tone: "green", text: `Key valid until ${date}`, title, days };
}

/** The expiry pill. Nothing is drawn when the provider reports no expiry, which is the
 *  normal case: only OpenRouter has a key endpoint, and plain keys never expire. */
function KeyExpiry({ expiresAt, className }) {
  const info = expiryInfo(expiresAt);
  if (!info) return null;
  return (
    <span className={className} title={info.title}>
      <Badge tone={info.tone} dot>
        {info.text}
      </Badge>
    </span>
  );
}

function Connection({ result }) {
  if (!result) return null;
  return result.connected ? (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
        <StatusDot tone="green" label="Connected" /> Connected
        {result.models.length ? ` · ${result.models.length} model${result.models.length === 1 ? "" : "s"}` : ""}
      </p>
      <KeyExpiry expiresAt={result.expires_at} />
    </div>
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
    api_model: providerModel(settings, settings.llm_provider || "ollama"),
    cloud_transcribe: settings.cloud_transcribe ?? false,
    cloud_transcribe_model: settings.cloud_transcribe_model || "",
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
      const linked = LINKED.includes(form.llm_provider);
      // A linked provider stores its own key and model, so switching provider keeps both.
      const keyField = linked ? `${form.llm_provider}_api_key` : "api_key";
      const modelField = linked ? `${form.llm_provider}_model` : "api_model";
      body[modelField] = blank(form.api_model.trim());
      body.cloud_transcribe = canCloudAsr ? form.cloud_transcribe : false;
      body.cloud_transcribe_model = canCloudAsr ? blank(form.cloud_transcribe_model.trim()) : null;
      body.api_base_url = form.llm_provider === "custom" ? blank(form.api_base_url.trim()) : null;
      if (form.api_key.trim()) body[keyField] = form.api_key.trim(); // empty keeps the saved key
    }
    return body;
  };

  async function runTest() {
    setTesting(true);
    try {
      const body = payload();
      const result = await api("/api/settings/test", { method: "POST", body: { ...body, llm_provider: form.llm_provider } });
      setTest(result);
      // Most people do not know provider model ids, so choose one from what this account
      // offers. Only when they have not picked one themselves.
      if (result.connected && !form.api_model.trim()) {
        const choice = pickModel(result.models, form.llm_provider);
        if (choice) set({ api_model: choice });
      }
    } catch (e) {
      setTest({ connected: false, models: [], error: e.message });
    } finally {
      setTesting(false);
    }
  }

  // Ask Ollama for its models once, so the model list is there without a click.
  useEffect(() => {
    // Ollama needs no key; a cloud provider is asked only when its account is already linked,
    // so the model list is there without anyone pressing a button.
    if (!cloud || isLinked(settings, form.llm_provider)) runTest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.llm_provider]);

  const ollamaModels = !cloud && test?.connected ? test.models : [];
  const tierDefault = system?.llm_provider === "ollama" || !system ? system?.llm_model : "";
  const linkedNow = isLinked(settings, form.llm_provider);
  const keyPage = KEY_PAGE[form.llm_provider];
  const canCloudAsr = AUDIO_PROVIDERS.includes(form.llm_provider);
  const asrOffered = (test?.models || []).filter((m) => IS_ASR.test(m));
  const offered = (test?.models || []).filter((m) => !NOT_CHAT.test(m));
  const recommended = pickModel(test?.models, form.llm_provider);
  const modelOptions = offered.length
    ? [
        ...offered.map((m) => ({ value: m, label: m === recommended ? `${m} (recommended)` : m })),
        // A model saved earlier, or typed by hand, stays selectable even if it is not listed.
        ...(form.api_model && !offered.includes(form.api_model)
          ? [{ value: form.api_model, label: `${form.api_model} (not in this account's list)` }]
          : []),
      ]
    : [];

  return (
    <Card>
      <CardHeader title="AI Model" icon={Cpu} />
      <div className="flex flex-col gap-5 px-5 pt-3 pb-5">
        {system?.cuda_error && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              <strong className="font-semibold">Transcribing on the CPU.</strong> A GPU is present but
              could not be used: {system.cuda_error}. Runs fall back to the CPU, which is far slower, and
              the hardware tier has dropped with it. Install the CUDA 12 cuBLAS and cuDNN 9 libraries,
              then delete <code>data/cuda_broken.json</code> to try the GPU again.
            </span>
          </div>
        )}
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
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-zinc-800 dark:text-zinc-100">Account</span>
                {linkedNow ? <Badge tone="green" dot>Linked</Badge> : <Badge tone="gray">Not linked</Badge>}
                <KeyExpiry expiresAt={test?.expires_at} />
                {linkedNow && (
                  <Button
                    variant="ghost"
                    className="ml-auto"
                    onClick={() =>
                      save(async () => {
                        const field = LINKED.includes(form.llm_provider)
                          ? `${form.llm_provider}_api_key`
                          : "api_key";
                        await api("/api/settings/", { method: "PATCH", body: { [field]: null } });
                        set({ api_key: "" });
                        setTest(null);
                        onSaved(await api("/api/settings/"));
                      })
                    }
                  >
                    Unlink
                  </Button>
                )}
              </div>
              <Input
                label="API key"
                type="password"
                autoComplete="off"
                value={form.api_key}
                placeholder={linkedNow ? "Saved. Type a new key to replace it." : "Paste your API key"}
                hint={
                  keyPage ? (
                    <>
                      Create one at{" "}
                      <a
                        href={keyPage[1]}
                        target="_blank"
                        rel="noreferrer"
                        className={cx("text-primary-600 underline dark:text-primary-400", focusRing)}
                      >
                        {keyPage[0]}
                      </a>
                      . Kept in this server&apos;s settings file only, and never shown again.
                    </>
                  ) : (
                    "Stored only in this PrivMeet server's settings file; never shown again."
                  )
                }
                onChange={(e) => set({ api_key: e.target.value })}
              />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-64 flex-1">
                {modelOptions.length ? (
                  <Select
                    label="Model"
                    value={form.api_model}
                    onChange={(e) => set({ api_model: e.target.value })}
                    options={modelOptions}
                    hint={
                      form.api_model === recommended
                        ? "Chosen for you from this account. Change it if you prefer another."
                        : "The model that writes summaries and answers questions."
                    }
                  />
                ) : (
                  <Input
                    label="Model"
                    value={form.api_model}
                    list={listId}
                    placeholder="The model id from your provider"
                    hint="Paste your key and press Test Connection: the models of your account are then listed here."
                    onChange={(e) => set({ api_model: e.target.value })}
                  />
                )}
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

            {canCloudAsr && (
              <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                <Toggle
                  checked={form.cloud_transcribe}
                  onChange={(on) =>
                    set({
                      cloud_transcribe: on,
                      cloud_transcribe_model:
                        form.cloud_transcribe_model ||
                        (on ? asrOffered[0] || ASR_DEFAULT[form.llm_provider] || "" : ""),
                    })
                  }
                  label="Transcribe with this provider instead of on this machine"
                />
                <p className="pl-12 text-xs text-zinc-500 dark:text-zinc-400">
                  Minutes of waiting become seconds, and a slow machine or one without a GPU can
                  keep up. {CLOUD_NAME[form.llm_provider]} charges for it.
                </p>
                {form.cloud_transcribe && (
                  <>
                    <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      <span>
                        <strong className="font-semibold">The recording itself is uploaded.</strong> With
                        this off, audio never leaves this machine. With it on, every meeting&apos;s audio
                        is sent to {CLOUD_NAME[form.llm_provider]}. Speaker detection still runs here.
                      </span>
                    </div>
                    {asrOffered.length ? (
                      <Select
                        label="Transcription model"
                        value={form.cloud_transcribe_model}
                        onChange={(e) => set({ cloud_transcribe_model: e.target.value })}
                        options={asrOffered.map((m) => ({ value: m, label: m }))}
                        hint="A speech model from this account."
                      />
                    ) : (
                      <Input
                        label="Transcription model"
                        value={form.cloud_transcribe_model}
                        placeholder={ASR_DEFAULT[form.llm_provider] || "the provider's speech model"}
                        hint="Test Connection to list this account's speech models."
                        onChange={(e) => set({ cloud_transcribe_model: e.target.value })}
                      />
                    )}
                  </>
                )}
              </div>
            )}
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

        <PrivacyDialog
          provider={pending}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            set({ llm_provider: pending, api_key: "", api_model: providerModel(settings, pending) });
            setTest(null);
            setPending(null);
          }}
        />

        <SaveRow
          state={state}
          disabled={cloud && !form.api_model.trim()}
          why={`Choose a model first${test?.models?.length ? ` — ${test.models.length} offered by this account` : ""}.`}
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

/** The custom theme's swatches come from its own generated scales. */
function customPreview(cfg) {
  const { primary, zinc, mode } = customScales(cfg);
  return mode === "dark" ? [zinc[950], zinc[900], zinc[800], primary[500]] : [zinc[50], zinc[100], "#ffffff", primary[500]];
}

function ThemeCard({ theme, selected, onPick, preview }) {
  const [page, side, card, accent] = preview || PREVIEW[theme.id];
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
  const [custom] = useCustomTheme();
  const [editing, setEditing] = useState(false);
  return (
    <Card>
      <CardHeader title="Appearance" icon={Palette} />
      <div className="px-5 pt-3 pb-5">
        <div role="radiogroup" aria-label="Theme" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {THEMES.map((t) => (
            t.id === "custom" ? (
              // The pencil is a sibling laid over the card, not inside it: the card is itself a
              // button, and a button inside a button is invalid and breaks keyboard focus.
              <div key={t.id} className="relative">
                <ThemeCard
                  theme={{ ...t, name: shown(custom.name, "Custom") }}
                  preview={customPreview(custom)}
                  selected={t.id === theme}
                  onPick={() => setTheme(t.id)}
                />
                <IconButton
                  icon={editing ? X : Pencil}
                  label={editing ? "Close the theme editor" : "Edit your theme"}
                  variant="secondary"
                  size="sm"
                  aria-expanded={editing}
                  aria-controls="custom-theme-editor"
                  onClick={() => {
                    setTheme("custom");
                    setEditing((e) => !e);
                  }}
                  className="absolute top-5 right-5 shadow-md"
                />
              </div>
            ) : (
              <ThemeCard key={t.id} theme={t} selected={t.id === theme} onPick={() => setTheme(t.id)} />
            )
          ))}
        </div>
        {theme === "custom" && editing && <CustomTheme onClose={() => setEditing(false)} />}
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
