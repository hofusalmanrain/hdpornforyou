import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { X } from "lucide-react";
import {
  ADS_EVENT,
  canShowAd,
  getAds,
  getPlacementFrequencyCap,
  hasAdConsent,
  matchesDevice,
  trackAdImpression,
} from "@/lib/ads-config";
import { pickAdZone, type Network } from "@/lib/ad-router";
import { TrafficStarsSpot } from "./TrafficStarsSpot";
import { useAdRescue } from "@/hooks/use-ad-rescue";
import { useAdZoneClaim } from "@/hooks/use-ad-zone-claim";

/**
 * Full-page interstitial controller.
 *
 * Triggering rules (PHASE 4):
 *  - NEVER on first load.
 *  - NEVER on the homepage.
 *  - Triggers on:
 *      • route changes (when mounted as part of a non-home route)
 *      • video-to-video navigation (component remounts per slug)
 *      • engagement milestones (admin schedule, seconds since mount)
 *  - Cooldown: desktop default 180s, mobile default 240s.
 *  - Frequency cap: 2–3 per session (admin controlled).
 *  - Network: AdRouter (TrafficStars priority on Tier-1, ExoClick otherwise).
 *
 * The "first ever video open" is allowed to fire after the cooldown via
 * a milestone — never instantly.
 */
// Session-level mount counter — survives remounts so video-to-video
// navigation is recognised as a route change while the very first mount
// of the session is still treated as "first load".
let SESSION_MOUNTS = 0;
let LAST_SHOWN_AT = 0;

const AUTO_CLOSE_MS = 10_000;
const CLOSE_REVEAL_MS = 5_000;
const CLOSE_REVEAL_SECONDS = CLOSE_REVEAL_MS / 1000;

