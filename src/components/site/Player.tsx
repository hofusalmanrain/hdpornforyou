import { Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type Video } from "@/data/videos";
import {
  adSettings,
  getAds,
  hydrateAds,
  pickVastTag,
  pickVastFallbackTag,
  isFluidPlayerEnabled,
  type VastRoll,
} from "@/lib/ads-config";

declare global {
  interface Window {
    fluidPlayer?: (
      id: string,
      opts: Record<string, unknown>,
    ) => {
      destroy?: () => void;
    };
  }
}

function parseDurationSeconds(d: string): number {
  if (!d || d === "LIVE") return 0;
  const parts = d.split(":").map(Number);
  if (parts.some(isNaN)) return 0;
  let s = 0;
  for (const p of parts) s = s * 60 + p;
  return s;
}

/** Block until the FluidPlayer script is loaded (it is added globally by <AdProvider />). */
function whenFluid(cb: () => void) {
  if (window.fluidPlayer) return cb();
  let cleared = false;
  const t = setInterval(() => {
    if (cleared) return;
    if (window.fluidPlayer) {
      cleared = true;
      clearInterval(t);
      cb();
    }
  }, 100);
  const timeout = window.setTimeout(() => {
    if (!cleared) {
      cleared = true;
      clearInterval(t);
    }
  }, 8000);
  return () => {
    cleared = true;
    clearInterval(t);
    window.clearTimeout(timeout);
  };
}

interface VastOverlayProps {
  vastUrl: string;
  /** Network the primary tag was routed to (for the one-shot passback). */
  network?: "exoclick" | "trafficstars" | null;
  roll: VastRoll;
  onDone: () => void;
}

function VastOverlay({ vastUrl, network, roll, onDone }: VastOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  // Current tag starts as the routed one; on a no-fill we pass back to the
  // other network's tag exactly once (standard publisher passback — both
  // providers support it; tags stay unmodified).
  const [tag, setTag] = useState(vastUrl);
  const [currentNetwork, setCurrentNetwork] = useState<"exoclick" | "trafficstars" | null>(
    network ?? null,
  );
  const [retried, setRetried] = useState(false);
  useEffect(() => {
    setTag(vastUrl);
    setCurrentNetwork(network ?? null);
    setRetried(false);
  }, [vastUrl, network]);
  useEffect(() => {
    if (!tag) {
      onDoneRef.current();
      return;
    }
    const container = containerRef.current;
    if (!container) {
      onDoneRef.current();
      return;
    }
    let inst: ReturnType<NonNullable<Window["fluidPlayer"]>> | undefined;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onDoneRef.current();
    };
    const noScriptFallback = window.setTimeout(() => {
      if (!window.fluidPlayer) finish();
    }, 12000);

    const handleNoFill = () => {
      if (!retried && currentNetwork) {
        const fb = pickVastFallbackTag(roll, currentNetwork);
        if (fb.tag && fb.tag !== tag) {
          setRetried(true);
          setCurrentNetwork(fb.network);
          setTag(fb.tag);
          return; // effect re-runs with the fallback tag (fresh grace period)
        }
      }
      finish();
    };

    const initPlayer = () => {
      window.clearTimeout(noScriptFallback);
      const vid = document.createElement("video");
      vid.id = `fp-${Math.random().toString(36).slice(2, 10)}`;
      vid.className = "h-full w-full";
      vid.setAttribute("playsinline", "");
      vid.setAttribute("autoplay", "");
      vid.setAttribute("muted", "");
      vid.setAttribute("controls", "");
      container.appendChild(vid);
      try {
        inst = window.fluidPlayer!(vid.id, {
          layoutControls: {
            autoPlay: true,
            mute: true,
            allowDownload: false,
            playButtonShowing: false,
            playPauseAnimation: false,
            fillToContainer: true,
            posterImage: "",
            primaryColor: "#7c3aed",
          },
          vastOptions: {
            adList: [{ roll: "preRoll", vastTag: tag }],
            adClickable: true,
            showProgressbarMarkers: false,
            adCTAText: false,
            adCTATextPosition: "bottom right",
            vastTimeout: 8000,
            vastAdvanced: {
              vastLoadedCallback: () => {},
              noVastVideoCallback: handleNoFill,
              vastVideoSkippedCallback: finish,
              vastVideoEndedCallback: finish,
            },
          },
        });
      } catch {
        finish();
      }
    };

    const cancelWhenFluid = whenFluid(initPlayer);
    return () => {
      cancelWhenFluid?.();
      window.clearTimeout(noScriptFallback);
      try {
        inst?.destroy?.();
      } catch {
        /* noop */
      }
      while (container.firstChild) container.removeChild(container.firstChild);
    };
  }, [tag, retried, currentNetwork, roll]);

  return (
    <div className="absolute inset-0 z-30 bg-black flex items-center justify-center">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}

