import { useEffect, useState, useRef, useCallback } from "react";
import {
  Play,
  Square,
  RefreshCw,
  Clock,
  Sliders,
  Tag,
  List,
  Trash2,
  Plus,
  AlertTriangle,
  CheckCircle,
  XCircle,
  SkipForward,
  Info,
  Zap,
  Hash,
  Settings2,
  Brain,
  KeyRound,
} from "lucide-react";
import {
  getSettings,
  saveSettings,
  getKeywords,
  addKeyword,
  deleteKeyword,
  updateKeyword,
  getLogs,
  clearLogs,
  getStatus,
  startImport,
  stopImport,
  getAdminStats,
  fetchModels,
  getApiKeys,
  addApiKey,
  deleteApiKey,
  updateApiKey,
  type AutomationSettings,
  type ImportKeyword,
  type ImportLog,
  type AutomationStatus,
  type AdminStats,
  type OpenRouterKey,
} from "@/lib/auto-import-store";
import { useCategories } from "@/hooks/use-categories";
import { hydrateVideos } from "@/lib/video-store";

const STATUS_COLORS: Record<string, string> = {
  RUNNING: "text-green-400",
  WAITING: "text-yellow-400",
  PAUSED: "text-red-400",
  STOPPED: "text-muted-foreground",
};

const LOG_ICONS: Record<string, React.ReactNode> = {
  success: <CheckCircle className="h-3.5 w-3.5 text-green-400" />,
  failure: <XCircle className="h-3.5 w-3.5 text-red-400" />,
  skipped: <SkipForward className="h-3.5 w-3.5 text-yellow-400" />,
  stopped: <AlertTriangle className="h-3.5 w-3.5 text-orange-400" />,
  info: <Info className="h-3.5 w-3.5 text-blue-400" />,
};