export function InterstitialController() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [closeIn, setCloseIn] = useState(CLOSE_REVEAL_SECONDS);
  const [decision, setDecision] = useState<{
    network: Network;
    zoneId: string;
    fallback: { network: Network; zoneId: string } | null;
  } | null>(null);
  const startedAt = useRef<number>(Date.now());
  const firedMilestones = useRef<Set<number>>(new Set());
  const isFirstMount = useRef<boolean>(false);
  const creativeRef = useRef<HTMLDivElement>(null);

  // Render-time rescue: chosen network never fills → swap to fallback.
  const ownsZone = useAdZoneClaim(
    decision ? { network: decision.network, zoneId: decision.zoneId } : null,
  );
  const shown = useAdRescue(
    creativeRef,
    open && !!decision && ownsZone,
    decision,
    decision?.fallback ?? null,
  );

  useEffect(() => {
    startedAt.current = Date.now();
    firedMilestones.current = new Set();
    SESSION_MOUNTS += 1;
    isFirstMount.current = SESSION_MOUNTS === 1;
  }, [pathname]);

  useEffect(() => {
    setOpen(false);
    setDecision(null);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const watchdog = window.setTimeout(() => {
      const hasCreative = document.querySelector(
        "[data-interstitial-creative] iframe, [data-interstitial-creative] video",
      );
      if (!hasCreative) {
        setOpen(false);
        setDecision(null);
      }
    }, 12_000);
    return () => window.clearTimeout(watchdog);
  }, [open]);

  useEffect(() => {
    if (!open || !shown) return;
    // Network policy: interstitials must be dismissible — hard auto-close
    // guarantees the visitor is never trapped even without clicking the X.
    const autoClose = window.setTimeout(() => {
      setOpen(false);
      setDecision(null);
    }, AUTO_CLOSE_MS);
    return () => window.clearTimeout(autoClose);
  }, [open, shown]);

  const [, force] = useState(0);
  const [closeReady, setCloseReady] = useState(false);
  useEffect(() => {
    if (!open) {
      setCloseReady(false);
      setCloseIn(CLOSE_REVEAL_SECONDS);
      return;
    }
    // Show a countdown in the exact spot where the publisher ✕ will appear.
    // Once the button is available, the countdown disappears for good.
    const revealAt = Date.now() + CLOSE_REVEAL_MS;
    setCloseIn(CLOSE_REVEAL_SECONDS);
    const countdown = window.setInterval(() => {
      setCloseIn(Math.max(1, Math.ceil((revealAt - Date.now()) / 1000)));
    }, 250);
    const reveal = window.setTimeout(() => {
      setCloseReady(true);
      setCloseIn(0);
    }, CLOSE_REVEAL_MS);
    return () => {
      window.clearInterval(countdown);
      window.clearTimeout(reveal);
    };
  }, [open]);
  useEffect(() => {
    const sync = () => force((n) => n + 1);
    window.addEventListener(ADS_EVENT, sync);
    return () => window.removeEventListener(ADS_EVENT, sync);
  }, []);

  const cfg = getAds().interstitial;
  const isMobile =
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 768px)").matches;
  const isHomepage = pathname === "/" || pathname === "";
  const cooldownSec =
    (isMobile ? cfg.cooldownMobile : cfg.cooldownDesktop) ||
    cfg.cooldown ||
    (isMobile ? 240 : 180);
  const eligible =
    cfg.enabled && matchesDevice(cfg.deviceTarget) && !isHomepage;

  const show = (reason: string) => {
    if (!hasAdConsent()) return;
    if (!eligible) return;
    if (
      !canShowAd(
        "interstitial",
        getPlacementFrequencyCap("interstitial", cfg.frequencyCap),
      )
    )
      return;
    const now = Date.now();
    if (now - LAST_SHOWN_AT < cooldownSec * 1000) return;
    const d = pickAdZone("interstitial");
    if (!d.zoneId) return;
    LAST_SHOWN_AT = now;
    setDecision({
      network: d.network,
      zoneId: d.zoneId,
      fallback: d.fallback ?? null,
    });
    trackAdImpression(d.zoneId, "interstitial", "interstitial");
    setOpen(true);

    console.debug(
      "[interstitial] shown",
      reason,
      "network",
      d.network,
      "zone",
      d.zoneId,
    );
  };

  // Route-change / video-to-video trigger.
  // Only fires from the 2nd mount onwards (never on first load), and
  // never on the homepage. Cooldown still applies.
  useEffect(() => {
    if (!eligible) return;
    if (!cfg.triggerOnRouteChange) return;
    if (isFirstMount.current) return; // first load — skip
    const t = setTimeout(() => show("route-change"), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, cfg.triggerOnRouteChange, pathname]);

  useEffect(() => {
    if (!eligible || !cfg.showOnOpen || !pathname.startsWith("/watch")) return;
    const timer = window.setTimeout(() => show("video-open"), 600);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, cfg.showOnOpen, pathname]);

  // Milestone ticker.
  useEffect(() => {
    if (!eligible || !cfg.schedule.length) return;
    const tick = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt.current) / 1000);
      for (const m of cfg.schedule) {
        if (elapsed >= m && !firedMilestones.current.has(m)) {
          firedMilestones.current.add(m);
          show(`milestone:${m}s`);
          break;
        }
      }
    }, 5000);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, JSON.stringify(cfg.schedule)]);

  // Push ExoClick provider when modal opens with EC creative.
  useEffect(() => {
    if (!open || !shown || !ownsZone) return;
    try {
      if (shown.network === "exoclick") {
        window.AdProvider = window.AdProvider || [];
        window.AdProvider.push({ serve: {} });
      }
    } catch {
      /* silent */
    }
  }, [open, shown, ownsZone]);

  if (!open || !shown || !ownsZone) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[200] flex items-center justify-center overflow-y-auto bg-black/70 backdrop-blur-2xl supports-[backdrop-filter]:bg-black/60 p-2 sm:p-4">
      {closeReady ? (
        <button
          type="button"
          aria-label="Close ad"
          onClick={() => {
            setOpen(false);
            setDecision(null);
          }}
          className="pointer-events-auto fixed right-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.75rem,env(safe-area-inset-top))] z-[110] flex h-10 w-10 items-center justify-center rounded-full glass border border-border/60 bg-background/80 text-foreground shadow-lg transition hover:bg-background sm:right-[max(1.25rem,env(safe-area-inset-right))] sm:top-[max(1.25rem,env(safe-area-inset-top))]"
        >
          <X className="h-5 w-5" />
        </button>
      ) : (
        <div
          role="timer"
          aria-live="off"
          aria-label={`Close button appears in ${closeIn} seconds`}
          className="pointer-events-none fixed right-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.75rem,env(safe-area-inset-top))] z-[110] flex h-10 w-10 items-center justify-center rounded-full glass border border-border/60 bg-background/80 text-xs font-semibold tabular-nums text-foreground shadow-lg sm:right-[max(1.25rem,env(safe-area-inset-right))] sm:top-[max(1.25rem,env(safe-area-inset-top))]"
        >
          {closeIn}s
        </div>
      )}
      <div
        data-interstitial-creative
        ref={creativeRef}
        className="pointer-events-auto flex max-h-[calc(100dvh-1rem)] max-w-full items-center justify-center overflow-auto sm:max-h-[calc(100dvh-2rem)]"
      >
        {shown.network === "trafficstars" ? (
          <TrafficStarsSpot
            spot={shown.zoneId}
            className="mx-auto block max-w-full"
            style={{ display: "block", width: "100%" }}
          />
        ) : (
          <ins
            className="eas6a97888e10 mx-auto block max-w-full"
            data-zoneid={shown.zoneId}
            style={{ display: "block", width: "100%" }}
          />
        )}
      </div>
    </div>
  );
}
