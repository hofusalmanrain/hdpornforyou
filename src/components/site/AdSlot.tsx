import { useEffect, useRef, useState } from "react";
import {
  trackAdClick,
  trackAdImpression,
  getAds,
  matchesDevice,
  canShowAd,
  getPlacementFrequencyCap,
} from "@/lib/ads-config";
import { pickAdZone, type Placement, type Network } from "@/lib/ad-router";
import { TrafficStarsSpot } from "./TrafficStarsSpot";
import { useAdRescue } from "@/hooks/use-ad-rescue";
import { useAdZoneClaim } from "@/hooks/use-ad-zone-claim";

/**
 * Generic ad slot.
 *
 * Features:
 *  - IntersectionObserver-based lazy load (only renders the ad script when visible).
 *  - Duplicate-request prevention (one provider push per mount).
 *  - Multi-network mediation via AdRouter (ExoClick + TrafficStars).
 *  - Back-compat: still accepts an explicit `zoneId` (forces ExoClick).
 *
 * Provider script (loaded once globally via AdProvider):
 *   ExoClick:     <script async src="https://a.magsrv.com/ad-provider.js"></script>
 *   TrafficStars: <script async src="https://cdn.tsyndicate.com/sdk/v1/master.spot.js"></script>
 */
export interface AdSlotProps {
  /** Back-compat. If provided, this exact ExoClick zone is rendered. */
  zoneId?: string;
  /** Preferred routed placement — uses AdRouter to pick network + zoneId. */
  placement?: Placement;
  format: "banner" | "native" | "sticky" | "sidebar" | "interstitial" | "video";
  className?: string;
  label?: string;
  sidebar?: boolean;
}

declare global {
  interface Window {
    AdProvider?: Array<Record<string, unknown>>;
    /** TrafficStars spot.js global, optional. */
    _tsyndicate?: unknown;
  }
}

const sizeClass: Record<AdSlotProps["format"], string> = {
  banner: "min-h-[90px] md:min-h-[120px]",
  native: "min-h-[260px]",
  // Native sidebar creative (~260px). The old 600px reservation was for
  // desktop 300x600 banners and left a large dead gap above the next card.
  sidebar: "min-h-[260px]",
  sticky: "min-h-[60px]",
  interstitial: "min-h-[400px]",
  video: "aspect-video",
};

