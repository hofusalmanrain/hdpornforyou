import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  canShowAd,
  getAds,
  getPlacementFrequencyCap,
  matchesDevice,
  trackAdImpression,
} from "@/lib/ads-config";
import { pickAdZone, meetsEngagement, type Network, type Placement } from "@/lib/ad-router";
import { TrafficStarsSpot } from "./TrafficStarsSpot";
import { useAdRescue } from "@/hooks/use-ad-rescue";
import { useAdZoneClaim } from "@/hooks/use-ad-zone-claim";

const DESKTOP_OUTSTREAM_HEIGHT_SCALE = 0.8;



/**
 * OutstreamAd — the PRIMARY watch-page monetisation unit (replaces the
 * old under-player banner).
 *
 * Rules:
 *  - IntersectionObserver based, never loads off-screen.
 *  - Engagement-gated: only triggers once the user scrolls past
 *    `scrollThreshold` OR stays on the page longer than `engagementDelay`.
 *  - Strict duplicate-request prevention (one push per mount).
 *  - Frequency capped per session.
 *  - No layout shift: reserves the slot size before the ad arrives.
 *  - Never blocks content rendering.
 *
 * Network routing (via AdRouter):
 *  - Tier-1 → TrafficStars NATIVE VIDEO creative (NOT IM Slider)
 *  - Tier-2/3 → ExoClick Outstream Video
 */
export interface OutstreamAdProps {
  placement?: Placement;
  className?: string;
  framed?: boolean;
  fillParent?: boolean;
  feed?: boolean;
  sidebar?: boolean;
}

