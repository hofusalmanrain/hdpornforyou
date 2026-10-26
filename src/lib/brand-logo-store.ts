/**
 * Brand logo store — backed by /api/brand-logo.
 * Mirrors the favicon pattern. When null, the navbar falls back to the
 * first letter of the brand name.
 *
 * The URL is pre-fetched by an inline script in index.html (before React
 * mounts) and stashed on window.__BRAND_LOGO_URL__ so the navbar shows
 * the logo on the very first paint — no flash of the letter badge.
 */
import { api } from "./api-client";

const EVT = "hdpornforyou:brand-logo-changed";
export const BRAND_LOGO_EVENT = EVT;

// Pick up the pre-fetched value from the inline script (if available).
const w =
  typeof window !== "undefined"
    ? (window as unknown as { __BRAND_LOGO_URL__?: string })
    : undefined;
let urlCache: string | null = w?.__BRAND_LOGO_URL__ ?? null;
let hydrated = urlCache !== null;

function emit() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
}

const LS_KEY = "hdpornforyou:brand-logo-url";

export async function hydrateBrandLogo(): Promise<string | null> {
  try {
    const { url } = await api.get<{ url: string | null }>("/api/brand-logo");
    urlCache = url ?? null;
    try {
      if (urlCache) localStorage.setItem(LS_KEY, urlCache);
      else localStorage.removeItem(LS_KEY);
    } catch {
      /* ignore */
    }
  } catch {
    // On failure keep whatever we had (e.g. localStorage cache) instead of nulling.
  }
  hydrated = true;
  emit();
  return urlCache;
}

export function getBrandLogoUrl(): string | null {
  if (!hydrated && typeof window !== "undefined") hydrateBrandLogo().catch(() => {});
  return urlCache;
}

export function brandLogoHydrated(): boolean {
  return hydrated;
}