export function AdSlot({
  zoneId,
  placement,
  format,
  className = "",
  label = "Sponsored",
  sidebar = false,
}: AdSlotProps) {
  const ref = useRef<HTMLDivElement>(null);
  const fired = useRef(false);
  const [, force] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const sync = () => {
      // Reset impression tracking so a changed zone re-tracks, but keep
      // visibility: resetting it here can strand a visible slot blank
      // (no new intersection event fires for an already-visible element).
      fired.current = false;
      force((n) => n + 1);
    };
    window.addEventListener("hdpornforyou:ads-changed", sync);
    return () => window.removeEventListener("hdpornforyou:ads-changed", sync);
  }, []);

  // Resolve network + zone.
  let resolvedNetwork: Network = "exoclick";
  let resolvedZone = zoneId ?? "";
  let fallbackZone = "";
  let fallbackNetwork: Network = "exoclick";
  // Blocked = format disabled, wrong device, or frequency cap reached:
  // render nothing (not even the dev placeholder).
  let blocked = false;
  if (!zoneId && placement) {
    const ads = getAds();
    const nb = ads.nativeBanner;
    // Per-format gating: plain banners + native zones can now be controlled
    // independently from the Admin panel. Falls back to the master toggle.
    const isNativeFormat = format === "native" || format === "sidebar";
    const isSidebar = sidebar || placement === "watchSidebar";
    const gateEnabled = isSidebar
      ? format === "sidebar"
        ? (nb.sidebarNativeEnabled ?? nb.nativeEnabled ?? nb.enabled)
        : (nb.sidebarBannerEnabled ?? nb.bannerEnabled ?? nb.enabled)
      : isNativeFormat
        ? (nb.nativeEnabled ?? nb.enabled)
        : (nb.bannerEnabled ?? nb.enabled);
    const gateDevice = isSidebar
      ? "all"
      : isNativeFormat
        ? (nb.nativeDeviceTarget ?? nb.deviceTarget)
        : (nb.bannerDeviceTarget ?? nb.deviceTarget);
    if (
      gateEnabled &&
      matchesDevice(gateDevice) &&
      canShowAd(
        placement,
        getPlacementFrequencyCap(
          placement,
          isNativeFormat
            ? (nb.nativeFrequencyCap ?? nb.frequencyCap)
            : (nb.bannerFrequencyCap ?? nb.frequencyCap),
        ),
      )
    ) {
      const decision = pickAdZone(placement);
      resolvedNetwork = decision.network;
      resolvedZone = decision.zoneId;
      fallbackZone = decision.fallback?.zoneId ?? "";
      if (decision.fallback) fallbackNetwork = decision.fallback.network;
    } else {
      blocked = true;
    }
  }

  // Render-time rescue: chosen network never fills → swap to the fallback
  // network's tag in the same slot.
  const primary =
    !blocked && resolvedZone
      ? { network: resolvedNetwork, zoneId: resolvedZone }
      : null;
  // Only the first slot for this network+zone may render. Feed pages and the
  // watch page reuse one zone across several placements; without this guard
  // the same creative is requested and painted more than once per page.
  const ownsZone = useAdZoneClaim(primary);
  const shown = useAdRescue(
    ref,
    visible && !blocked && ownsZone,
    primary,
    fallbackZone ? { network: fallbackNetwork, zoneId: fallbackZone } : null,
  );

  // Lazy-load on intersection.
  useEffect(() => {
    if (!resolvedZone || !ownsZone) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true);
            obs.disconnect();
            break;
          }
        }
      },
      // Start loading well before the slot scrolls into view so the
      // creative is ready (or nearly) when the user gets there.
      { rootMargin: "600px 0px", threshold: 0.01 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [resolvedZone, ownsZone]);

  // Re-track when rescue swaps the creative to the other network.
  useEffect(() => {
    fired.current = false;
  }, [shown?.network, shown?.zoneId]);

  // Fire impression + provider push exactly once when visible.
  useEffect(() => {
    if (!visible || !shown || !ownsZone || fired.current) return;
    fired.current = true;
    const capKey = placement || (format === "native" || format === "sidebar" ? "native" : "banner");
    trackAdImpression(shown.zoneId, format, capKey);
    try {
      if (shown.network === "exoclick") {
        window.AdProvider = window.AdProvider || [];
        window.AdProvider.push({ serve: {} });
      }
      // TrafficStars master.spot.js auto-serves on <ins data-id> insertion.
    } catch {
      /* silent */
    }
  }, [visible, shown?.network, shown?.zoneId, ownsZone, format]);

  // Gated off (disabled / wrong device / cap reached): render nothing —
  // placed after all hooks so hook order stays stable.
  if (blocked) return null;

  // No usable network (provider script confirmed unavailable by the browser
  // — e.g. Firefox ETP / content blockers / offline — and no reachable
  // passback): hide the slot instead of reserving blank space. The slot
  // re-renders automatically via ADS_EVENT if a script becomes available.
  if (resolvedZone && (!shown || !ownsZone)) return null;

  if (!resolvedZone) {
    // Placeholder keeps layout stable in dev / when un-configured.
    return (
      <div
        ref={ref}
        className={`relative overflow-hidden rounded-2xl glass border-dashed border-2 border-primary/20 flex items-center justify-center ${sizeClass[format]} ${className}`}
        aria-label="Ad placeholder"
      >
        <div className="text-center px-6">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
          <p className="mt-1 font-display text-sm text-foreground/80">Ad slot — {format}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add zone IDs in the Admin → Ads panel
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={`relative ${sizeClass[format]} ${className}`}
      onClick={() => trackAdClick(resolvedZone, format)}
    >
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{label}</p>
      {!visible && (
        <div aria-hidden className="absolute inset-x-0 top-6 bottom-0 animate-pulse rounded-lg bg-muted/30" />
      )}
      {visible && shown && renderNetwork(shown.network, shown.zoneId)}
    </div>
  );
}

function renderNetwork(network: Network, zoneId: string) {
  if (network === "trafficstars") {
    return <TrafficStarsSpot spot={zoneId} style={{ display: "block", width: "100%" }} />;
  }
  // ExoClick
  return <ins className="eas6a97888e10" data-zoneid={zoneId} style={{ display: "block" }} />;
}
