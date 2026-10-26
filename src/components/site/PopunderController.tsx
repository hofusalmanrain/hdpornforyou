import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { ADS_EVENT, canShowAd, getAds, hasAdConsent, matchesDevice, trackAdImpression } from "@/lib/ads-config";
import { detectDevice, getNetworkPolicy } from "@/lib/ad-router";

/**
 * Global popunder controller.
 * - Page-gated via admin (home / trending / explore / search / account / watch).
 * - Geo logic: Tier-1 → TrafficStars snippet, Tier-2/3 → ExoClick snippet.
 *   Force flags (router.forceExoEverywhere / forceTSEverywhere) override.
 * - Frequency cap per session + cooldown between pops.
 * - Injection happens on first qualifying user click, not on page load.
 */
function pageKey(pathname: string): keyof ReturnType<typeof getAds>["popunder"]["pages"] | null {
  if (pathname === "/" || pathname === "") return "home";
  if (pathname.startsWith("/trending")) return "trending";
  if (pathname.startsWith("/explore")) return "explore";
  if (pathname.startsWith("/latest")) return "latest";
  if (pathname.startsWith("/search")) return "search";
  if (pathname.startsWith("/tags/")) return "tags";
  if (pathname.startsWith("/category/")) return "category";
  if (pathname.startsWith("/watch")) return "watch";
  if (pathname.startsWith("/account")) return "account";
  return null;
}

let lastPopAt = 0;

export function PopunderController() {
  const { pathname } = useLocation();
  const [settingsVersion, setSettingsVersion] = useState(0);

  // Re-render on settings change.
  useEffect(() => {
    const sync = () => setSettingsVersion((n) => n + 1);
    window.addEventListener(ADS_EVENT, sync);
    return () => window.removeEventListener(ADS_EVENT, sync);
  }, []);

  useEffect(() => {
    const ads = getAds();
    const pu = ads.popunder;
    if (!pu?.enabled) return;
    if (!matchesDevice(pu.deviceTarget)) return;

    const key = pageKey(pathname);
    if (!key || !pu.pages[key]) return;

    const device = detectDevice();
    const exoclickSnippet = pu.exoclick?.[device] || pu.exoclickSnippet || "";
    const trafficstarsSnippet = ads.trafficstars.enabled
      ? pu.trafficstars?.[device] || pu.trafficstarsSnippet || ""
      : "";
    const policy = getNetworkPolicy();
    const preferredSnippet =
      policy.preferred === "trafficstars" ? trafficstarsSnippet : exoclickSnippet;
    const fallbackSnippet =
      policy.preferred === "trafficstars" ? exoclickSnippet : trafficstarsSnippet;
    const snippet = preferredSnippet || (policy.forced ? "" : fallbackSnippet);
    const net = preferredSnippet
      ? policy.preferred
      : policy.preferred === "trafficstars"
        ? "exoclick"
        : "trafficstars";
    if (!snippet) return;

    const fire = () => {
      if (!hasAdConsent()) return;
      if (!canShowAd("popunder", pu.frequencyCap)) return;
      const now = Date.now();
      if (now - lastPopAt < (pu.cooldown || 1800) * 1000) return;
      lastPopAt = now;
      try {
        const host = document.createElement("div");
        host.setAttribute("data-popunder-net", net);
        host.style.display = "none";
        host.innerHTML = snippet;
        document.body.appendChild(host);
        // Re-run any inline <script> elements (innerHTML doesn't execute them).
        host.querySelectorAll("script").forEach((s) => {
          const n = document.createElement("script");
          for (const a of Array.from(s.attributes)) n.setAttribute(a.name, a.value);
          n.text = s.text;
          s.parentNode?.replaceChild(n, s);
        });
        trackAdImpression("popunder", net);
      } catch {
        /* noop */
      }
    };

    const onClick = () => fire();
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [pathname, settingsVersion]);

  return null;
}
