import { useEffect, useState } from "react";
import type { Network } from "@/lib/ad-router";
import { isProviderFailed } from "@/lib/ad-script-state";

export interface AdRescueDecision {
  network: Network;
  zoneId: string;
}

// One-shot console diagnostics (per page load) so operators can see WHY a
// slot is empty: browser content blocking vs. no-fill from the provider.
const diagSeen = new Set<string>();
function diag(key: string, message: string) {
  if (diagSeen.has(key)) return;
  diagSeen.add(key);
  console.info(`[ads] ${message}`);
}

// Native creatives are <div>-based: no <iframe>, <img> or <ins> content to
// detect. ExoClick uses .exo-native-widget-item; TrafficStars uses .mn-thumb.
const NATIVE_ITEM_SELECTOR =
  ".exo-native-widget-item, .msg-native-widget-item, .mn-thumb";
const MEDIA_SELECTOR = "iframe, video, canvas, object, embed";

function hasVisibleImage(el: HTMLElement): boolean {
  return Array.from(el.querySelectorAll("img")).some((img) => {
    // Ignore 1x1 tracking pixels.
    if (img.naturalWidth > 1 && img.naturalHeight > 1) return true;
    const rect = img.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  });
}

function visibleText(node: Element): string {
  // innerText ignores <style>/<script> content; textContent would count the
  // CSS of ExoClick's empty loader as a creative.
  return (
    node instanceof HTMLElement ? node.innerText : (node.textContent ?? "")
  ).trim();
}

function adText(node: Element): string {
  // ExoClick's native widget always renders a "Powered By ExoClick" header.
  // It is not a creative, so it must not count as a fill.
  return visibleText(node)
    .replace(/Powered By ExoClick/gi, "")
    .trim();
}

/**
 * True when either network has actually painted a creative in this slot.
 *
 * ExoClick inserts a plain <div> BEFORE its <ins> and renders into that div
 * (native widgets, video slider, outstream, sticky). The div is a sibling of
 * the <ins>, not a child, so checking only the <ins> reports a false no-fill
 * and swaps a perfectly good ExoClick creative to TrafficStars.
 */
function slotHasCreative(el: HTMLElement): boolean {
  if (el.querySelector(NATIVE_ITEM_SELECTOR)) return true;
  if (el.querySelector(MEDIA_SELECTOR)) return true;
  if (hasVisibleImage(el)) return true;

  // ExoClick: creative rendered inside the <ins> itself.
  for (const ins of Array.from(el.querySelectorAll("ins"))) {
    if (Array.from(ins.children).some((c) => c.tagName !== "SCRIPT"))
      return true;
    if (visibleText(ins).length > 0) return true;
  }

  // ExoClick: creative rendered into the sibling <div> before the <ins>.
  for (const ins of Array.from(el.querySelectorAll("ins[data-zoneid]"))) {
    let sib = ins.previousElementSibling;
    while (sib && sib.tagName === "DIV") {
      if (adText(sib).length > 0) return true;
      sib = sib.previousElementSibling;
    }
  }

  // TrafficStars: creative rendered inside its spot container.
  for (const spot of Array.from(el.querySelectorAll('[id^="ts-spot-"]'))) {
    if (Array.from(spot.children).some((c) => c.tagName !== "SCRIPT"))
      return true;
    if (visibleText(spot).length > 0) return true;
  }

  return false;
}

function isProtectedNode(node: Element): boolean {
  return (
    node.id.startsWith("ts-spot-") ||
    node.classList.contains("animate-pulse") ||
    node.hasAttribute("aria-hidden") ||
    node.hasAttribute("data-ad-keep")
  );
}

/**
 * Drop ExoClick's render container(s) when a slot really is swapping to its
 * passback. The provider keeps a reference to that <div>, so a slow response
 * arriving after the swap can otherwise paint a second creative underneath
 * TrafficStars — the "both networks are showing" symptom.
 */
function removeExoRenderNodes(el: HTMLElement): void {
  const anchors = [
    ...Array.from(el.querySelectorAll("ins[data-zoneid]")),
    ...Array.from(el.querySelectorAll('[id^="ts-spot-"]')),
  ];
  for (const anchor of anchors) {
    let sib = anchor.previousElementSibling;
    while (sib && sib.tagName === "DIV") {
      const prev = sib.previousElementSibling;
      if (!isProtectedNode(sib)) sib.remove();
      sib = prev;
    }
  }
}

