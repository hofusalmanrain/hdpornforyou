/** Saved videos backed by /api/saved. */
import { api } from "./api-client";
import type { Video } from "@/data/videos";

const EVT = "hdpornforyou:saved-changed";
export const SAVED_EVENT = EVT;

let cache: Set<string> = new Set();
let hydrated = false;
let savedVideosCache: Video[] = [];
let savedVideosHydrated = false;

function emit() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
}

export async function hydrateSaved(): Promise<Set<string>> {
  try {
    const r = await api.get<{ ids: string[] }>("/api/saved");
    cache = new Set(r.ids || []);
    hydrated = true;
    emit();
  } catch {
    cache = new Set();
    hydrated = true;
  }
  return cache;
}

export function getSavedIds(): Set<string> {
  if (!hydrated && typeof window !== "undefined") hydrateSaved().catch(() => {});
  return cache;
}

export function isSaved(videoId: string): boolean {
  return cache.has(videoId);
}

export async function toggleSaved(videoId: string): Promise<boolean> {
  const r = await api.post<{ saved: boolean; videoId: string }>("/api/saved", { videoId });
  if (r.saved) cache.add(videoId);
  else {
    cache.delete(videoId);
    savedVideosCache = savedVideosCache.filter((v) => v.id !== videoId);
  }
  emit();
  return r.saved;
}

export function getCachedSavedVideos(): Video[] {
  return savedVideosCache;
}

export function savedVideosReady(): boolean {
  return savedVideosHydrated;
}

export async function fetchSavedVideos(): Promise<Video[]> {
  const r = await api.get<{ videos: Video[] }>("/api/saved/videos");
  savedVideosCache = r.videos || [];
  savedVideosHydrated = true;
  return savedVideosCache;
}
