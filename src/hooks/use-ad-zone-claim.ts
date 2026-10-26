import { useLayoutEffect, useReducer, useRef, useSyncExternalStore } from "react";
import {
  adZoneKey,
  claimAdZone,
  getAdZoneVersion,
  isAdZoneOwner,
  releaseAdZone,
  subscribeAdZones,
} from "@/lib/ad-zone-registry";

export interface AdZoneClaim {
  network: string;
  zoneId: string;
}

let nextOwnerId = 0;

/**
 * Claim a provider zone for this page.
 *
 * Returns `true` only for the first mounted slot using that network+zone.
 * Duplicate slots return `false` and must render nothing. The claim is
 * released on unmount or when the zone changes, so the next waiting slot can
 * take over.
 *
 * The claim is made from a layout effect so the first render (before the
 * claim exists) never paints a duplicate provider tag. Components must gate
 * their provider push and impression on the returned value.
 */
export function useAdZoneClaim(primary: AdZoneClaim | null): boolean {
  const ownerRef = useRef("");
  if (!ownerRef.current) ownerRef.current = `ad-slot-${++nextOwnerId}`;

  const version = useSyncExternalStore(
    subscribeAdZones,
    getAdZoneVersion,
    getAdZoneVersion,
  );
  const [, force] = useReducer((n: number) => n + 1, 0);

  const key = primary ? adZoneKey(primary.network, primary.zoneId) : null;

  // Claim/release when the slot's zone changes.
  useLayoutEffect(() => {
    if (!key) return;
    claimAdZone(key, ownerRef.current);
    // The claim is external state; re-render once so the slot can paint.
    force();
    return () => {
      releaseAdZone(key, ownerRef.current);
    };
  }, [key]);

  // If the current owner unmounts, a waiting duplicate should take over.
  useLayoutEffect(() => {
    if (!key) return;
    if (isAdZoneOwner(key, ownerRef.current)) return;
    if (claimAdZone(key, ownerRef.current)) force();
  }, [key, version]);

  return !!key && isAdZoneOwner(key, ownerRef.current);
}