export function AutoImporter() {
  const [settings, setSettings] = useState<AutomationSettings | null>(null);
  const [keywords, setKeywords] = useState<ImportKeyword[]>([]);
  const [logs, setLogs] = useState<ImportLog[]>([]);
  const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [newKeyword, setNewKeyword] = useState("");
  const [newPriority, setNewPriority] = useState<"high" | "medium" | "low">("medium");
  const [logType, setLogType] = useState<string>("");
  const [editingSettings, setEditingSettings] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<string>("");

  // Model + API key state
  const [models, setModels] = useState<string[]>([]);
  const [apiKeys, setApiKeys] = useState<OpenRouterKey[]>([]);
  const [hasEnvKey, setHasEnvKey] = useState(false);
  const [newApiKey, setNewApiKey] = useState("");
  const [newApiLabel, setNewApiLabel] = useState("");
  const [newApiPriority, setNewApiPriority] = useState(50);
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const editingRef = useRef(false); // true while user is actively editing settings
  const lastImportAtRef = useRef<string | null>(null); // last seen completed import timestamp
  const categories = useCategories();

  const load = useCallback(async () => {
    try {
      const [s, k, l, st, st2] = await Promise.all([
        getSettings().catch(() => null),
        getKeywords().catch(() => []),
        getLogs(50, 0, logType || undefined).catch(() => []),
        getStatus().catch(() => null),
        getAdminStats().catch(() => null),
      ]);
      // Never overwrite local settings state while the user is editing —
      // that's what caused unsaved changes to be reverted every 5 seconds.
      if (s && !editingRef.current) setSettings(s);
      if (k) setKeywords(k);
      if (l) setLogs(l);
      if (st) setStatus(st);
      if (st2) setStats(st2);
      // Same behavior as the manual VideoImporter: the moment a cycle
      // completes, refresh the video store so the catalog shows the new
      // videos immediately (VIDEOS_EVENT updates every open catalog view).
      if (st?.lastImport?.at && st.lastImport.at !== lastImportAtRef.current) {
        lastImportAtRef.current = st.lastImport.at;
        if ((st.lastImport.imported ?? 0) > 0) hydrateVideos().catch(() => {});
      }
    } catch {
      /* ignore */
    }
  }, [logType]);

  const loadModelsAndKeys = useCallback(async () => {
    try {
      const k = await getApiKeys().catch(() => ({ keys: [], hasEnvKey: false }));
      setApiKeys(k.keys);
      setHasEnvKey(k.hasEnvKey);
      fetchModels()
        .then(setModels)
        .catch(() => setModels([]));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    loadModelsAndKeys();
  }, [loadModelsAndKeys]);

  useEffect(() => {
    pollRef.current = setInterval(load, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  useEffect(() => {
    if (status?.status === "WAITING" && status.nextCycleAt) {
      const update = () => {
        const diff = new Date(status.nextCycleAt!).getTime() - Date.now();
        if (diff <= 0) {
          setCountdown("now");
          return;
        }
        const m = Math.floor(diff / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        setCountdown(`${m}m ${s}s`);
      };
      update();
      const int = setInterval(update, 1000);
      return () => clearInterval(int);
    }
    setCountdown("");
  }, [status?.nextCycleAt, status?.status]);

  const handleSaveSettings = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await saveSettings(settings);
      editingRef.current = false;
      setMsg("Settings saved");
      window.dispatchEvent(new Event("admin-prefix-changed"));
      setTimeout(() => setMsg(null), 2000);
    } catch {
      setMsg("Failed to save");
    }
    setSaving(false);
    setEditingSettings(false);
  };

  // Mark editing whenever the user changes any setting field so the poll
  // doesn't overwrite their unsaved changes.
  const patchSettings = (patch: Partial<typeof settings>) => {
    editingRef.current = true;
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const handleStart = async () => {
    // Optimistically flip the System Status card to RUNNING with no
    // countdown the instant the admin clicks Start — the server sets
    // isRunning=true synchronously inside runCycle(), but the /start
    // round-trip + 5s status poll would otherwise leave the card showing
    // WAITING with a stale countdown for a moment. nextCycleAt is only
    // set after the first cycle actually completes, per workflow.
    setStatus((prev) =>
      prev
        ? { ...prev, status: "RUNNING", isRunning: true, isPaused: false, nextCycleAt: null }
        : prev,
    );
    setCountdown("");
    try {
      const nextStatus = await startImport();
      // Only apply a RUNNING response. A stale WAITING/PAUSED reply (returned
      // if the engine was already enabled when Start was clicked, or the wait
      // window elapsed) would flash an old "Next cycle" countdown while the
      // fresh cycle is importing — the 5s poll corrects to the real state.
      if (nextStatus && nextStatus.status === "RUNNING") setStatus(nextStatus);
      setMsg("Automation started");
      load();
    } catch {
      setMsg("Failed to start");
    }
  };

  const handleStop = async () => {
    // Optimistically clear the System Status card AND the countdown the
    // instant Stop is pressed, so the waiting POST round-trip never leaves a
    // stale "Next cycle" timer visible.
    setStatus((prev) =>
      prev
        ? { ...prev, status: "STOPPED", isRunning: false, isPaused: false, nextCycleAt: null }
        : prev,
    );
    setCountdown("");
    try {
      const nextStatus = await stopImport();
      if (nextStatus) setStatus(nextStatus);
      setMsg("Automation stopped");
      load();
    } catch {
      setMsg("Failed to stop");
    }
  };

  const handleAddKeyword = async () => {
    const kw = newKeyword.trim().toLowerCase();
    if (!kw) return;
    try {
      await addKeyword(kw, newPriority);
      setNewKeyword("");
      setMsg(`Keyword "${kw}" added`);
      load();
    } catch (e: unknown) {
      setMsg((e as Error).message || "Failed to add keyword");
    }
  };

  const handleDeleteKeyword = async (id: number) => {
    try {
      await deleteKeyword(id);
      load();
    } catch {
      setMsg("Failed to delete");
    }
  };

  const handleClearLogs = async () => {
    if (!confirm("Clear all import logs?")) return;
    try {
      await clearLogs();
      load();
    } catch {
      setMsg("Failed to clear logs");
    }
  };

  const handleKeywordPriority = async (id: number, priority: "high" | "medium" | "low") => {
    try {
      await updateKeyword(id, { priority });
      load();
    } catch {
      /* ignore */
    }
  };

  const refreshModels = async () => {
    setLoadingModels(true);
    try {
      const m = await fetchModels();
      setModels(m);
      setMsg(`Loaded ${m.length} models`);
      setTimeout(() => setMsg(null), 2000);
    } catch {
      setMsg("Failed to load models");
    }
    setLoadingModels(false);
  };

  const handleAddApiKey = async () => {
    if (!newApiKey.startsWith("sk-or-")) {
      setMsg("Invalid OpenRouter key format");
      return;
    }
    const key = newApiKey.trim();
    const label = newApiLabel || "Unnamed";
    const priority = newApiPriority;
    try {
      const id = await addApiKey(key, label, priority);
      setNewApiKey("");
      setNewApiLabel("");
      setShowApiKeyInput(false);
      setApiKeys((prev) => [...prev, { id, label, priority, partial: `${key.slice(0, 12)}...` }]);
      setMsg("API key added");
      loadModelsAndKeys();
      setTimeout(() => setMsg(null), 2000);
    } catch (e) {
      setMsg((e as Error).message || "Failed to add key");
    }
  };

  const handleDeleteApiKey = async (id: string) => {
    try {
      await deleteApiKey(id);
      loadModelsAndKeys();
    } catch {
      setMsg("Failed to delete key");
    }
  };

  if (!settings) {
    return (
      <div className="rounded-2xl gradient-card p-6 shadow-card">
        <p className="text-muted-foreground">Loading automation settings...</p>
      </div>
    );
  }

  const s = status;
  const statusIcon =
    s?.status === "RUNNING" ? (
      <Zap className="h-5 w-5 text-green-400" />
    ) : s?.status === "PAUSED" ? (
      <AlertTriangle className="h-5 w-5 text-red-400" />
    ) : s?.status === "WAITING" ? (
      <Clock className="h-5 w-5 text-yellow-400" />
    ) : (
      <Square className="h-5 w-5 text-muted-foreground" />
    );

  const catNames = categories?.map((c: { slug: string; name: string }) => c.name).join(", ") || "";

  return (
    <div className="space-y-6">
      <div className="rounded-2xl gradient-card p-6 shadow-card">
        <h3 className="font-display text-xl font-bold flex items-center gap-2">
          <Zap className="h-5 w-5 text-primary" /> Automation Engine
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Fixed-interval video ingestion from Eporner with OpenRouter AI SEO generation.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl gradient-card p-5 shadow-card">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">System Status</p>
          <div className="mt-2 flex items-center gap-2">
            {statusIcon}
            <span
              className={`font-display text-2xl font-bold ${STATUS_COLORS[s?.status || "STOPPED"]}`}
            >
              {s?.status || "STOPPED"}
            </span>
          </div>
          {s?.status === "WAITING" && countdown && (
            <p className="text-xs text-muted-foreground mt-1">Next cycle: {countdown}</p>
          )}
        </div>
        <div className="rounded-2xl gradient-card p-5 shadow-card">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            AI Requests Today
          </p>
          <p
            className={`mt-2 font-display text-2xl font-bold ${(s?.aiRequestsUsed || 0) >= (s?.aiRequestsLimit || 50) ? "text-red-400" : "text-primary"}`}
          >
            {s?.aiRequestsUsed || 0} / {s?.aiRequestsLimit || 50}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {(s?.aiRequestsLimit || 50) - (s?.aiRequestsUsed || 0)} remaining
          </p>
        </div>
        <div className="rounded-2xl gradient-card p-5 shadow-card">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Videos Today</p>
          <p className="mt-2 font-display text-2xl font-bold text-gradient">
            {s?.videosImportedToday || 0}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Limit: {s?.dailyImportLimit || 50000} | Remaining: {s?.remainingImports || 0}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="rounded-2xl gradient-card p-6 shadow-card space-y-4">
          <h4 className="font-display text-lg font-bold flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-primary" /> Controls
          </h4>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleStart}
              disabled={s?.status === "RUNNING" || s?.status === "PAUSED"}
              className="inline-flex items-center gap-2 rounded-full gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow hover:scale-105 transition-transform disabled:opacity-40"
            >
              <Play className="h-4 w-4" /> Start
            </button>
            <button
              onClick={handleStop}
              disabled={s?.status === "STOPPED"}
              className="inline-flex items-center gap-2 rounded-full bg-destructive/20 text-destructive px-4 py-2 text-sm font-semibold hover:bg-destructive/30 disabled:opacity-40"
            >
              <Square className="h-4 w-4" /> Stop
            </button>
            <button
              onClick={load}
              className="inline-flex items-center gap-2 rounded-full glass px-4 py-2 text-sm hover:bg-secondary"
            >
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
          </div>

          <div className="space-y-3 pt-2">
            <h5 className="text-sm font-semibold flex items-center gap-2">
              <Sliders className="h-3.5 w-3.5 text-muted-foreground" /> Cycle Settings
            </h5>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs uppercase tracking-widest text-muted-foreground">
                  Interval (minutes)
                </span>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={settings.intervalMinutes}
                  onChange={(e) =>
                    patchSettings({ intervalMinutes: Math.max(1, Number(e.target.value)) })
                  }
                  className="mt-1 w-full rounded-lg bg-background border border-border px-3 py-2 text-sm outline-none focus:border-primary/60"
                />
              </label>
              <label className="block">
                <span className="text-xs uppercase tracking-widest text-muted-foreground">
                  Daily import limit
                </span>
                <input
                  type="number"
                  min={10000}
                  max={100000}
                  step={10000}
                  value={settings.dailyImportLimit}
                  onChange={(e) => patchSettings({ dailyImportLimit: Number(e.target.value) })}
                  className="mt-1 w-full rounded-lg bg-background border border-border px-3 py-2 text-sm outline-none focus:border-primary/60"
                />
              </label>
              <label className="block">
                <span className="text-xs uppercase tracking-widest text-muted-foreground">
                  AI requests / day limit
                </span>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={settings.aiDailyLimit ?? 50}
                  onChange={(e) =>
                    patchSettings({ aiDailyLimit: Math.max(1, Number(e.target.value)) })
                  }
                  className="mt-1 w-full rounded-lg bg-background border border-border px-3 py-2 text-sm outline-none focus:border-primary/60"
                />
              </label>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <h5 className="text-sm font-semibold flex items-center gap-2">
              <Brain className="h-3.5 w-3.5 text-muted-foreground" /> AI Settings
            </h5>
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={settings.aiEnabled}
                  onChange={(e) => patchSettings({ aiEnabled: e.target.checked })}
                  className="sr-only peer"
                />
                <span className="h-5 w-9 rounded-full bg-secondary relative transition-all after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-foreground after:transition-all peer-checked:gradient-primary peer-checked:after:translate-x-4" />
                <span className="text-sm">AI SEO {settings.aiEnabled ? "ON" : "OFF"}</span>
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block min-w-0">
                <span className="text-xs uppercase tracking-widest text-muted-foreground">
                  Model
                </span>
                <div className="flex gap-1">
                  <select
                    value={settings.aiModel}
                    onChange={(e) => patchSettings({ aiModel: e.target.value })}
                    className="mt-1 min-w-0 flex-1 rounded-lg bg-background border border-border px-3 py-2 text-sm outline-none focus:border-primary/60 truncate"
                  >
                    {models.length === 0 && (
                      <option value={settings.aiModel}>{settings.aiModel}</option>
                    )}
                    {models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={refreshModels}
                    disabled={loadingModels}
                    className="mt-1 shrink-0 inline-flex items-center rounded-lg glass px-2 py-2 text-xs hover:bg-secondary"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${loadingModels ? "animate-spin" : ""}`} />
                  </button>
                </div>
              </label>
              <label className="block">
                <span className="text-xs uppercase tracking-widest text-muted-foreground">
                  Batch size
                </span>
                <input
                  type="number"
                  min={10}
                  max={50}
                  step={5}
                  value={settings.aiBatchSize}
                  onChange={(e) => patchSettings({ aiBatchSize: Number(e.target.value) })}
                  className="mt-1 w-full rounded-lg bg-background border border-border px-3 py-2 text-sm outline-none focus:border-primary/60"
                />
              </label>
            </div>

            {editingSettings ? (
              <div className="space-y-3">
                <label className="block">
                  <span className="text-xs uppercase tracking-widest text-muted-foreground">
                    AI Prompt
                  </span>
                  <textarea
                    value={settings.aiPrompt}
                    onChange={(e) => patchSettings({ aiPrompt: e.target.value })}
                    rows={6}
                    className="mt-1 w-full rounded-lg bg-background border border-border px-3 py-2 text-xs font-mono outline-none focus:border-primary/60"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleSaveSettings}
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-full gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow hover:scale-105 transition-transform disabled:opacity-40"
                  >
                    <CheckCircle className="h-4 w-4" /> {saving ? "Saving..." : "Save Changes"}
                  </button>
                  <button
                    onClick={() => {
                      editingRef.current = false;
                      setEditingSettings(false);
                      load();
                    }}
                    className="rounded-full glass px-4 py-2 text-sm hover:bg-secondary"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setEditingSettings(true)}
                className="inline-flex items-center gap-2 rounded-full glass px-4 py-2 text-sm hover:bg-secondary"
              >
                Edit AI Prompt & Settings
              </button>
            )}
          </div>

          <div className="space-y-3 pt-2">
            <h5 className="text-sm font-semibold flex items-center gap-2">
              <Hash className="h-3.5 w-3.5 text-muted-foreground" /> Admin Prefix
            </h5>
            <label className="block">
              <span className="text-xs uppercase tracking-widest text-muted-foreground">
                Admin URL path
              </span>
              <input
                type="text"
                value={settings.adminPrefix}
                onChange={(e) =>
                  patchSettings({ adminPrefix: e.target.value.replace(/[^a-z0-9-]/g, "") })
                }
                className="mt-1 w-full rounded-lg bg-background border border-border px-3 py-2 text-sm font-mono outline-none focus:border-primary/60"
              />
            </label>
            {!editingSettings && (
              <button
                onClick={handleSaveSettings}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-full gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow hover:scale-105 transition-transform disabled:opacity-40"
              >
                <CheckCircle className="h-4 w-4" /> {saving ? "Saving..." : "Save All Settings"}
              </button>
            )}
          </div>

          {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
        </section>

        <section className="rounded-2xl gradient-card p-6 shadow-card space-y-4">
          <h4 className="font-display text-lg font-bold flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" /> OpenRouter API Keys
          </h4>

          <div className="space-y-2">
            {hasEnvKey && (
              <div className="rounded-lg bg-background/40 px-3 py-2 text-xs flex items-center gap-2">
                <CheckCircle className="h-3 w-3 text-green-400" />
                <span>OPENROUTER_API_KEY env var (priority 0)</span>
              </div>
            )}
            {apiKeys.map((k) => (
              <div
                key={k.id}
                className="flex items-center gap-2 rounded-lg bg-background/40 px-3 py-2 text-xs"
              >
                <span className="font-mono flex-1 truncate">
                  {k.partial || k.label || "Unnamed"}
                </span>
                <span className="text-muted-foreground">P{k.priority}</span>
                <button
                  onClick={() => handleDeleteApiKey(k.id)}
                  className="text-muted-foreground hover:text-destructive p-0.5"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
            {!hasEnvKey && apiKeys.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No API keys configured. Add at least one key or set OPENROUTER_API_KEY env var.
              </p>
            )}
          </div>

          {showApiKeyInput ? (
            <div className="space-y-2">
              <input
                value={newApiKey}
                onChange={(e) => setNewApiKey(e.target.value)}
                placeholder="sk-or-..."
                className="w-full rounded-lg bg-background border border-border px-3 py-2 text-xs font-mono outline-none focus:border-primary/60"
              />
              <div className="flex flex-wrap gap-2">
                <input
                  value={newApiLabel}
                  onChange={(e) => setNewApiLabel(e.target.value)}
                  placeholder="Label"
                  className="flex-1 rounded-lg bg-background border border-border px-3 py-1.5 text-xs outline-none focus:border-primary/60"
                />
                <input
                  type="number"
                  value={newApiPriority}
                  onChange={(e) => setNewApiPriority(Number(e.target.value))}
                  min={1}
                  max={999}
                  className="w-16 rounded-lg bg-background border border-border px-2 py-1.5 text-xs outline-none focus:border-primary/60"
                  placeholder="P"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleAddApiKey}
                  disabled={!newApiKey.startsWith("sk-or-")}
                  className="inline-flex items-center gap-1 rounded-full gradient-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-glow hover:scale-105 transition-transform disabled:opacity-40"
                >
                  <Plus className="h-3 w-3" /> Add
                </button>
                <button
                  onClick={() => setShowApiKeyInput(false)}
                  className="rounded-full glass px-3 py-1.5 text-xs hover:bg-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowApiKeyInput(true)}
              className="inline-flex items-center gap-1 rounded-full glass px-3 py-1.5 text-xs hover:bg-secondary"
            >
              <Plus className="h-3 w-3" /> Add API Key
            </button>
          )}

          <div className="text-xs text-muted-foreground space-y-1">
            <p>Lower priority number = higher priority. Falls back to next key on failure.</p>
          </div>
        </section>
      </div>

      <section className="rounded-2xl gradient-card p-6 shadow-card space-y-4">
        <h4 className="font-display text-lg font-bold flex items-center gap-2">
          <Tag className="h-4 w-4 text-primary" /> Import Keywords
        </h4>
        <div className="flex flex-wrap gap-2">
          <input
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            placeholder="Add keyword..."
            onKeyDown={(e) => e.key === "Enter" && handleAddKeyword()}
            className="flex-1 rounded-xl bg-background border border-border focus:border-primary/60 px-4 py-2 text-sm outline-none focus:shadow-glow"
          />
          <select
            value={newPriority}
            onChange={(e) => setNewPriority(e.target.value as "high" | "medium" | "low")}
            className="rounded-lg bg-background border border-border px-3 py-2 text-sm outline-none"
          >
            <option value="high">High</option>
            <option value="medium">Med</option>
            <option value="low">Low</option>
          </select>
          <button
            onClick={handleAddKeyword}
            disabled={!newKeyword.trim()}
            className="inline-flex items-center gap-1 rounded-full gradient-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-glow hover:scale-105 transition-transform disabled:opacity-40"
          >
            <Plus className="h-4 w-4" /> Add
          </button>
        </div>
        {keywords.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No keywords configured. Add keywords to start auto-import.
          </p>
        ) : (
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {keywords.map((kw) => (
              <div
                key={kw.id}
                className="flex items-center gap-2 rounded-lg bg-background/40 px-3 py-2 text-sm"
              >
                <span className="flex-1">{kw.keyword}</span>
                <select
                  value={kw.priority}
                  onChange={(e) =>
                    handleKeywordPriority(kw.id, e.target.value as "high" | "medium" | "low")
                  }
                  className={`rounded-md px-2 py-0.5 text-[10px] font-semibold border outline-none ${
                    kw.priority === "high"
                      ? "border-green-500/40 text-green-400 bg-green-500/10"
                      : kw.priority === "medium"
                        ? "border-yellow-500/40 text-yellow-400 bg-yellow-500/10"
                        : "border-gray-500/40 text-gray-400 bg-gray-500/10"
                  }`}
                >
                  <option value="high">High</option>
                  <option value="medium">Med</option>
                  <option value="low">Low</option>
                </select>
                <button
                  onClick={() => handleDeleteKeyword(kw.id)}
                  className="text-muted-foreground hover:text-destructive p-1"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t border-border">
          <p>
            <span className="font-semibold">Queue:</span> {s?.queueSize || 0} pending thumbnail
            checks
          </p>
          {s?.currentBatch ? (
            <p>
              <span className="font-semibold">Current batch:</span> {s.currentBatch}
            </p>
          ) : null}
          <p>
            <span className="font-semibold">Categories:</span> {catNames || "Not configured"}
          </p>
          <p>
            <span className="font-semibold">Tags:</span> Click on tag in video descriptions to
            filter by tag
          </p>
        </div>
      </section>

      <section className="rounded-2xl gradient-card p-6 shadow-card space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="font-display text-lg font-bold flex items-center gap-2">
            <List className="h-4 w-4 text-primary" /> Import Logs (last 50)
          </h4>
          <div className="flex flex-wrap gap-2">
            <select
              value={logType}
              onChange={(e) => setLogType(e.target.value)}
              className="rounded-lg bg-background border border-border px-3 py-1.5 text-xs outline-none"
            >
              <option value="">All types</option>
              <option value="success">Success</option>
              <option value="failure">Failure</option>
              <option value="skipped">Skipped</option>
              <option value="stopped">Stopped</option>
              <option value="info">Info</option>
            </select>
            <button
              onClick={handleClearLogs}
              className="inline-flex items-center gap-1 rounded-full glass px-3 py-1.5 text-xs hover:bg-secondary"
            >
              <Trash2 className="h-3 w-3" /> Clear
            </button>
          </div>
        </div>
        {logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No logs yet.</p>
        ) : (
          <div className="max-h-80 overflow-y-auto space-y-1">
            {logs.map((log) => (
              <div
                key={log.id}
                className="flex items-start gap-2 rounded-lg bg-background/20 px-3 py-2 text-xs"
              >
                <span className="mt-0.5 shrink-0">
                  {LOG_ICONS[log.type] || <Info className="h-3.5 w-3.5" />}
                </span>
                <span className="flex-1">{log.message}</span>
                <span className="shrink-0 text-muted-foreground">
                  {new Date(log.created_at).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
        {logs.length >= 50 && <p className="text-xs text-muted-foreground">Showing last 50 logs</p>}
      </section>

      {stats && (
        <section className="rounded-2xl gradient-card p-6 shadow-card">
          <h4 className="font-display text-lg font-bold flex items-center gap-2 mb-4">
            <Info className="h-4 w-4 text-primary" /> System Stats
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-xl bg-background/40 p-3">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Total Videos
              </p>
              <p className="font-display text-lg font-bold">{stats.totalVideos.toLocaleString()}</p>
            </div>
            <div className="rounded-xl bg-background/40 p-3">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Comments
              </p>
              <p className="font-display text-lg font-bold">
                {stats.totalComments.toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl bg-background/40 p-3">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Users</p>
              <p className="font-display text-lg font-bold">{stats.totalUsers.toLocaleString()}</p>
            </div>
            <div className="rounded-xl bg-background/40 p-3">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Queue Size
              </p>
              <p className="font-display text-lg font-bold">{stats.queueSize}</p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
