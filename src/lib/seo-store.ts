/**
 * Site-wide and per-video SEO settings. Backed by /api/settings/seo
 * and /api/settings/seo-pages. No browser storage.
 */
import { api } from "./api-client";

const EVT = "hdpornforyou:seo-changed";
export const SEO_EVENT = EVT;

export interface OgSettings {
  type: string;
  siteName: string;
  image: string;
  imageAlt: string;
}

export interface TwitterSettings {
  card: "summary" | "summary_large_image" | "app" | "player";
  site: string;
  creator: string;
  image: string;
}

export interface SeoSettings {
  title: string;
  description: string;
  canonicalBase: string;
  robots: string;
  og: OgSettings;
  twitter: TwitterSettings;
  robotsTxt: string;
  adsTxt: string;
  customHead: string;
  customBody: string;
  ogImage?: string;
  twitterHandle?: string;
}

export interface PageSeo {
  title?: string;
  description?: string;
  ogImage?: string;
  canonical?: string;
  noindex?: boolean;
}

export const DEFAULT_SEO: SeoSettings = {
  title: "HDPORNFORYOU — Premium 18+ Embedded Video Streaming Platform",
  description:
    "Watch free 18+ adult videos on HDPORNFORYOU. All content is embedded via Eporner's official API — we do not host or store any video files. All models are 18+.",
  canonicalBase: "https://hdpornforyou.com",
  robots: "index, follow",
  og: { type: "website", siteName: "HDPORNFORYOU", image: "https://hdpornforyou.com/og-image.jpg", imageAlt: "HDPORNFORYOU — 18+ Embedded Adult Streaming" },
  twitter: {
    card: "summary_large_image",
    site: "@hdpornforyou",
    creator: "@hdpornforyou",
    image: "",
  },
  robotsTxt: "User-agent: *\nAllow: /\n",
  adsTxt: "# Add ads.txt records here, one per line.\n",
  customHead: "",
  customBody: "",
};

let cache: SeoSettings = { ...DEFAULT_SEO };
let pagesCache: Record<string, PageSeo> = {};
let hydrated = false;
let pagesHydrated = false;

function emit() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
}

function merge(base: SeoSettings, patch: Partial<SeoSettings>): SeoSettings {
  return {
    ...base,
    ...patch,
    og: { ...base.og, ...(patch.og ?? {}) },
    twitter: { ...base.twitter, ...(patch.twitter ?? {}) },
  };
}

export async function hydrateSeo() {
  const [seo, pages] = await Promise.all([
    api
      .get<{ value: Partial<SeoSettings> | null }>("/api/settings/seo")
      .catch(() => ({ value: null })),
    api
      .get<{ value: Record<string, PageSeo> | null }>("/api/settings/seo-pages")
      .catch(() => ({ value: null })),
  ]);
  cache = merge(DEFAULT_SEO, seo.value ?? {});
  if (seo.value?.ogImage && !cache.og.image) cache.og.image = seo.value.ogImage;
  if (seo.value?.twitterHandle && !cache.twitter.site) cache.twitter.site = seo.value.twitterHandle;
  pagesCache = pages.value ?? {};
  hydrated = true;
  pagesHydrated = true;
  emit();
}

export function getSeo(): SeoSettings {
  if (!hydrated && typeof window !== "undefined") hydrateSeo().catch(() => {});
  return cache;
}

export async function setSeo(next: Partial<SeoSettings>) {
  if (!hydrated && typeof window !== "undefined") {
    await hydrateSeo().catch(() => {});
  }
  const merged = merge(cache, next);
  await api.put("/api/settings/seo", { value: merged });
  cache = merged;
  emit();
}

export async function resetSeo() {
  await api.put("/api/settings/seo", { value: null });
  cache = { ...DEFAULT_SEO };
  emit();
}

export function getPageSeo(id: string): PageSeo {
  if (!pagesHydrated && typeof window !== "undefined") hydrateSeo().catch(() => {});
  return pagesCache[id] ?? {};
}

export async function setPageSeo(id: string, patch: PageSeo) {
  const next = { ...pagesCache, [id]: { ...pagesCache[id], ...patch } };
  await api.put("/api/settings/seo-pages", { value: next });
  pagesCache = next;
  emit();
}