export function OutstreamAd({
  placement = "watchOutstream",
  className = "",
  framed = true,
  fillParent = false,
  feed = false,
  sidebar = false,
}: OutstreamAdProps) {
  const ref = useRef<HTMLDivElement>(null);
  const fired = useRef(false);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia("(max-width: 768px)").matches,
  );
  const [visible, setVisible] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [decision, setDecision] = useState<{
    network: Network;
    zoneId: string;
    fallback: { network: Network; zoneId: string } | null;
  } | null>(null);

  // Recompute on settings change.
  const [, force] = useState(0);
  useEffect(() => {
    const sync = () => force((n) => n + 1);
    window.addEventListener("hdpornforyou:ads-changed", sync);
    return () => window.removeEventListener("hdpornforyou:ads-changed", sync);
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const media = window.matchMedia("(max-width: 768px)");
    const syncDevice = () => setIsMobile(media.matches);
    const syncWidth = () => {
      const nextWidth = el.clientWidth;
      setAvailableWidth((current) => (current === nextWidth ? current : nextWidth));
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(syncWidth);
    syncDevice();
    syncWidth();
    media.addEventListener("change", syncDevice);
    observer?.observe(el);
    window.addEventListener("resize", syncWidth, { passive: true });
    return () => {
      media.removeEventListener("change", syncDevice);
      observer?.disconnect();
      window.removeEventListener("resize", syncWidth);
    };
  }, []);

  const ads = getAds();
  const cfg = ads.outstream;
  const sidebarEnabled =
    !sidebar ||
    (cfg.sidebarEnabled !== false &&
      (isMobile ? cfg.sidebarMobile !== false : cfg.sidebarDesktop !== false));
  const deviceEnabled = sidebar || matchesDevice(cfg.deviceTarget);
  const enabled = cfg.enabled && sidebarEnabled && deviceEnabled;

  // IntersectionObserver to detect visibility.
  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
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
      { rootMargin: "100px 0px", threshold: 0.25 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [enabled]);

  // Engagement gate (scroll OR time on page). Applies to every placement,
  // including the watch page.
  useEffect(() => {
    if (!enabled || !visible || shouldLoad) return;
    const threshold = cfg.scrollThreshold ?? 0.25;
    const delay = (cfg.engagementDelay ?? 6) * 1000;
    const interval = window.setInterval(() => {
      if (meetsEngagement(threshold, Math.floor(delay / 1000))) {
        setShouldLoad(true);
        window.clearInterval(interval);
      }
    }, 1000);
    const hardTimer = window.setTimeout(() => setShouldLoad(true), delay);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(hardTimer);
    };
  }, [enabled, visible, shouldLoad, cfg.scrollThreshold, cfg.engagementDelay]);

  // Pick network when about to load.
  useEffect(() => {
    if (!shouldLoad || decision) return;
    if (!canShowAd(placement, getPlacementFrequencyCap(placement, cfg.frequencyCap))) return;
    const d = pickAdZone(placement);
    if (!d.zoneId) return;
    setDecision({ network: d.network, zoneId: d.zoneId, fallback: d.fallback ?? null });
  }, [shouldLoad, decision, placement, cfg.frequencyCap]);

  // Render-time rescue: chosen network never fills → swap to fallback.
  const ownsZone = useAdZoneClaim(
    decision ? { network: decision.network, zoneId: decision.zoneId } : null,
  );
  const shown = useAdRescue(
    ref,
    !!decision && ownsZone,
    decision,
    decision?.fallback ?? null,
  );

  // Re-track when rescue swaps the creative to the other network.
  useEffect(() => {
    fired.current = false;
  }, [shown?.network, shown?.zoneId]);

  // Fire impression + provider push exactly once.
  useEffect(() => {
    if (!shown || !ownsZone || fired.current) return;
    fired.current = true;
    trackAdImpression(shown.zoneId, "outstream", placement);
    try {
      if (shown.network === "exoclick") {
        window.AdProvider = window.AdProvider || [];
        window.AdProvider.push({ serve: {} });
      }
      // TrafficStars master.spot.js auto-serves on <ins data-id>.
    } catch {
      /* silent */
    }
  }, [shown, ownsZone, placement]);

  if (!enabled) return null;

  // Another slot already owns this zone: hide before painting a second
  // creative. The wrapper is still rendered until the decision exists so
  // the IntersectionObserver can measure and trigger this slot.
  if (decision && !ownsZone) return null;

  const configuredWidth = Math.max(
    1,
    isMobile ? (cfg.widthMobile ?? 340) : (cfg.widthDesktop ?? 640),
  );
  const configuredHeight = Math.max(
    1,
    isMobile ? (cfg.heightMobile ?? 191) : (cfg.heightDesktop ?? 360),
  );
  const ratioWidth = Math.max(1, availableWidth || configuredWidth);
  const ratioHeight = (ratioWidth / configuredWidth) * configuredHeight;
  // Only desktop sidebar + related get the fixed-height fix.
  // Other desktop outstreams keep the compact 0.8 scale; mobile unchanged.
  const isTargetDesktop = !isMobile && (sidebar || placement === "watchSidebarOutstream" || placement === "relatedOutstream");
  const compactDesktop = !isMobile && !isTargetDesktop;
  const height = Math.max(
    1,
    Math.round(isTargetDesktop ? ratioHeight : compactDesktop ? ratioHeight * DESKTOP_OUTSTREAM_HEIGHT_SCALE : ratioHeight),
  );

  return (
    <div
      ref={ref}
      className={`relative flex min-w-0 max-w-full w-full self-start justify-center overflow-hidden ${compactDesktop ? "outstream-desktop-compact" : ""} ${framed ? "rounded-xl border border-border bg-secondary/40" : ""} ${className}`}
      style={{ "--outstream-height": `${height}px` } as React.CSSProperties}
    >
      {framed && (
        <p className="pointer-events-none absolute left-2 top-1 z-10 text-[10px] uppercase tracking-widest text-muted-foreground">
          Sponsored
        </p>
      )}
      <div
        className="outstream-creative relative h-full shrink-0 overflow-hidden"
        style={{
          width: ratioWidth,
          height,
          maxHeight: height,
          aspectRatio: isTargetDesktop ? `${configuredWidth} / ${configuredHeight}` : compactDesktop ? "auto" : `${configuredWidth} / ${configuredHeight}`,
        }}
      >
        {shown ? (
          shown.network === "trafficstars" ? (
            <TrafficStarsSpot
              spot={shown.zoneId}
              className="block max-w-full"
              style={{ width: "100%", height: "100%" }}
            />
          ) : (
            <ins
              className="eas6a97888e10 block max-w-full"
              data-zoneid={shown.zoneId}
              style={{ width: "100%", height: "100%" }}
            />
          )
        ) : null}
      </div>
    </div>
  );
}