export function Player({ video }: { video: Video }) {
  const fluidInitiallyEnabled = isFluidPlayerEnabled();
  const [phase, setPhase] = useState<
    "idle" | "preroll" | "playing" | "midroll" | "postroll" | "ended"
  >(fluidInitiallyEnabled ? "idle" : "playing");

  // Reset to idle when navigating to a different video (SPA route reuse).
  const prevEmbedUrl = useRef(video.embedUrl);
  useEffect(() => {
    if (video.embedUrl !== prevEmbedUrl.current) {
      prevEmbedUrl.current = video.embedUrl;
      setPhase(fluidInitiallyEnabled ? "idle" : "playing");
    }
  }, [video.embedUrl, fluidInitiallyEnabled]);

  const durationSec = parseDurationSeconds(video.duration);
  const longEnough = durationSec >= adSettings.midrollMinDurationSeconds;

  // Re-render when ads settings change so VAST + FluidPlayer toggles apply live.
  const [, force] = useState(0);
  useEffect(() => {
    const sync = () => force((n) => n + 1);
    window.addEventListener("hdpornforyou:ads-changed", sync);
    return () => window.removeEventListener("hdpornforyou:ads-changed", sync);
  }, []);

  const fluidEnabled = isFluidPlayerEnabled();

  const vastEligible = (overrideFluid?: boolean) => {
    const fluid = overrideFluid !== undefined ? overrideFluid : fluidEnabled;
    if (!fluid) return false;
    const ads = getAds().vast;
    if (!ads.enabled) return false;
    if (typeof window !== "undefined") {
      const isMobile = window.matchMedia("(max-width: 768px)").matches;
      if (ads.deviceTarget === "desktop" && isMobile) return false;
      if (ads.deviceTarget === "mobile" && !isMobile) return false;
    }
    return true;
  };

  const prerollPick = vastEligible() ? pickVastTag("preroll") : null;
  const prerollTag = prerollPick?.tag ?? "";
  const midrollPick = vastEligible() ? pickVastTag("midroll") : null;
  const midrollTag = midrollPick?.tag ?? "";
  const postrollPick = vastEligible() ? pickVastTag("postroll") : null;
  const postrollTag = postrollPick?.tag ?? "";

  // schedule mid/post rolls once the iframe is playing
  useEffect(() => {
    if (phase !== "playing") return;
    if (!fluidEnabled) return;
    const timers: number[] = [];
    if (longEnough && midrollTag && vastEligible()) {
      timers.push(
        window.setTimeout(() => setPhase("midroll"), adSettings.midrollAfterSeconds * 1000),
      );
    }
    if (
      longEnough &&
      postrollTag &&
      adSettings.enablePostroll &&
      vastEligible() &&
      durationSec > 0
    ) {
      timers.push(
        window.setTimeout(() => setPhase("postroll"), Math.max(0, durationSec - 8) * 1000),
      );
    }
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, longEnough, durationSec, fluidEnabled, midrollTag, postrollTag]);

  const [loadingAd, setLoadingAd] = useState(false);

  // Pre-hydrate config + FluidPlayer script so the first click never races them.
  useEffect(() => {
    hydrateAds().catch(() => {});
  }, []);

  // When FluidPlayer is OFF, auto-start playing on mount so the embed iframe
  // loads directly and plays from inside the embed — no separate play button.
  useEffect(() => {
    if (!fluidEnabled && phase === "idle") setPhase("playing");
  }, [fluidEnabled, phase]);

  const start = async () => {
    setLoadingAd(true);
    try {
      await hydrateAds().catch(() => {});
      const freshFluid = isFluidPlayerEnabled();
      const freshEligible = vastEligible(freshFluid);
      const freshTag = freshEligible ? pickVastTag("preroll").tag : "";
      if (adSettings.enablePreroll && freshTag && freshEligible) {
        setPhase("preroll");
      } else {
        setPhase("playing");
      }
    } finally {
      setLoadingAd(false);
    }
  };

  // Admin-controlled player size override. Falls back to the natural
  // 16:9 aspect when admin leaves the values at 0.
  const ps = getAds().player;
  const isMobileNow =
    typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches;
  const pW = isMobileNow ? (ps?.widthMobile ?? 0) : (ps?.widthDesktop ?? 0);
  const pH = isMobileNow ? (ps?.heightMobile ?? 0) : (ps?.heightDesktop ?? 0);
  const useCustomSize = pW > 0 && pH > 0;

  return (
    <div
      className={
        useCustomSize
          ? "relative mx-auto overflow-hidden rounded-2xl bg-black shadow-glow w-full"
          : "relative w-full aspect-video overflow-hidden rounded-2xl bg-black shadow-glow"
      }
      style={useCustomSize ? { maxWidth: pW, aspectRatio: `${pW} / ${pH}` } : undefined}
    >
      {/* Ambient glow */}
      <div
        className="absolute -inset-8 -z-10 blur-3xl opacity-50"
        style={{ backgroundImage: `url(${video.thumbnail})`, backgroundSize: "cover" }}
      />

      {phase === "idle" && (
        <button
          type="button"
          onClick={start}
          className="group absolute inset-0 w-full h-full"
          aria-label={`Play ${video.title}`}
        >
          <img
            src={video.thumbnail}
            alt={video.title}
            width={1280}
            height={720}
            loading="eager"
            decoding="async"
            fetchPriority="high"
            className="absolute inset-0 h-full w-full object-cover"
            onError={(e) => {
              const t = e.currentTarget;
              if (!t.src.includes("hqdefault"))
                t.src = video.thumbnail.replace("maxresdefault", "hqdefault");
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-black/40" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className={`h-20 w-20 md:h-24 md:w-24 rounded-full gradient-primary flex items-center justify-center shadow-glow animate-pulse-glow group-hover:scale-110 transition-transform ${loadingAd ? "opacity-70" : ""}`}
            >
              {loadingAd ? (
                <div className="h-8 w-8 rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground animate-spin" />
              ) : (
                <Play className="h-9 w-9 md:h-10 md:w-10 text-primary-foreground fill-current ml-1" />
              )}
            </div>
          </div>
        </button>
      )}

      {(phase === "playing" ||
        phase === "ended" ||
        phase === "midroll" ||
        phase === "postroll") && (
        <iframe
          src={`${video.embedUrl}?autoplay=1&rel=0`}
          title={video.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          loading="eager"
          className={`absolute inset-0 h-full w-full ${phase === "midroll" || phase === "postroll" ? "invisible" : ""}`}
        />
      )}

      {phase === "preroll" && (
        <VastOverlay
          vastUrl={prerollTag}
          network={prerollPick?.network ?? null}
          roll="preroll"
          onDone={() => setPhase("playing")}
        />
      )}
      {phase === "midroll" && (
        <VastOverlay
          vastUrl={midrollTag}
          network={midrollPick?.network ?? null}
          roll="midroll"
          onDone={() => setPhase("playing")}
        />
      )}
      {phase === "postroll" && (
        <VastOverlay
          vastUrl={postrollTag}
          network={postrollPick?.network ?? null}
          roll="postroll"
          onDone={() => setPhase("idle")}
        />
      )}
    </div>
  );
}
