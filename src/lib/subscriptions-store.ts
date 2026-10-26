/** Channel subscriptions backed by /api/subscriptions. */
import { api } from "./api-client";

const EVT = "hdpornforyou:subs-changed";
export const SUBS_EVENT = EVT;

let cache: Set<string> = new Set();
let hydrated = false;

function emit() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
}

export async function hydrateSubscriptions(): Promise<Set<string>> {
  try {
    const r = await api.get<{ channels: string[] }>("/api/subscriptions");
    cache = new Set(r.channels || []);
    hydrated = true;
    emit();
  } catch {
    cache = new Set();
    hydrated = true;
  }
  return cache;
}

export function getSubscriptions(): Set<string> {
  if (!hydrated && typeof window !== "undefined") {
    hydrateSubscriptions().catch(() => {});
  }
  return cache;
}

export function isSubscribed(channel: string): boolean {
  return cache.has(channel);
}

export async function toggleSubscription(channel: string): Promise<boolean> {
  const r = await api.post<{ subscribed: boolean; channel: string }>("/api/subscriptions", {
    channel,
  });
  if (r.subscribed) cache.add(channel);
  else cache.delete(channel);
  emit();
  return r.subscribed;
}
