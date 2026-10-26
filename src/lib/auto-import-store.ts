import { api } from "./api-client";

export interface AutomationSettings {
  enabled: boolean;
  intervalMinutes: number;
  dailyImportLimit: number;
  aiBatchSize: number;
  aiEnabled: boolean;
  aiModel: string;
  aiPrompt: string;
  adminPrefix: string;
  thumbnailAutoClean: boolean;
  aiDailyLimit: number;
}

export interface ImportKeyword {
  id: number;
  keyword: string;
  priority: "high" | "medium" | "low";
  created_at: string;
}

export interface ImportLog {
  id: number;
  type: string;
  message: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface AutomationStatus {
  status: "RUNNING" | "WAITING" | "PAUSED" | "STOPPED";
  aiRequestsUsed: number;
  aiRequestsLimit: number;
  nextCycleAt: string | null;
  currentBatch: number;
  lastImport?: {
    imported: number;
    skipped: number;
    failed: number;
    at: string;
    manual: boolean;
  } | null;
  isRunning: boolean;
  isPaused: boolean;
  videosImportedToday: number;
  dailyImportLimit: number;
  remainingImports: number;
  queueSize: number;
  intervalMinutes: number;
  aiEnabled: boolean;
  aiModel: string;
}

export interface AdminStats {
  totalVideos: number;
  totalComments: number;
  totalUsers: number;
  videosImportedToday: number;
  aiRequestsUsed: number;
  aiRequestsLimit: number;
  status: string;
  nextCycleAt: string | null;
  queueSize: number;
}

export interface OpenRouterKey {
  id: string;
  label: string;
  priority: number;
  partial: string;
}

const DEFAULTS: AutomationSettings = {
  enabled: false,
  intervalMinutes: 10,
  dailyImportLimit: 50000,
  aiBatchSize: 20,
  aiEnabled: true,
  aiModel: "openai/gpt-4o-mini",
  aiPrompt: `You are an expert SEO metadata generator for adult entertainment platforms. Analyze the provided video URL, metadata, or raw titles and generate:
- SEO title (90-120 chars, no hard cap)
- meta description (350-600 chars, no hard cap)
- exactly 7 tags, each ONE word with no spaces and the first letter of every word capitalized (e.g. MiaKhalifa, BigBooty)
- category from the provided list

Output STRICT JSON ONLY:
[
  {
    "video_id": "",
    "title": "",
    "description": "",
    "tags": ["", ""],
    "category": ""
  }
]

No extra text.`,
  adminPrefix: "admin",
  thumbnailAutoClean: false,
  aiDailyLimit: 50,
};

export async function getSettings(): Promise<AutomationSettings> {
  const s = await api.get<AutomationSettings>("/api/admin/settings");
  return { ...DEFAULTS, ...s };
}

export async function saveSettings(settings: Partial<AutomationSettings>): Promise<void> {
  await api.post("/api/admin/settings", settings);
}

export async function getKeywords(): Promise<ImportKeyword[]> {
  const res = await api.get<{ keywords: ImportKeyword[] }>("/api/admin/keywords");
  return res.keywords;
}

export async function addKeyword(keyword: string, priority = "medium"): Promise<ImportKeyword> {
  const res = await api.post<{ keyword: ImportKeyword }>("/api/admin/keywords", {
    keyword,
    priority,
  });
  return res.keyword;
}

export async function updateKeyword(
  id: number,
  fields: Partial<ImportKeyword>,
): Promise<ImportKeyword> {
  const res = await api.put<{ keyword: ImportKeyword }>(`/api/admin/keywords/${id}`, fields);
  return res.keyword;
}

export async function deleteKeyword(id: number): Promise<void> {
  await api.del(`/api/admin/keywords/${id}`);
}

export async function getLogs(limit = 100, offset = 0, type?: string): Promise<ImportLog[]> {
  let path = `/api/admin/logs?limit=${limit}&offset=${offset}`;
  if (type) path += `&type=${type}`;
  const res = await api.get<{ logs: ImportLog[] }>(path);
  return res.logs;
}

export async function clearLogs(): Promise<void> {
  await api.post("/api/admin/logs/clear");
}

export async function getStatus(): Promise<AutomationStatus> {
  return api.get<AutomationStatus>("/api/import/status");
}

export async function startImport(): Promise<AutomationStatus | null> {
  const res = await api.post<{ status?: AutomationStatus }>("/api/import/start");
  return res.status ?? null;
}

export async function stopImport(): Promise<AutomationStatus | null> {
  const res = await api.post<{ status?: AutomationStatus }>("/api/import/stop");
  return res.status ?? null;
}

export async function manualImport(): Promise<void> {
  await api.post("/api/import/manual");
}

export async function getAdminStats(): Promise<AdminStats> {
  return api.get<AdminStats>("/api/admin/stats");
}

export async function fetchModels(): Promise<string[]> {
  const res = await api.get<{ models: string[] }>("/api/admin/openrouter/models");
  return res.models;
}

export async function getApiKeys(): Promise<{ keys: OpenRouterKey[]; hasEnvKey: boolean }> {
  return api.get<{ keys: OpenRouterKey[]; hasEnvKey: boolean }>("/api/admin/openrouter/keys");
}

export async function addApiKey(key: string, label: string, priority: number): Promise<string> {
  const res = await api.post<{ ok: boolean; id: string }>("/api/admin/openrouter/keys", {
    key,
    label,
    priority,
  });
  return res.id;
}

export async function deleteApiKey(id: string): Promise<void> {
  await api.del(`/api/admin/openrouter/keys/${id}`);
}

export async function updateApiKey(
  id: string,
  fields: { priority?: number; label?: string },
): Promise<void> {
  await api.patch(`/api/admin/openrouter/keys/${id}`, fields);
}
