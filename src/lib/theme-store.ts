/**
 * Live theme store. Backed by /api/settings/theme. No browser storage.
 */
import { api } from "./api-client";

const EVT = "hdpornforyou:theme-changed";
export const THEME_EVENT = EVT;

export interface ThemeConfig {
  primary: string;
  accent: string;
}

export const THEME_PRESETS: { name: string; primary: string; accent: string }[] = [
  { name: "Cinematic Red", primary: "#ef2b3a", accent: "#ff6a3d" },
  { name: "Royal Purple", primary: "#8b5cf6", accent: "#ec4899" },
  { name: "Electric Blue", primary: "#3b82f6", accent: "#06b6d4" },
  { name: "Neon Green", primary: "#22c55e", accent: "#84cc16" },
  { name: "Sunset Orange", primary: "#f97316", accent: "#facc15" },
  { name: "Hot Pink", primary: "#ec4899", accent: "#f43f5e" },
];

const DEFAULT: ThemeConfig = THEME_PRESETS[0];

let cache: ThemeConfig = { ...DEFAULT };
let hydrated = false;

function emit() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
}

export function applyTheme(t: ThemeConfig = cache) {
  if (typeof document === "undefined") return;
  const r = document.documentElement.style;
  r.setProperty("--primary", t.primary);
  r.setProperty("--ring", t.primary);
  r.setProperty("--destructive", t.primary);
  r.setProperty("--accent", t.accent);
  r.setProperty("--glow", `${t.primary}59`);
  r.setProperty("--gradient-primary", `linear-gradient(135deg, ${t.primary}, ${t.accent})`);
  r.setProperty("--shadow-glow", `0 10px 40px -10px ${t.primary}80`);
}

export async function hydrateTheme() {
  const { value } = await api
    .get<{ value: ThemeConfig | null }>("/api/settings/theme")
    .catch(() => ({ value: null }));
  cache = { ...DEFAULT, ...(value ?? {}) };
  hydrated = true;
  applyTheme(cache);
  emit();
}

export function getTheme(): ThemeConfig {
  if (!hydrated && typeof window !== "undefined") hydrateTheme().catch(() => {});
  return cache;
}

export async function setTheme(t: ThemeConfig) {
  await api.put("/api/settings/theme", { value: t });
  cache = t;
  applyTheme(t);
  emit();
}
