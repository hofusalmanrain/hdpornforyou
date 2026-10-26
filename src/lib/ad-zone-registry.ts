/**
 * Per-page claim registry for rendered ad zones.
 *
 * ExoClick and TrafficStars zones are single-instance tags: mounting the same
 * zone in two slots on one page requests the same creative twice and paints
 * duplicate ads. Feed pages used to render the same banner/native/outstream
 * placement at the top and again inside the feed; the watch page reused one
 * native/outstream zone for both the player and the related feed.
 *
 * Only the first mounted slot for a given `network|zone` may render and push
 * the provider. Later slots hide themselves. If the owner unmounts (route
 * change, device change, admin settings), the next waiting slot takes over.
 *
 * This is a client-side delivery guard only. It does not touch provider
 * cookies, frequency caps, or the ad waterfall.
 */

type Listener = () => void;

const owners = new Map<string, string>();
const listeners = new Set<Listener>();
let version = 0;

function emit() {
  version += 1;
  for (const listener of listeners) listener();
}

export function adZoneKey(network: string, zoneId: string): string {
  return `${network}|${zoneId}`;
}

export function claimAdZone(key: string, ownerId: string): boolean {
  const current = owners.get(key);
  if (current === ownerId) return true;
  if (current) return false;
  owners.set(key, ownerId);
  emit();
  return true;
}

export function releaseAdZone(key: string, ownerId: string): void {
  if (owners.get(key) !== ownerId) return;
  owners.delete(key);
  emit();
}

export function isAdZoneOwner(key: string, ownerId: string): boolean {
  return owners.get(key) === ownerId;
}

export function subscribeAdZones(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAdZoneVersion(): number {
  return version;
}

/** Test-only reset. */
export function resetAdZones(): void {
  owners.clear();
  emit();
}
