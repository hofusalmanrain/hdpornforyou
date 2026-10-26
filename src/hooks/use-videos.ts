import { useEffect, useState } from "react";
import { getAllVideos, VIDEOS_EVENT, hydrateVideos, videosHydrated } from "@/lib/video-store";
import type { Video } from "@/data/videos";

// Time-window during which a re-mount will NOT trigger a re-hydrate.
// This keeps the on-screen list stable when the user navigates
// away (e.g. into /watch/:slug) and hits Back, so cards do NOT
// re-shuffle or shift positions in the infinite-scroll grid.
const FRESH_MS = 60_000;
let lastHydratedAt = 0;

/** Reactive subscription to the local video store. */
export function useVideos(): Video[] {
  const [list, setList] = useState<Video[]>(() => getAllVideos());
  useEffect(() => {
    const sync = () => setList(getAllVideos());
    window.addEventListener(VIDEOS_EVENT, sync);
    window.addEventListener("storage", sync);
    // Background refresh so an already-open catalog page picks up videos the
    // automation engine imported while the page stayed mounted (without this,
    // only a re-mount after FRESH_MS would re-hydrate). Silent: unchanged data
    // yields the same ordered list, new imports simply appear at the top.
    const poll = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      lastHydratedAt = Date.now();
      hydrateVideos().catch(() => {});
    }, 60_000);
    // Only hydrate on mount if the cache is empty or stale. Refreshing
    // on every mount causes back-navigation from /watch to re-fetch and
    // re-order the list (trending scores recompute), which visibly
    // shuffles or "reloads" cards.
    const now = Date.now();
    if (!videosHydrated() || now - lastHydratedAt > FRESH_MS) {
      lastHydratedAt = now;
      hydrateVideos()
        .then(() => {
          lastHydratedAt = Date.now();
        })
        .catch(() => {});
    }
    return () => {
      clearInterval(poll);
      window.removeEventListener(VIDEOS_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return list;
}

export function useVideosReady(): boolean {
  const [ready, setReady] = useState(() => videosHydrated());
  useEffect(() => {
    const sync = () => setReady(videosHydrated());
    window.addEventListener(VIDEOS_EVENT, sync);
    if (!videosHydrated()) {
      hydrateVideos()
        .catch(() => {})
        .finally(sync);
    }
    return () => window.removeEventListener(VIDEOS_EVENT, sync);
  }, []);
  return ready;
}
