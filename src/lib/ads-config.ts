/**
 * Centralised ads configuration. Backed by /api/settings/ads.
 * No browser storage anywhere. Frequency caps live in module memory only
 * (reset on page reload — acceptable for impression caps).
 */
import { api, beacon } from "./api-client";
import { detectGeoTier } from "./geo";

const EVT = "hdpornforyou:ads-changed";
export const ADS_EVENT = EVT;

export const COOKIE_CONSENT_KEY = "hdpornforyou:cookie-consent";
export const COOKIE_CONSENT_EVENT = "hdpornforyou:cookie-consent";

// GDPR/ePrivacy jurisdictions where a real opt-in choice is required before
// loading ad/analytics scripts. Everywhere else, ads run without gating
// (network relies on legitimate interest / its own compliance, same as the
// overwhelming majority of ad-funded sites) so declining a banner can never
// cost revenue.
const CONSENT_REQUIRED_COUNTRIES = new Set([
  // EEA
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
  "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
  "SI", "ES", "SE",
  // UK + EEA-adjacent strict regimes
  "GB", "UK", "CH", "NO", "IS",
]);

function consentRequired(): boolean {
  try {
    const w = window as unknown as { __EMBED_COUNTRY__?: string };
    const c = w.__EMBED_COUNTRY__ || null;
    if (c) return CONSENT_REQUIRED_COUNTRIES.has(c.toUpperCase());
  } catch {
    /* ignore */
  }
  // No trusted GEO header (no Cloudflare / LAN) → fall back to the device
  // timezone. Consent is only required when the timezone clearly maps to a
  // GDPR jurisdiction. Unknown timezone → safe default (consent required).
  let tz = "";
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return true;
  }
  if (!tz) return true;
  return CONSENT_REQUIRED_TIMEZONES.some((p) => tz === p || tz.startsWith(p + "/"));
}

// Exact GDPR-jurisdiction timezones (EEA + UK + CH + IS). Deliberately NOT a
// blanket "Europe/" match — Europe/Moscow, Europe/Kiev, Europe/Istanbul etc.
// are non-EEA and must not be gated.
const CONSENT_REQUIRED_TIMEZONES = [
  "Europe/Dublin", "Europe/London", "Europe/Lisbon", "Atlantic/Canary",
  "Europe/Madrid", "Europe/Paris", "Europe/Brussels", "Europe/Amsterdam",
  "Europe/Luxembourg", "Europe/Berlin", "Europe/Zurich", "Europe/Vienna",
  "Europe/Rome", "Europe/Malta", "Europe/Prague", "Europe/Budapest",
  "Europe/Warsaw", "Europe/Stockholm", "Europe/Copenhagen", "Europe/Oslo",
  "Europe/Helsinki", "Europe/Tallinn", "Europe/Riga", "Europe/Vilnius",
  "Europe/Zagreb", "Europe/Ljubljana", "Europe/Bratislava",
  "Europe/Bucharest", "Europe/Sofia", "Europe/Athens", "Europe/Nicosia",
  "Atlantic/Reykjavik",
];

/**
 * Ad-consent gate:
 *  - EEA/UK/CH visitors: ads only after they accept the cookie banner.
 *  - Everyone else: ads always show — no banner decision affects revenue.
 * Age-gate storage is essential and unaffected.
 */
export function hasAdConsent(): boolean {
  if (!consentRequired()) return true;
  try {
    return localStorage.getItem(COOKIE_CONSENT_KEY) === "accepted";
  } catch {
    return false;
  }
}

/**
 * Re-evaluate ads once the trusted GEO country hydrates from /api/geo:
 * non-EEA visitors whose ads were held back pre-hydration get unlocked.
 * Safe to call repeatedly.
 */
export function notifyConsentContextChanged(): void {
  window.dispatchEvent(new Event(ADS_EVENT));
}

