/**
 * Reactions store — backed entirely by /api/reactions/:videoId.
 * No browser storage. Each video's counts are cached per session in memory.
 */
import { api } from "./api-client";
import { trackView as trackVideoView, hydrateVideos } from "./video-store";

export type ReactionKind = "like" | "dislike";

export interface VideoCounts {
  likes: number;
  dislikes: number;
  views: number;
  mine?: ReactionKind | null;
}

const EVT = "hdpornforyou:reactions-changed";
export const REACTIONS_EVENT = EVT;

const cache = new Map<string, VideoCounts>();

function emit() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
}

export async function hydrateReactions(videoId: string): Promise<VideoCounts> {
  const r = await api.get<{ likes: number; dislikes: number; mine: ReactionKind | null }>(
    `/api/reactions/${videoId}`,
  );
  const existing = cache.get(videoId);
  const next: VideoCounts = {
    likes: r.likes,
    dislikes: r.dislikes,
    views: existing?.views ?? 0,
    mine: r.mine,
  };
  cache.set(videoId, next);
  emit();
  return next;
}

export function getCounts(videoId: string): VideoCounts {
  if (!cache.has(videoId) && typeof window !== "undefined") {
    hydrateReactions(videoId).catch(() => {});
    return { likes: 0, dislikes: 0, views: 0, mine: null };
  }
  return cache.get(videoId) ?? { likes: 0, dislikes: 0, views: 0, mine: null };
}

export function getUserReaction(_userId: string | null, videoId: string): ReactionKind | null {
  return cache.get(videoId)?.mine ?? null;
}

export async function react(
  _userId: string,
  videoId: string,
  kind: ReactionKind,
): Promise<ReactionKind | null> {
  const r = await api.post<{ likes: number; dislikes: number; mine: ReactionKind | null }>(
    `/api/reactions/${videoId}`,
    { kind },
  );
  const existing = cache.get(videoId);
  cache.set(videoId, {
    likes: r.likes,
    dislikes: r.dislikes,
    views: existing?.views ?? 0,
    mine: r.mine,
  });
  emit();
  hydrateVideos().catch(() => {});
  return r.mine;
}

/** Re-exported for convenience: track a view via the server. */
export function trackView(videoId: string) {
  trackVideoView(videoId);
}
