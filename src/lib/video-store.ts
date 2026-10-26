/**
 * Video store — backed entirely by /api/videos. No browser storage.
 *
 * Synchronous getters return the in-memory cache. Call `hydrateVideos()`
 * at app startup to populate the cache; mutations call the API and update
 * the cache + emit the change event.
 */
import { getEmbedId, type Video } from "@/data/videos";
import { api } from "./api-client";

export type { Video };

const EVT = "hdpornforyou:videos-changed";
let cache: Video[] = []; // empty until first hydrate from /api/videos
let hydrated = false;
let hydrationPromise: Promise<Video[]> | null = null;

function emit() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
}

export const VIDEOS_EVENT = EVT;

function sameVideo(a: Video, b: Video): boolean {
  return a.id === b.id || getEmbedId(a) === getEmbedId(b);
}

function mergeHydratedVideos(incoming: Video[]): Video[] {
  if (!hydrated || cache.length === 0) return incoming;

  const used = new Set<number>();
  const next = cache
    .map((existing) => {
      const idx = incoming.findIndex(
        (candidate, i) => !used.has(i) && sameVideo(existing, candidate),
      );
      if (idx < 0) return null;
      used.add(idx);
      return incoming[idx];
    })
    .filter((v): v is Video => v !== null);

  for (let i = 0; i < incoming.length; i += 1) {
    if (!used.has(i)) next.push(incoming[i]);
  }

  return next;
}

export async function hydrateVideos(): Promise<Video[]> {
  if (hydrationPromise) return hydrationPromise;
  hydrationPromise = (async () => {
    const res = await api.get<{ videos: Video[] }>("/api/videos");
    cache = mergeHydratedVideos(res.videos ?? []);
    hydrated = true;
    emit();
    return cache;
  })().finally(() => {
    hydrationPromise = null;
  });
  return hydrationPromise;
}

export function getAllVideos(): Video[] {
  if (!hydrated && typeof window !== "undefined") {
    // Fire-and-forget hydrate on first access from a component.
    hydrateVideos().catch(() => {});
  }
  return cache;
}

export function videosHydrated(): boolean {
  return hydrated;
}

export async function saveAllVideos(list: Video[]) {
  await api.put("/api/videos", { videos: list });
  cache = list;
  emit();
}

export async function upsertVideo(v: Video) {
  await api.post("/api/videos", { video: v });
  // Uniqueness is enforced by embed id (e.g. YouTube video id), not slug or
  // internal id. Locate any existing entry that targets the same embed —
  // including ones with a different internal id — and replace it in place.
  const eid = getEmbedId(v);
  const idx = cache.findIndex((x) => x.id === v.id || getEmbedId(x) === eid);
  if (idx >= 0) {
    // Server preserves views/likes on update (and merges any boosts/reactions).
    // Preserve them in the local cache too so the admin UI doesn't briefly
    // show stale form values (or values left over before an "Apply +/− now"
    // adjustment that cleared its delta inputs).
    const prev = cache[idx];
    cache[idx] = { ...v, views: prev.views, likes: prev.likes };
  } else {
    cache = [v, ...cache];
  }
  cache = [...cache];
  emit();
  // Re-hydrate in the background to pull authoritative counts (boosts,
  // real reactions, algorithmic trending/featured flags) without blocking.
  hydrateVideos().catch(() => {});
}

export async function removeVideo(id: string) {
  await api.del(`/api/videos/${id}`);
  cache = cache.filter((v) => v.id !== id);
  emit();
}

function normalizeSourceUrl(url?: string): string | undefined {
  if (!url) return url;
  return url.replace(/eporner\.com\/video\//, "eporner.com/video-");
}

export async function bulkImport(rows: Partial<Video>[]): Promise<number> {
  const created: Video[] = rows
    .filter((r) => r.title && r.embedUrl && r.thumbnail)
    .map((r, i) => ({
      id: r.id ?? `imp-${Date.now()}-${i}`,
      slug: r.slug,
      title: r.title!,
      description: r.description ?? "",
      embedUrl: r.embedUrl!,
      sourceUrl: normalizeSourceUrl(r.sourceUrl),
      thumbnail: r.thumbnail!,
      duration: r.duration ?? "0:00",
      views: r.views ?? 0,
      likes: r.likes ?? 0,
      category: r.category ?? "all",
      tags: r.tags ?? [],
      trending: r.trending ?? false,
      featured: r.featured ?? false,
      hd: r.hd ?? true,
      uploadedAt: r.uploadedAt ?? new Date().toISOString().slice(0, 10),
      channel: r.channel ?? "Unknown",
    }));
  // Deduplicate by embed id (e.g. YouTube video id). Within the incoming
  // batch the first occurrence wins; against the existing catalog the new
  // row replaces the old one so re-importing refreshes metadata in place.
  const seen = new Set<string>();
  const uniqueCreated: Video[] = [];
  for (const v of created) {
    const eid = getEmbedId(v);
    if (seen.has(eid)) continue;
    seen.add(eid);
    uniqueCreated.push(v);
  }
  const createdEmbedIds = new Set(uniqueCreated.map((v) => getEmbedId(v)));
  // Append/import only the selected videos. Do not replace the full catalog;
  // replacing caused concurrent automation/backend imports to be wiped out.
  cache = cache.filter((v) => v.id && !createdEmbedIds.has(getEmbedId(v)));
  cache = [...uniqueCreated, ...cache];
  emit();
  await api.post("/api/videos/bulk-import", { videos: uniqueCreated });
  await hydrateVideos();
  return uniqueCreated.length;
}

export async function resetVideos() {
  await saveAllVideos([]);
}

/** One view per session per video (server-tracked). */
export function trackView(videoId: string) {
  if (typeof window === "undefined") return;
  fetch(`/api/videos/${videoId}/view`, {
    method: "POST",
    credentials: "include",
    keepalive: true,
  })
    .then((r) => r.json().catch(() => null))
    .then((j) => {
      // Do not re-hydrate the whole catalog after a watch. The server list is
      // sorted by updated_at/trending data, so replacing the cache here can move
      // cards while the user navigates Back or clicks Up Next. Update this one
      // video's visible count in place instead.
      if (j && j.counted) {
        const idx = cache.findIndex((v) => v.id === videoId);
        if (idx >= 0) {
          cache[idx] = { ...cache[idx], views: Number(cache[idx].views || 0) + 1 };
          cache = [...cache];
          emit();
        }
      }
    })
    .catch(() => {});
}

/** Admin-only: add (or subtract) deltas to view/like counts.
 *  Returns the freshly-recomputed video so callers can show live totals. */
export async function adjustVideo(
  id: string,
  addViews: number,
  addLikes: number,
): Promise<Video | null> {
  if (!addViews && !addLikes) return cache.find((v) => v.id === id) ?? null;
  const res = await api.post<{ ok: true; video: Video }>(`/api/videos/${id}/adjust`, {
    addViews,
    addLikes,
  });
  if (res.video) {
    const idx = cache.findIndex((v) => v.id === id);
    if (idx >= 0) cache[idx] = res.video;
    else cache = [res.video, ...cache];
    cache = [...cache];
    emit();
  }
  return res.video ?? cache.find((v) => v.id === id) ?? null;
}
