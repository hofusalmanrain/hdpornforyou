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
import { pickAdZone, type Network } from "@/lib/ad-router";
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
 * Global sticky banner ad (ExoClick sticky banner / TrafficStars equivalent).
 *
 * - Mounted ONCE globally (App.tsx).
 * - Shows immediately when enabled; after the user closes it (provider close
 *   button) it re-appears once the admin `cooldown` elapses.
 * - One `frequencyCap` per session — a per-placement override is honoured,
 *   otherwise the format-level cap applies.
 * - Router picks TrafficStars vs ExoClick automatically via pickAdZone("sticky").
 */
export function StickyAd() {
  const { pathname } = useLocation();
  const [decision, setDecision] = useState<{
    network: Network;
    zoneId: string;
    fallback: { network: Network; zoneId: string } | null;
  } | null>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const fired = useRef(false);
  const graceTimer = useRef<number>(0);
  const lastShownAt = useRef<number>(0);

  // Render-time rescue: chosen network never fills → swap to fallback.
  const ownsZone = useAdZoneClaim(
    decision ? { network: decision.network, zoneId: decision.zoneId } : null,
  );
  const shown = useAdRescue(
    stickyRef,
    !!decision && ownsZone,
    decision,
    decision?.fallback ?? null,
  );

  // Re-sync on settings change.
  const [, force] = useState(0);
  useEffect(() => {
    const sync = () => force((n) => n + 1);
    window.addEventListener(ADS_EVENT, sync);
    return () => window.removeEventListener(ADS_EVENT, sync);
  }, []);

  useEffect(() => {
    lastShownAt.current = 0;
    setDecision(null);
    fired.current = false;
  }, [pathname]);

  const cfg = getAds().sticky;
  const enabled =
    !!cfg &&
    cfg.enabled &&
    matchesDevice(cfg.deviceTarget) &&
    canShowAd("sticky", getPlacementFrequencyCap("sticky", cfg.frequencyCap));

  // Show immediately, re-show after dismissal once the cooldown elapses.
  useEffect(() => {
    if (!enabled || decision) return;
    const cooldownMs = (cfg.cooldown ?? 10) * 1000;
    const tick = window.setInterval(() => {
      if (Date.now() - lastShownAt.current < cooldownMs) return;
      const d = pickAdZone("sticky");
      if (!d.zoneId) return;
      window.clearInterval(tick);
      lastShownAt.current = Date.now();
      setDecision({ network: d.network, zoneId: d.zoneId, fallback: d.fallback ?? null });
    }, 1500);
    return () => window.clearInterval(tick);
  }, [enabled, decision, cfg.cooldown]);

  // Re-arm when the user closes the bar. ExoClick signals a real dismissal
  // with a `zone-closed-{idzone}` cookie; TrafficStars has no such cookie —
  // its spot close hides or removes the injected creative instead. In both
  // cases wait out the close animation before unmounting.
  useEffect(() => {
    if (!shown || !ownsZone) return;
    const el = stickyRef.current;
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
    trackAdImpression(shown.zoneId, "sticky", "sticky");
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

  return (
    <div
      ref={stickyRef}
      className="pointer-events-none fixed left-2 top-[20%] z-[100] w-[calc(100vw-1rem)] max-w-[970px] -translate-y-1/2 md:left-4 md:w-[calc(100vw-2rem)]"
    >
      <div className="pointer-events-auto flex min-h-[50px] w-full items-center justify-center overflow-hidden text-center">
        {shown.network === "trafficstars" ? (
          <TrafficStarsSpot
            spot={shown.zoneId}
            className="mx-auto block max-w-full"
            style={{ width: "100%", minHeight: 50 }}
          />
        ) : (
          <ins
            className="eas6a97888e10 mx-auto block max-w-full"
            data-zoneid={shown.zoneId}
            style={{ width: "100%", minHeight: 50 }}
          />
        )}
      </div>
    </div>
  );
}