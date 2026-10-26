import { useEffect } from "react";
import { ADS_EVENT, canShowAd, getAds, hasAdConsent, matchesDevice, trackAdImpression } from "@/lib/ads-config";
import { detectDevice, getNetworkPolicy } from "@/lib/ad-router";

export function PushController() {
  useEffect(() => {
    let host: HTMLDivElement | null = null;

    const inject = () => {
      const cfg = getAds().push;
      const device = detectDevice();
      if (
        !hasAdConsent() ||
        !cfg?.enabled ||
        !matchesDevice(cfg.deviceTarget) ||
        !canShowAd("push", cfg.frequencyCap)
      ) {
        host?.remove();
        host = null;
        return;
      }
      const ads = getAds();
      const exoclickSnippet = cfg.exoclick?.[device] || cfg.snippet || "";
      const trafficstarsSnippet = ads.trafficstars.enabled ? cfg.trafficstars?.[device] || "" : "";
      const policy = getNetworkPolicy();
      const preferredSnippet =
        policy.preferred === "trafficstars" ? trafficstarsSnippet : exoclickSnippet;
      const fallbackSnippet =
        policy.preferred === "trafficstars" ? exoclickSnippet : trafficstarsSnippet;
      const snippet = preferredSnippet || (policy.forced ? "" : fallbackSnippet);
      const network = preferredSnippet
        ? policy.preferred
        : policy.preferred === "trafficstars"
          ? "exoclick"
          : "trafficstars";
      if (!snippet.trim()) {
        host?.remove();
        host = null;
        return;
      }
      if (host?.dataset.snippet === snippet) return;

      host?.remove();
      host = document.createElement("div");
      host.dataset.snippet = snippet;
      host.style.display = "none";
      host.innerHTML = snippet;
      document.body.appendChild(host);

      host.querySelectorAll("script").forEach((s) => {
        const n = document.createElement("script");
        for (const a of Array.from(s.attributes)) n.setAttribute(a.name, a.value);
        n.text = s.text;
        s.parentNode?.replaceChild(n, s);
      });
      trackAdImpression(`push:${device}:${network}`, "push", "push");
    };

    inject();
    window.addEventListener(ADS_EVENT, inject);
    return () => {
      window.removeEventListener(ADS_EVENT, inject);
      host?.remove();
    };
  }, []);

  return null;
}