export type DeviceTarget = "all" | "desktop" | "mobile";
export type NetworkChoice = "auto" | "exoclick" | "trafficstars";
export type AdPlacementKey =
  | "homeNativeFeed"
  | "exploreNative"
  | "latestNative"
  | "categoryNative"
  | "tagsNative"
  | "watchNativeFeed"
  | "watchSidebar"
  | "watchSidebarBanner"
  | "watchAbove"
  | "watchUnder"
  | "homeFeedBanner"
  | "exploreFeedBanner"
  | "latestFeedBanner"
  | "trendingFeedBanner"
  | "searchFeedBanner"
  | "tagsFeedBanner"
  | "categoryFeedBanner"
  | "relatedFeedBanner"
  | "accountFeedBanner"
  | "searchNative"
  | "trendingNative"
  | "relatedNative"
  | "accountNative"
  | "watchOutstream"
  | "homeOutstream"
  | "exploreOutstream"
  | "latestOutstream"
  | "trendingOutstream"
  | "searchOutstream"
  | "tagsOutstream"
  | "categoryOutstream"
  | "accountOutstream"
  | "relatedOutstream"
  | "watchAboveOutstream"
  | "watchBelowOutstream"
  | "watchSidebarOutstream"
  | "interstitial"
  | "videoSlider"
  | "sticky"
  | "popunder";

export interface PlacementZoneConfig {
  desktop?: { exoclick?: string; trafficstars?: string; frequencyCap?: number };
  mobile?: { exoclick?: string; trafficstars?: string; frequencyCap?: number };
}

export interface BaseAdUnit {
  enabled: boolean;
  deviceTarget: DeviceTarget;
  frequencyCap: number;
}

export interface ZoneAdUnit extends BaseAdUnit {
  zoneId: string;
}

export interface VastTags {
  preroll: string;
  midroll: string;
  postroll: string;
}

export interface FluidPlayerConfig {
  /** When false, the watch page bypasses FluidPlayer + VAST entirely:
   *  the embed iframe loads directly with autoplay, no play overlay. */
  enabled: boolean;
}

export interface InterstitialConfig extends BaseAdUnit {
  zoneId: string;
  mobileZoneId: string;
  desktopZoneId: string;
  showOnOpen: boolean;
  schedule: number[];
  cooldown: number;
  cooldownDesktop: number;
  cooldownMobile: number;
  triggerOnRouteChange: boolean;
}

export interface OutstreamConfig extends ZoneAdUnit {
  scrollThreshold: number;
  engagementDelay: number;
  secondaryPlacement: boolean;
  widthDesktop?: number;
  heightDesktop?: number;
  widthMobile?: number;
  heightMobile?: number;
  sidebarEnabled?: boolean;
  sidebarDesktop?: boolean;
  sidebarMobile?: boolean;
  sidebarHeightDesktop?: number;
  inFeedPages?: {
    home?: boolean;
    explore?: boolean;
    latest?: boolean;
    trending?: boolean;
    search?: boolean;
    tags?: boolean;
    category?: boolean;
    related?: boolean;
    account?: boolean;
  };
  /** NEW: show outstream above/below the watch-page video player. */
  aboveVideoPlayer?: boolean;
  belowVideoPlayer?: boolean;
  /** Per-device targeting for the above/below toggles. */
  aboveDesktop?: boolean;
  aboveMobile?: boolean;
  belowDesktop?: boolean;
  belowMobile?: boolean;
}

export interface TrafficStarsConfig {
  enabled: boolean;
  zones: {
    homeBanner: string;
    searchBanner: string;
    accountBanner: string;
    nativeFeed: string;
    watchSidebar: string;
    watchOutstreamNative: string;
    interstitial: string;
    videoSlider: string;
    sticky: string;
    popunder: string;
  };
}

export interface RouterConfig {
  enabled: boolean;
  defaultNetwork: "exoclick" | "trafficstars";
  enableTier1TS: boolean;
  geoRouting: boolean;
  emergencyExoOnly: boolean;
  /** NEW: force ExoClick on every GEO/placement. */
  forceExoEverywhere?: boolean;
  /** NEW: force TrafficStars on every GEO/placement. */
  forceTSEverywhere?: boolean;
  perPlacement: {
    interstitial: NetworkChoice;
    outstream: NetworkChoice;
    native: NetworkChoice;
    slider: NetworkChoice;
  };
}

