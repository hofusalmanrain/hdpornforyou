/**
 * AdRouter — multi-network mediation engine.
 *
 * Picks an ad network (ExoClick vs TrafficStars) and the right zoneId for a
 * given placement, based on:
 *   - GEO tier (Tier-1 vs Tier-2/3) detected from browser timezone/locale
 *   - device (mobile / desktop)
 *   - admin-controlled router config (in ads-config.ts)
 *
 * GEO-routing rules (preserved + extended, never overridden):
 *   - Tier-2/3 (Asia, India, Nepal, Pakistan, SEA, LATAM):
 *       → ExoClick only (max fill rate, stability)
 *   - Tier-1 (US, UK, CA, AU, DE, NL, EU):
 *       → TrafficStars priority + ExoClick fallback
 *
 * No UI surface; pure logic. Falls back to ExoClick on any uncertainty.
 */

import { getAds, hasAdConsent, type AdPlacementKey } from "./ads-config";
import { detectGeoTier as _detectGeoTier, getDetectedCountry as _getDetectedCountry } from "./geo";

export type Network = "exoclick" | "trafficstars";
export type Placement =
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
  | "interstitial"
  | "videoSlider"
  | "sticky"
  | "popunder";

export interface RouteDecision {
  network: Network;
  zoneId: string;
  fallback?: { network: Network; zoneId: string };
}

export interface NetworkPolicy {
  preferred: Network;
  forced: boolean;
}

/* ---------- GEO tier detection ---------- */

export const detectGeoTier = _detectGeoTier;
export const getDetectedCountry = _getDetectedCountry;

/* ---------- Device detection ---------- */

export function detectDevice(): "mobile" | "desktop" {
  if (typeof window === "undefined") return "desktop";
  return window.matchMedia("(max-width: 768px)").matches ? "mobile" : "desktop";
}

export function getNetworkPolicy(): NetworkPolicy {
  const ads = getAds();
  const router = ads.router;
  if (router.forceExoEverywhere || router.emergencyExoOnly) {
    return { preferred: "exoclick", forced: true };
  }
  if (router.forceTSEverywhere) {
    return { preferred: "trafficstars", forced: true };
  }
  if (!router.enabled || !router.geoRouting) {
    return { preferred: router.defaultNetwork || "exoclick", forced: false };
  }
  return {
    preferred:
      detectGeoTier() === "tier1" && router.enableTier1TS !== false ? "trafficstars" : "exoclick",
    forced: false,
  };
}

/* ---------- Core routing ---------- */

/**
 * Choose a network + zoneId for a placement, with fallback.
 *
 * Respects:
 *  - router.enabled                : master toggle
 *  - router.geoRouting             : if false, default network only
 *  - router.enableTier1TS          : if false, Tier-1 still goes to ExoClick
 *  - router.defaultNetwork         : when geo can't decide
 *  - router.perPlacement[placement]: hard override per placement
 *  - router.emergencyExoOnly       : force ExoClick everywhere
 */
export function pickAdZone(placement: Placement): RouteDecision {
  // GDPR/ePrivacy: no ad decisions until the visitor consents.
  if (!hasAdConsent()) return { network: "exoclick", zoneId: "" };
  const ads = getAds();
  const router = ads.router;
  const tier = detectGeoTier();

  // Emergency: force ExoClick.
  const forceExo = !!router?.emergencyExoOnly || !!router?.forceExoEverywhere;
  const forceTS = !!router?.forceTSEverywhere;

  // Decide preferred network.
  let preferred: Network;
  if (forceExo) {
    preferred = "exoclick";
  } else if (forceTS) {
    preferred = "trafficstars";
  } else if (!router?.enabled || router?.geoRouting === false) {
    preferred = (router?.defaultNetwork as Network) || "exoclick";
  } else if (tier === "tier1" && router?.enableTier1TS !== false) {
    preferred = "trafficstars";
  } else {
    preferred = getNetworkPolicy().preferred;
  }

  // Resolve zones.
  const device = detectDevice();
  const configured = ads.placementZones?.[placement as AdPlacementKey]?.[device];
  const exoZone = configured?.exoclick || "";
  const tsZone = ads.trafficstars.enabled ? configured?.trafficstars || "" : "";

  if (forceExo) return { network: "exoclick", zoneId: exoZone };
  if (forceTS) return { network: "trafficstars", zoneId: tsZone };

  if (preferred === "trafficstars" && tsZone) {
    return {
      network: "trafficstars",
      zoneId: tsZone,
      fallback: exoZone ? { network: "exoclick", zoneId: exoZone } : undefined,
    };
  }
  if (preferred === "exoclick" && exoZone) {
    return {
      network: "exoclick",
      zoneId: exoZone,
      fallback: tsZone ? { network: "trafficstars", zoneId: tsZone } : undefined,
    };
  }
  // Preferred has no zone — try the other when no hard force is active.
  if (tsZone) return { network: "trafficstars", zoneId: tsZone };
  if (exoZone) return { network: "exoclick", zoneId: exoZone };
  return { network: "exoclick", zoneId: "" };
}

/* ---------- Engagement gating ---------- */

let scrollDepth = 0;
let pageLoadedAt = Date.now();

if (typeof window !== "undefined") {
  pageLoadedAt = Date.now();
  let ticking = false;
  const update = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const d = Math.min(1, window.scrollY / max);
      if (d > scrollDepth) scrollDepth = d;
      ticking = false;
    });
  };
  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("load", () => {
    pageLoadedAt = Date.now();
  });
}

export function engagementScore(): { scroll: number; secondsOnPage: number } {
  return {
    scroll: scrollDepth,
    secondsOnPage: Math.floor((Date.now() - pageLoadedAt) / 1000),
  };
}

export function meetsEngagement(scrollThreshold = 0.25, secondsThreshold = 8): boolean {
  const e = engagementScore();
  return e.scroll >= scrollThreshold || e.secondsOnPage >= secondsThreshold;
}

export function resetEngagement() {
  scrollDepth = 0;
  pageLoadedAt = Date.now();
}