/**
 * Render-time cross-network rescue for ad slots.
 *
 * `pickAdZone` already falls back at DECISION time (preferred network has no
 * zone configured → serve the other). This covers the remaining cases:
 *
 * 1. Both networks configured, preferred chosen, but its creative never
 *    fills (empty auction / provider hiccup). After `timeoutMs` with no
 *    creative the hook returns the fallback decision so the component
 *    renders the other network's tag instead. This is standard publisher
 *    passback/waterfalling: each provider's tag is used verbatim, in a
 *    visible container, one creative per slot, and the swap only happens
 *    when NO creative loaded — so no impressions are stacked or hidden.
 *    (Both ExoClick and TrafficStars explicitly support passback tags.)
 *
 * 2. The provider's script element errored (browser content blocking such
 *    as Firefox ETP, ad blockers, offline). That failure is observed —
 *    never bypassed, which is prohibited by both providers' terms — and the
 *    slot immediately passbacks to the other network when its script is
 *    reachable, or reports `null` so the component can hide itself instead
 *    of reserving blank space.
 *
 * Fill = any rendered creative from either network: an <iframe>/<video>/
 * <img>, an ExoClick native widget, a non-empty <ins>, or the sibling <div>
 * ExoClick renders into. Checking only the <ins> is not enough.
 * Returns stable object references (primary/fallback as passed in).
 */
export function useAdRescue(
  // readonly current: covariant — accepts RefObject<HTMLDivElement | null>.
  ref: { readonly current: HTMLElement | null },
  active: boolean,
  primary: AdRescueDecision | null,
  fallback: AdRescueDecision | null,
  timeoutMs = 5000,
): AdRescueDecision | null {
  // Keyed to the current zone: changing zones disarms the rescue without a
  // setState-in-effect reset, and returning to a previous zone cannot inherit
  // its old swap.
  const [rescue, setRescue] = useState<{ key: string; active: boolean }>({
    key: "",
    active: false,
  });
  const key = primary ? `${primary.network}|${primary.zoneId}` : "";
  const primaryNetwork = primary?.network;
  const primaryZoneId = primary?.zoneId ?? "";
  const fbKey = fallback ? `${fallback.network}|${fallback.zoneId}` : "";
  const rescued = rescue.key === key && rescue.active;
  useEffect(() => {
    if (!active || !key || rescued) return;
    const t = setTimeout(() => {
      const el = ref.current;
      const filled = !!el && slotHasCreative(el);
      if (!filled && primaryNetwork && !isProviderFailed(primaryNetwork)) {
        // The script loaded but the zone returned no creative — a provider-
        // side matter (status/geo/device targeting). When the script itself
        // is unavailable, the "script unavailable" diagnostic already
        // explains the empty slot; a no-fill message here would mislead.
        diag(
          `nofill:${key}`,
          fbKey
            ? `${primaryNetwork} zone ${primaryZoneId} produced no creative in ${Math.round(timeoutMs / 1000)}s — swapping to ${fbKey.replace("|", " zone ")}. If this repeats for real traffic, check the zone's status/geo/device targeting in the provider dashboard.`
            : `${primaryNetwork} zone ${primaryZoneId} produced no creative in ${Math.round(timeoutMs / 1000)}s — no passback zone configured for this placement. Check the zone's status/geo/device targeting in the provider dashboard.`,
        );
        if (fbKey) {
          // Remove ExoClick's render <div> before React replaces the <ins>,
          // then the effect below catches anything left before the passback.
          if (el) removeExoRenderNodes(el);
          setRescue({ key, active: true });
        }
      }
    }, timeoutMs);
    return () => clearTimeout(t);
  }, [
    active,
    key,
    primaryNetwork,
    primaryZoneId,
    fbKey,
    rescued,
    timeoutMs,
    ref,
  ]);

  // After React has mounted the passback tag, drop any ExoClick render
  // container that survived the swap. Without this a late ExoClick response
  // paints a second creative underneath TrafficStars.
  useEffect(() => {
    if (!rescued) return;
    const el = ref.current;
    if (el) removeExoRenderNodes(el);
  }, [rescued, ref]);

  if (!primary) return null;

  const primaryFailed = isProviderFailed(primary.network);
  const fallbackFailed = fallback ? isProviderFailed(fallback.network) : true;

  if (primaryFailed) {
    diag(
      `blocked:${primary.network}`,
      `${primary.network} provider script is unavailable — likely Firefox Enhanced Tracking Protection (Strict mode / Private window), an ad-blocker extension, or network/DNS filtering. It is the browser's protection, not a site fault; the site does not bypass it (prohibited by the providers' terms). Affected slots passback to the other network or hide.`,
    );
    if (fallback && !fallbackFailed) return fallback;
    return null;
  }
  if (rescued && fallback && fbKey && !fallbackFailed) return fallback;
  return primary;
}