export interface PageIntervals {
  homeNativeEvery: number;
  exploreNativeEvery: number;
  latestNativeEvery: number;
  searchNativeEvery: number;
  tagsNativeEvery: number;
  categoryNativeEvery: number;
  trendingNativeEvery: number;
  relatedNativeEvery: number;
  savedNativeEvery: number;
}

export interface AccountConfig {
  bannerEnabled: boolean;
  nativeEnabled: boolean;
  outstreamEnabled?: boolean;
}

export interface PopunderConfig {
  enabled: boolean;
  deviceTarget: DeviceTarget;
  frequencyCap: number; // per session
  cooldown: number; // seconds between pops
  exoclickSnippet: string; // full <script> snippet
  trafficstarsSnippet: string; // full <script> snippet
  exoclick?: { desktop?: string; mobile?: string };
  trafficstars?: { desktop?: string; mobile?: string };
  pages: {
    home: boolean;
    trending: boolean;
    explore: boolean;
    latest: boolean;
    search: boolean;
    tags: boolean;
    category: boolean;
    watch: boolean;
    account: boolean;
  };
}

export interface AdsState {
  placementZones?: Partial<Record<AdPlacementKey, PlacementZoneConfig>>;
  vast: {
    enabled: boolean;
    deviceTarget: DeviceTarget;
    tags: VastTags;
    /** NEW: TrafficStars VAST tag set, used for Tier-1 GEOs when router decides. */
    trafficstarsTags?: VastTags;
    midrollAfterSeconds: number;
    midrollMinDurationSeconds: number;
    enablePreroll: boolean;
    enablePostroll: boolean;
  };
  fluidPlayer?: FluidPlayerConfig;
  interstitial: InterstitialConfig;
  videoSlider: ZoneAdUnit & {
    scrollThreshold?: number;
    engagementDelay?: number;
    /** Seconds to wait after a dismissal before the slider may show again. */
    cooldown?: number;
    /** Custom width/height for the floating slider card (px). */
    widthDesktop?: number;
    heightDesktop?: number;
    widthMobile?: number;
    heightMobile?: number;
  };
  nativeBanner: {
    enabled: boolean;
    deviceTarget: DeviceTarget;
    frequencyCap: number;
    bannerFrequencyCap?: number;
    nativeFrequencyCap?: number;
    bannerEnabled?: boolean;
    bannerDeviceTarget?: DeviceTarget;
    nativeEnabled?: boolean;
    nativeDeviceTarget?: DeviceTarget;
    sidebarBannerEnabled?: boolean;
    sidebarBannerDesktop?: boolean;
    sidebarBannerMobile?: boolean;
    sidebarNativeEnabled?: boolean;
    sidebarNativeDesktop?: boolean;
    sidebarNativeMobile?: boolean;
    zones: {
      homeNativeFeed: string;
      watchNativeFeed: string;
      watchSidebar: string;
      watchUnder: string;
    };
    /** NEW: show plain banner above/below watch-page video player. */
    watchAboveEnabled?: boolean;
    watchBelowEnabled?: boolean;
    /** Per-device targeting for the above/below banner toggles. */
    watchAboveDesktop?: boolean;
    watchAboveMobile?: boolean;
    watchBelowDesktop?: boolean;
    watchBelowMobile?: boolean;
    /** NEW: native ad above/below watch-page video player. */
    watchAboveNativeEnabled?: boolean;
    watchBelowNativeEnabled?: boolean;
    watchAboveNativeDesktop?: boolean;
    watchAboveNativeMobile?: boolean;
    watchBelowNativeDesktop?: boolean;
    watchBelowNativeMobile?: boolean;
    /** Secondary banner — show plain banner ads INSIDE feeds alongside native
     * and outstream, rotating on the page's native interval. Tick pages below. */
    inFeedSecondaryPages?: {
      home?: boolean;
      explore?: boolean;
      latest?: boolean;
      trending?: boolean;
      search?: boolean;
      tags?: boolean;
      category?: boolean;
      related?: boolean;
      account?: boolean;
    };
  };
  outstream: OutstreamConfig;
  sticky: {
    enabled: boolean;
    deviceTarget: DeviceTarget;
    frequencyCap: number;
    mobileZone: string;
    desktopZone: string;
    cooldown?: number;
  };
  push: {
    enabled: boolean;
    deviceTarget: DeviceTarget;
    snippet: string;
    frequencyCap: number;
    exoclick?: { desktop?: string; mobile?: string };
    trafficstars?: { desktop?: string; mobile?: string };
  };
  trafficstars: TrafficStarsConfig;
  router: RouterConfig;
  intervals: PageIntervals;
  account: AccountConfig;
  popunder: PopunderConfig;
  /** NEW: video player size override (px). */
  player?: {
    widthDesktop: number;
    heightDesktop: number;
    widthMobile: number;
    heightMobile: number;
  };
}

