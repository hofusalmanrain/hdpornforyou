/**
 * Light/dark/system theme mode. Defaults to the user's device preference
 * (prefers-color-scheme). The resolved appearance is driven by the `light`
 * class on <html> — the app's default palette is dark, and `.light` in
 * styles.css overrides the semantic CSS variables.
 */

const KEY = "hdpornforyou:theme-mode";
const EVT = "hdpornforyou:theme-mode-changed";
export const THEME_MODE_EVENT = EVT;

export type ThemeMode = "system" | "light" | "dark";

const media = () => window.matchMedia("(prefers-color-scheme: light)");

export function systemPrefersLight(): boolean {
  return typeof window !== "undefined" && media().matches;
}

export function getThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {}
  return "system";
}

export function applyThemeMode(mode: ThemeMode = getThemeMode()) {
  if (typeof document === "undefined") return;
  const light = mode === "light" || (mode === "system" && systemPrefersLight());
  document.documentElement.classList.toggle("light", light);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", light ? "#f6f4ef" : "#0f0f0f");
}

export function initThemeMode() {
  applyThemeMode();
  media().addEventListener("change", () => {
    if (getThemeMode() === "system") {
      applyThemeMode("system");
      window.dispatchEvent(new Event(EVT));
    }
  });
}

export function setThemeMode(mode: ThemeMode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {}
  applyThemeMode(mode);
  window.dispatchEvent(new Event(EVT));
}