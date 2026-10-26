import { useEffect } from "react";
import { getAds, hasAdConsent, COOKIE_CONSENT_EVENT } from "@/lib/ads-config";
import { reportScriptState } from "@/lib/ad-script-state";
import type { Network } from "@/lib/ad-router";

/**
 * Globally loads:
 * - ExoClick ad-provider script (for <ins class="eas..." /> banner/native zones)
 * - TrafficStars master.spot.js (loaded only when TrafficStars is enabled)
 * - FluidPlayer JS (for VAST pre/mid/post-roll on the watch page; CSS is bundled)
 *
 * GDPR/ePrivacy: nothing loads until the visitor accepts cookie consent.
 * Accepting later (COOKIE_CONSENT_EVENT) triggers the load.
 */
export function AdProvider() {
  useEffect(() => {
    const loadAll = () => {
      addScript(
        "exoclick-ad-provider",
        "https://a.magsrv.com/ad-provider.js",
        "exoclick",
        true,
      );
      addScript("fluidplayer-js", "https://cdn.fluidplayer.com/v3/current/fluidplayer.min.js");

      try {
        const ts = getAds().trafficstars;
        if (ts?.enabled) {
          addScript("trafficstars-spot", "https://cdn.tsyndicate.com/sdk/v1/master.spot.js", "trafficstars");
        }
      } catch {
        /* noop */
      }
    };

    if (hasAdConsent()) {
      loadAll();
      return undefined;
    }

    const onConsent = () => {
      if (hasAdConsent()) loadAll();
    };
    window.addEventListener(COOKIE_CONSENT_EVENT, onConsent);
    return () => window.removeEventListener(COOKIE_CONSENT_EVENT, onConsent);
  }, []);
  return null;
}

/**
 * network is optional (FluidPlayer is not an ad network). On error the state
 * is recorded so slots can passback/hide gracefully instead of waiting out
 * the rescue timer. We never retry or bypass — browser blocking must win.
 */
function addScript(id: string, src: string, network?: Network, highPriority = false) {
  if (document.getElementById(id)) return;
  const s = document.createElement("script");
  s.id = id;
  s.async = true;
  if (highPriority) s.fetchPriority = "high";
  s.onload = () => {
    if (network) reportScriptState(network, "loaded");
  };
  s.onerror = () => {
    if (network) reportScriptState(network, "failed");
  };
  s.src = src;
  // Head = discovered earlier than body-appended scripts.
  (document.head || document.body).appendChild(s);
}