// Baked-in defaults = the operator's current control configuration.
// Ad-unit identifiers (zone IDs, snippets, VAST tags) intentionally start empty —
// enter them in Admin → Ads on a fresh install.
export const DEFAULT_ADS: AdsState = {
  "vast": {
    "enabled": false,
    "deviceTarget": "all",
    "tags": {
      "preroll": "",
      "midroll": "",
      "postroll": ""
    },
    "trafficstarsTags": {
      "preroll": "",
      "midroll": "",
      "postroll": ""
    },
    "midrollAfterSeconds": 270,
    "midrollMinDurationSeconds": 540,
    "enablePreroll": true,
    "enablePostroll": true
  },
  "fluidPlayer": {
    "enabled": false
  },
  "interstitial": {
    "enabled": true,
    "deviceTarget": "all",
    "frequencyCap": 3,
    "zoneId": "",
    "mobileZoneId": "",
    "desktopZoneId": "",
    "showOnOpen": true,
    "schedule": [
      300,
      900,
      1800
    ],
    "cooldown": 180,
    "cooldownDesktop": 180,
    "cooldownMobile": 240,
    "triggerOnRouteChange": true
  },
  "videoSlider": {
    "enabled": true,
    "deviceTarget": "all",
    "frequencyCap": 0,
    "zoneId": "",
    "scrollThreshold": 0,
    "engagementDelay": 0,
    "cooldown": 10,
    "widthDesktop": 420,
    "heightDesktop": 260,
    "widthMobile": 340,
    "heightMobile": 220
  },
  "nativeBanner": {
    "enabled": false,
    "deviceTarget": "all",
    "frequencyCap": 2,
    "bannerFrequencyCap": 0,
    "nativeFrequencyCap": 0,
    "bannerEnabled": true,
    "bannerDeviceTarget": "all",
    "nativeEnabled": true,
    "nativeDeviceTarget": "all",
    "sidebarBannerEnabled": false,
    "sidebarBannerDesktop": false,
    "sidebarBannerMobile": false,
    "sidebarNativeEnabled": true,
    "sidebarNativeDesktop": false,
    "sidebarNativeMobile": true,
    "zones": {
      "homeNativeFeed": "",
      "watchNativeFeed": "",
      "watchSidebar": "",
      "watchUnder": ""
    },
    "watchAboveEnabled": true,
    "watchBelowEnabled": true,
    "watchAboveDesktop": true,
    "watchAboveMobile": false,
    "watchBelowDesktop": false,
    "watchBelowMobile": true,
    "watchAboveNativeEnabled": false,
    "watchBelowNativeEnabled": true,
    "watchAboveNativeDesktop": false,
    "watchAboveNativeMobile": false,
    "watchBelowNativeDesktop": true,
    "watchBelowNativeMobile": false,
    "inFeedSecondaryPages": {
      "home": true,
      "explore": true,
      "latest": true,
      "trending": true,
      "search": true,
      "tags": true,
      "category": true,
      "related": true,
      "account": true
    }
  },
  "outstream": {
    "enabled": true,
    "deviceTarget": "all",
    "frequencyCap": 0,
    "zoneId": "",
    "scrollThreshold": 0,
    "engagementDelay": 0,
    "secondaryPlacement": false,
    "widthDesktop": 640,
    "heightDesktop": 360,
    "widthMobile": 340,
    "heightMobile": 191,
    "sidebarEnabled": true,
    "sidebarDesktop": true,
    "sidebarMobile": false,
    "sidebarHeightDesktop": 600,
    "inFeedPages": {
      "home": true,
      "explore": true,
      "latest": true,
      "trending": true,
      "search": true,
      "tags": true,
      "category": true,
      "related": true,
      "account": true
    },
    "aboveVideoPlayer": true,
    "belowVideoPlayer": false,
    "aboveDesktop": false,
    "aboveMobile": true,
    "belowDesktop": false,
    "belowMobile": false
  },
  "sticky": {
    "enabled": true,
    "deviceTarget": "all",
    "frequencyCap": 0,
    "mobileZone": "",
    "desktopZone": "",
    "cooldown": 10
  },
  "push": {
    "enabled": false,
    "deviceTarget": "all",
    "snippet": "",
    "frequencyCap": 3,
    "exoclick": {
      "desktop": "",
      "mobile": ""
    },
    "trafficstars": {
      "desktop": "",
      "mobile": ""
    }
  },
  "trafficstars": {
    "enabled": true,
    "zones": {
      "homeBanner": "",
      "searchBanner": "",
      "accountBanner": "",
      "nativeFeed": "",
      "watchSidebar": "",
      "watchOutstreamNative": "",
      "interstitial": "",
      "videoSlider": "",
      "sticky": "",
      "popunder": ""
    }
  },
  "router": {
    "enabled": true,
    "defaultNetwork": "exoclick",
    "enableTier1TS": true,
    "geoRouting": true,
    "emergencyExoOnly": false,
    "forceExoEverywhere": false,
    "forceTSEverywhere": false,
    "perPlacement": {
      "interstitial": "auto",
      "outstream": "auto",
      "native": "auto",
      "slider": "auto"
    }
  },
  "intervals": {
    "homeNativeEvery": 6,
    "exploreNativeEvery": 6,
    "latestNativeEvery": 6,
    "searchNativeEvery": 6,
    "tagsNativeEvery": 6,
    "categoryNativeEvery": 6,
    "trendingNativeEvery": 6,
    "relatedNativeEvery": 3,
    "savedNativeEvery": 3
  },
  "account": {
    "bannerEnabled": true,
    "nativeEnabled": true,
    "outstreamEnabled": true
  },
  "popunder": {
    "enabled": false,
    "deviceTarget": "all",
    "frequencyCap": 3,
    "cooldown": 1800,
    "exoclickSnippet": "",
    "trafficstarsSnippet": "",
    "exoclick": {
      "desktop": "",
      "mobile": ""
    },
    "trafficstars": {
      "desktop": "",
      "mobile": ""
    },
    "pages": {
      "home": true,
      "trending": true,
      "explore": true,
      "latest": true,
      "search": true,
      "tags": true,
      "category": true,
      "watch": true,
      "account": false
    }
  },
  "player": {
    "widthDesktop": 0,
    "heightDesktop": 0,
    "widthMobile": 0,
    "heightMobile": 0
  },
  "placementZones": {}
};

