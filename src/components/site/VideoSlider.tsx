import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import {
  ADS_EVENT,
  canShowAd,
  getAds,
  getPlacementFrequencyCap,
  matchesDevice,
  trackAdImpression,
} from "@/lib/ads-config";
import { pickAdZone, meetsEngagement, type Network } from "@/lib/ad-router";
import { TrafficStarsSpot } from "./TrafficStarsSpot";
import { useAdRescue } from "@/hooks/use-ad-rescue";
import { useAdZoneClaim } from "@/hooks/use-ad-zone-claim";

// ExoClick signals dismissals and enforces its own per-zone capping with two
// first-party cookies:
//  - `zone-closed-{id}` — set when the user closes a unit (suppresses until expiry).
//  - `zone-cap-{id}`    — impression counter; when it reaches the zone's own
//    configured capping, the zone refuses to serve until the cookie expires (6h).
// These cookies are the provider's own delivery controls and MUST be left
// intact (deleting them to force extra serves violates the provider terms).
// We only READ the close cookie to detect dismissal for re-arm UX; our
// admin-side frequencyCap governs how often WE request the slot.

/**
 * Global Video Slider ad (TrafficStars Video IM slider / ExoClick equivalent).
 *
 * - Mounted ONCE globally (App.tsx).
 * - Shows on every page after `engagementDelay` seconds, re-appears after
 *   `cooldown` between shows.
 * - Respects the per-session `frequencyCap` from admin.
 * - Floating bottom-right card; playback controls remain provider-owned.
 * - Router picks TrafficStars vs ExoClick automatically via pickAdZone("videoSlider").
 */
export function VideoSlider() {
  const { pathname } = useLocation();
  const [decision, setDecision] = useState<{
    network: Network;
    zoneId: string;
    fallback: { network: Network; zoneId: string } | null;
  } | null>(null);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? 0 : window.innerWidth,
  );
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window === "undefined" ? 0 : window.innerHeight,
  );
  const sliderRef = useRef<HTMLDivElement>(null);
  const fired = useRef(false);
  const graceTimer = useRef<number>(0);
  const mountedAt = useRef<number>(Date.now());
  const lastShownAt = useRef<number>(0);

  // Re-sync on settings change.
  const [, force] = useState(0);
  useEffect(() => {
    const sync = () => force((n) => n + 1);
    window.addEventListener(ADS_EVENT, sync);
    return () => window.removeEventListener(ADS_EVENT, sync);
  }, []);

  useEffect(() => {
    const onResize = () => {
      setViewportWidth(window.innerWidth);
      setViewportHeight(window.innerHeight);
    };
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    mountedAt.current = Date.now();
    setDecision(null);
    fired.current = false;
  }, [pathname]);

  const cfg = getAds().videoSlider;
  const enabled =
    !!cfg &&
    cfg.enabled &&
    matchesDevice(cfg.deviceTarget) &&
    canShowAd("videoSlider", getPlacementFrequencyCap("videoSlider", cfg.frequencyCap));

  // Engagement gate — picks zone once enough time/scroll has passed AND
  // the per-show cooldown has elapsed (re-uses outstream engagement helper).
  useEffect(() => {
    if (!enabled || decision) return;
    const threshold = cfg.scrollThreshold ?? 0.25;
    const delay = cfg.engagementDelay ?? 12;
    const cooldownMs = (cfg.cooldown ?? 10) * 1000; // re-appear after dismissal once the cooldown elapses
    const tick = window.setInterval(() => {
      const now = Date.now();
      if (now - lastShownAt.current < cooldownMs) return;
      if (!meetsEngagement(threshold, delay)) return;
      const d = pickAdZone("videoSlider");
      if (!d.zoneId) return;
      window.clearInterval(tick);
      lastShownAt.current = now;
      setDecision({ network: d.network, zoneId: d.zoneId, fallback: d.fallback ?? null });
    }, 1500);
    return () => window.clearInterval(tick);
  }, [enabled, decision, cfg.scrollThreshold, cfg.engagementDelay, cfg.cooldown]);

  // Render-time rescue: chosen network never fills → swap to fallback.
  const ownsZone = useAdZoneClaim(
    decision ? { network: decision.network, zoneId: decision.zoneId } : null,
  );
  const shown = useAdRescue(
    sliderRef,
    !!decision && ownsZone,
    decision,
    decision?.fallback ?? null,
  );

  // Re-arm when the user closes the slider. ExoClick signals a real dismissal
