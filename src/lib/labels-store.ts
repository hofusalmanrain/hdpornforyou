/**
 * Editable site copy. Backed by /api/settings/labels. No browser storage.
 */
import { api } from "./api-client";

const EVT = "hdpornforyou:labels-changed";
export const LABELS_EVENT = EVT;

export type LabelKey =
  | "brandName"
  | "brandTagline"
  | "heroBadge"
  | "heroCtaPlay"
  | "heroCtaInfo"
  | "featuredTitle"
  | "trendingTitle"
  | "latestTitle"
  | "recommendedTitle"
  | "commentsTitle"
  | "subscribeLabel"
  | "footerTagline"
  | "accountTitle"
  | "accountSubtitle"
  | "adminTitle"
  | "contactEmail";

export const DEFAULT_LABELS: Record<LabelKey, string> = {
  brandName: "HDPORNFORYOU",
  brandTagline: "Premium 18+ Embedded Video Streaming Platform",
  heroBadge: "Featured Now",
  heroCtaPlay: "Play now",
  heroCtaInfo: "Details",
  featuredTitle: "⭐ Featured",
  trendingTitle: "🔥 Trending Now",
  latestTitle: "Latest videos",
  recommendedTitle: "Recommended for you",
  commentsTitle: "Comments",
  subscribeLabel: "Subscribe",
  footerTagline:
    "18+ Adult Video Platform. All videos are embedded from third-party providers (Eporner) via official API. We do not host or store any video files on our servers.",
  accountTitle: "Your account",
  accountSubtitle: "Sign in or create an account to save favorites and sync history.",
  adminTitle: "Admin dashboard",
  contactEmail: "contact@hdpornforyou.com",
};

let cache: Record<LabelKey, string> = { ...DEFAULT_LABELS };
let hydrated = false;

function emit() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
}

export async function hydrateLabels() {
  const { value } = await api
    .get<{ value: Partial<Record<LabelKey, string>> | null }>("/api/settings/labels")
    .catch(() => ({ value: null }));
  cache = { ...DEFAULT_LABELS, ...(value ?? {}) };
  hydrated = true;
  emit();
}

export function getLabels(): Record<LabelKey, string> {
  if (!hydrated && typeof window !== "undefined") hydrateLabels().catch(() => {});
  return cache;
}

export async function setLabels(next: Partial<Record<LabelKey, string>>) {
  const merged = { ...cache, ...next };
  await api.put("/api/settings/labels", { value: merged });
  cache = merged;
  emit();
}

export async function resetLabels() {
  await api.put("/api/settings/labels", { value: null });
  cache = { ...DEFAULT_LABELS };
  emit();
}