let cache: AdsState = DEFAULT_ADS;
let hydrated = false;

function emit() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (typeof base !== "object" || base === null || Array.isArray(base)) {
    return (patch ?? base) as T;
  }
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    return base;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const k of Object.keys(patch as Record<string, unknown>)) {
    const b = (base as Record<string, unknown>)[k];
    const p = (patch as Record<string, unknown>)[k];
    out[k] = deepMerge(b as never, p);
  }
  return out as T;
}

export async function hydrateAds() {
  const { value } = await api
    .get<{ value: Partial<AdsState> | null }>("/api/settings/ads")
    .catch(() => ({ value: null }));
  cache = deepMerge(DEFAULT_ADS, value ?? {}) as AdsState;
  hydrated = true;
  emit();
}

export function getAds(): AdsState {
  if (!hydrated && typeof window !== "undefined") hydrateAds().catch(() => {});
  return cache;
}

export function getPlacementFrequencyCap(placement: AdPlacementKey, fallback: number): number {
  const device =
    typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches
      ? "mobile"
      : "desktop";
  const perDevice = getAds().placementZones?.[placement]?.[device]?.frequencyCap ?? 0;
  // A single session cap is enforced once: the per-device zone cap is a
  // refinement, never a second multiplier. Non-zero per-device value wins;
  // otherwise fall back to the unit-level cap (0 = unlimited).
  return perDevice > 0 ? perDevice : fallback;
}