// with a `zone-closed-{idzone}` cookie (set only on close — NOT on video
// completion, which merely hides the video element). TrafficStars has no such
// cookie — its spot close hides or removes the injected creative instead.
// In both cases wait out the close animation (~1s slide) before unmounting.
  useEffect(() => {
    if (!shown || !ownsZone) return;
    const el = sliderRef.current;
    let prevVisible = false;
    const dismiss = () => {
      window.clearInterval(iv);
      lastShownAt.current = Date.now();
      const grace = window.setTimeout(() => {
        fired.current = false;
        setDecision(null);
      }, 1800);
      graceTimer.current = grace;
    };
    const iv = window.setInterval(() => {
      if (shown.network === "exoclick") {
        const closed = document.cookie
          .split(";")
          .some((c) => c.trim().startsWith(`zone-closed-${shown.zoneId}`));
        if (closed) dismiss();
        return;
      }
      // TrafficStars: the injected creative disappearing = dismissal.
      const ins = el?.querySelector("ins");
      const iframe = ins?.querySelector("iframe");
      const creative = iframe ?? ins;
      const cs = creative ? getComputedStyle(creative) : null;
      const hidden =
        !creative ||
        cs!.display === "none" ||
        cs!.visibility === "hidden" ||
        creative.clientWidth < 2 ||
        creative.clientHeight < 2 ||
        (!!iframe && (iframe.src === "about:blank" || iframe.src === ""));
      if (prevVisible && hidden) dismiss();
      prevVisible = !hidden;
    }, 1500);
    return () => {
      window.clearInterval(iv);
      window.clearTimeout(graceTimer.current);
    };
  }, [shown, ownsZone]);

  // Re-track when rescue swaps the creative to the other network.
  useEffect(() => {
    fired.current = false;
  }, [shown?.network, shown?.zoneId]);

  // Push provider exactly once when a decision lands.
  useEffect(() => {
    if (!shown || !ownsZone || fired.current) return;
    fired.current = true;
    trackAdImpression(shown.zoneId, "videoSlider", "videoSlider");
    try {
      if (shown.network === "exoclick") {
        window.AdProvider = window.AdProvider || [];
        window.AdProvider.push({ serve: {} });
      }
    } catch {
      /* noop */
    }
  }, [shown, ownsZone]);

  if (!enabled || !shown || !ownsZone) return null;

  const isMobile = viewportWidth > 0 && viewportWidth <= 768;
  const w = isMobile ? (cfg.widthMobile ?? 340) : (cfg.widthDesktop ?? 420);
  const h = isMobile ? (cfg.heightMobile ?? 220) : (cfg.heightDesktop ?? 260);
  const horizontalInset = isMobile ? 24 : 48;
  const safeWidth = Math.min(w, Math.max(0, viewportWidth - horizontalInset));
  const safeHeight = Math.min(h, Math.max(0, viewportHeight - 96));

  return (
    <div
      ref={sliderRef}
      className="fixed bottom-20 left-3 z-40 overflow-hidden animate-fade-up md:bottom-6 md:right-6 md:left-auto"
      style={{ width: safeWidth, height: safeHeight }}
    >
      {shown.network === "trafficstars" ? (
        <TrafficStarsSpot
          spot={shown.zoneId}
          className="block max-w-full"
          style={{ width: safeWidth, height: safeHeight }}
        />
      ) : (
        <ins
          className="eas6a97888e10 block max-w-full"
          data-zoneid={shown.zoneId}
          style={{ width: safeWidth, height: safeHeight }}
        />
      )}
    </div>
  );
}
