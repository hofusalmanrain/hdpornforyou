/**
 * Provider script availability tracking.
 *
 * Firefox's Enhanced Tracking Protection (and every content blocker) rejects
 * the ad-provider scripts by domain: `a.magsrv.com` (ExoClick) and
 * `cdn.tsyndicate.com` (TrafficStars) are both on Firefox's Disconnect
 * "Advertising" list, so the network request is cancelled and the <script>
 * element fires its `error` event. A blocked script can therefore be told
 * apart from a slow one deterministically.
 *
 * This module only OBSERVES the outcome of the standard script tags that
 * <AdProvider /> inserts. It never bypasses, retries behind the user's back,
 * or circumvents browser blocking — circumvention is prohibited by both
 * ExoClick's and TrafficStars' publisher terms. The only behaviour change is
 * graceful: a slot whose provider is confirmed unavailable swaps to its
 * passback network (when that one is reachable) or hides itself, instead of
 * reserving blank space for 8+ seconds.
 */
import { ADS_EVENT } from "./ads-config";
import type { Network } from "./ad-router";

export type ScriptState = "pending" | "loaded" | "failed";

const state: Record<Network, ScriptState> = { exoclick: "pending", trafficstars: "pending" };

export function getScriptState(network: Network): ScriptState {
  return state[network] ?? "pending";
}

export function isProviderFailed(network: Network): boolean {
  return getScriptState(network) === "failed";
}

export function isProviderLoaded(network: Network): boolean {
  return getScriptState(network) === "loaded";
}

/** Used by <AdProvider /> when a script tag settles. Idempotent + notifies. */
export function reportScriptState(network: Network, next: ScriptState) {
  if (state[network] === next) return;
  state[network] = next;
  try {
    (window as unknown as Record<string, unknown>).__AD_SCRIPT_STATE__ = { ...state };
  } catch {
    /* noop */
  }
  try {
    window.dispatchEvent(new Event(ADS_EVENT));
  } catch {
    /* noop */
  }
}