export async function setAds(next: AdsState) {
  await api.put("/api/settings/ads", { value: next });
  cache = next;
  emit();
}

/* ---------- Back-compat shims for older code paths ---------- */

const ads = () => getAds();

export const adZones = new Proxy({} as Record<string, string>, {
  get(_t, prop: string) {
    const s = ads();
    const z = s.nativeBanner.zones as Record<string, string>;
    if (prop in z) return z[prop];
    if (prop === "mobileSticky") return s.sticky.mobileZone;
    if (prop === "desktopSidebarSticky") return s.sticky.desktopZone;
    if (prop === "watchPreroll") return z.watchSidebar;
    return "";
  },
});

export const vastTags = new Proxy({} as VastTags, {
  get(_t, prop: keyof VastTags) {
    return ads().vast.tags[prop] ?? "";
  },
});

export const adSettings = new Proxy(
  {} as {
    enablePreroll: boolean;
    enablePostroll: boolean;
    midrollAfterSeconds: number;
    midrollMinDurationSeconds: number;
    popunderPerSession: number;
    enableMobileSticky: boolean;
  },
  {
    get(_t, prop: string) {
      const s = ads();
      switch (prop) {
        case "enablePreroll":
          return s.vast.enablePreroll;
        case "enablePostroll":
          return s.vast.enablePostroll;
        case "midrollAfterSeconds":
          return s.vast.midrollAfterSeconds;
        case "midrollMinDurationSeconds":
          return s.vast.midrollMinDurationSeconds;
        case "enableMobileSticky":
          return s.sticky.enabled;
        case "popunderPerSession":
          return s.popunder?.frequencyCap ?? 0;
        default:
          return undefined;
      }
    },
  },
);

/* ---------- Frequency cap (in-memory only, resets on reload) ---------- */

const fcap: Record<string, number> = {};

export function canShowAd(unit: string, cap: number): boolean {
  if (cap <= 0) return true;
  return (fcap[unit] ?? 0) < cap;
}

export function trackAdImpression(unit: string, format?: string, capKey = unit) {
  if (typeof window === "undefined") return;
  fcap[capKey] = (fcap[capKey] ?? 0) + 1;
  beacon("/api/ads/event", { zone: unit, format, event: "impression" });
}

export function trackAdClick(unit: string, format?: string) {
  if (typeof window === "undefined") return;
  beacon("/api/ads/event", { zone: unit, format, event: "click" });
}

export function matchesDevice(target: DeviceTarget): boolean {
  if (typeof window === "undefined") return true;
  if (target === "all") return true;
  const isMobile = window.matchMedia("(max-width: 768px)").matches;
  return target === "mobile" ? isMobile : !isMobile;
}

/* ---------- In-feed slot helper (native ↔ outstream alternation) ---------- */

export type FeedPage =
  | "home"
  | "explore"
  | "latest"
  | "trending"
  | "search"
  | "tags"
  | "category"
  | "related"
  | "account";

export type FeedAdFormat = "native" | "outstream" | "banner";

export function pickFeedSlot(
  i: number,
  every: number,
  page: FeedPage,
): "none" | FeedAdFormat {
  const N = Math.max(2, every | 0);
  if ((i + 1) % N !== 0) return "none";
  const slot = (i + 1) / N;
  const o = getAds().outstream;
  const accountOutstreamEnabled =
    page !== "account" || (getAds().account.outstreamEnabled ?? false);
  const outstreamPageEnabled =
    accountOutstreamEnabled &&
    !!o.enabled &&
    matchesDevice(o.deviceTarget) &&
    !!(o.inFeedPages && o.inFeedPages[page]);
  const n = getAds().nativeBanner;
  const nativeEnabled =
    (page !== "account" || getAds().account.nativeEnabled) &&
    (n.nativeEnabled ?? n.enabled) &&
    matchesDevice(n.nativeDeviceTarget ?? n.deviceTarget);
  const bannerPageEnabled =
    (page !== "account" || !!getAds().account.bannerEnabled) &&
    (n.bannerEnabled ?? n.enabled) &&
    matchesDevice(n.bannerDeviceTarget ?? n.deviceTarget) &&
    !!(n.inFeedSecondaryPages && n.inFeedSecondaryPages[page]);
  // Rotation across ENABLED formats in fixed order native → outstream →
  // banner, so a disabled format's turns are taken by the enabled ones:
  // all on = N,O,B,N,O,B…; banner off = N,O,N,O…; outstream off = N,B,N,B…;
  // only one on = that format every N; none on = "none".
  const enabled: FeedAdFormat[] = [
    ...(nativeEnabled ? (["native"] as const) : []),
    ...(outstreamPageEnabled ? (["outstream"] as const) : []),
    ...(bannerPageEnabled ? (["banner"] as const) : []),
  ];
  if (!enabled.length) return "none";
  return enabled[(slot - 1) % enabled.length];
}

/* ---------- VAST geo routing ----------
 * Mirrors the AdRouter rules used for banner/native zones:
 *   - Tier-1 GEO  → TrafficStars VAST tag (falls back to ExoClick if blank).
 *   - Tier-2/3    → ExoClick VAST tag (falls back to TrafficStars if blank).
 *   - Router overrides (emergencyExoOnly / forceExoEverywhere / forceTSEverywhere
 *     / geoRouting=false / enableTier1TS=false) are honoured.
 */
export type VastRoll = "preroll" | "midroll" | "postroll";

export interface VastPickResult {
  network: "exoclick" | "trafficstars";
  tag: string;
}

export function pickVastTag(roll: VastRoll): VastPickResult {
  // GDPR/ePrivacy: no VAST ads until the visitor consents.
  if (!hasAdConsent()) return { network: "exoclick", tag: "" };
  const a = getAds();
  const exoTag = a.vast.tags?.[roll] || "";
  const tsTag = a.trafficstars.enabled ? a.vast.trafficstarsTags?.[roll] || "" : "";
  const router = a.router;

  let preferred: "exoclick" | "trafficstars" = "exoclick";

  const forcedExo = !!router?.forceExoEverywhere || !!router?.emergencyExoOnly;
  const forcedTs = !!router?.forceTSEverywhere;
  if (forcedExo) {
    preferred = "exoclick";
  } else if (forcedTs) {
    preferred = "trafficstars";
  } else if (!router?.enabled || router?.geoRouting === false) {
    preferred = (router?.defaultNetwork as "exoclick" | "trafficstars") || "exoclick";
  } else {
    // Reuse the shared geo detection (handles __EMBED_COUNTRY__ and specific
    // TZ prefixes — not the broad "America/" match that caused Tier-2/3 LATAM
    // to be incorrectly routed to TrafficStars).
    const tier = detectGeoTier();
    preferred = tier === "tier1" && router?.enableTier1TS !== false ? "trafficstars" : "exoclick";
  }

  if (forcedExo) return { network: "exoclick", tag: exoTag };
  if (forcedTs) return { network: "trafficstars", tag: tsTag };
  if (preferred === "trafficstars" && tsTag) return { network: "trafficstars", tag: tsTag };
  if (preferred === "exoclick" && exoTag) return { network: "exoclick", tag: exoTag };
  // Fallback to whichever is configured.
  if (tsTag) return { network: "trafficstars", tag: tsTag };
  if (exoTag) return { network: "exoclick", tag: exoTag };
  return { network: preferred, tag: "" };
}

/** Passback: the OTHER network's VAST tag after the routed one failed
 *  (empty auction / no fill). Honours the TrafficStars master toggle. */
export function pickVastFallbackTag(
  roll: VastRoll,
  failedNetwork: "exoclick" | "trafficstars",
): VastPickResult {
  const a = getAds();
  const other: "exoclick" | "trafficstars" = failedNetwork === "exoclick" ? "trafficstars" : "exoclick";
  const tag =
    other === "trafficstars"
      ? a.trafficstars.enabled
        ? a.vast.trafficstarsTags?.[roll] || ""
        : ""
      : a.vast.tags?.[roll] || "";
  return { network: other, tag };
}

/** True when the FluidPlayer + VAST overlay should be used on the watch page. */
export function isFluidPlayerEnabled(): boolean {
  const fp = getAds().fluidPlayer;
  // Backwards-compat: defaults to true (preserves pre-v24 behaviour).
  return fp?.enabled !== false;
}
