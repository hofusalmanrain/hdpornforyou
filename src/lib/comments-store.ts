/**
 * Comments store — backed by /api/comments. No browser storage.
 * Per-video disable flag is stored as a server setting `comments-disabled`.
 */
import { api } from "./api-client";

export type CommentStatus = "pending" | "approved" | "rejected";

export interface Comment {
  id: string;
  videoId: string;
  author: string;
  email?: string;
  body: string;
  createdAt: string;
  status: CommentStatus;
}

interface ApiComment {
  id: string;
  video_id: string;
  author: string;
  email: string | null;
  body: string;
  status: CommentStatus;
  created_at: string;
}
function fromApi(c: ApiComment): Comment {
  return {
    id: c.id,
    videoId: c.video_id,
    author: c.author,
    email: c.email ?? undefined,
    body: c.body,
    createdAt: c.created_at,
    status: c.status,
  };
}

const EVT = "hdpornforyou:comments-changed";
export const COMMENTS_EVENT = EVT;

let cache: Comment[] = [];
let hydrated = false;
let disabledCache: Record<string, true> = {};
let disabledHydrated = false;

function emit() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
}

export async function hydrateComments(): Promise<Comment[]> {
  const { comments } = await api.get<{ comments: ApiComment[] }>("/api/comments");
  cache = comments.map(fromApi);
  hydrated = true;
  emit();
  return cache;
}

async function hydrateDisabled() {
  const { value } = await api
    .get<{ value: Record<string, true> | null }>("/api/settings/comments-disabled")
    .catch(() => ({ value: null }));
  disabledCache = value ?? {};
  disabledHydrated = true;
  emit();
}

export function getAllComments(): Comment[] {
  if (!hydrated && typeof window !== "undefined") hydrateComments().catch(() => {});
  return cache;
}

export function getCommentsForVideo(videoId: string, includePending = false): Comment[] {
  if (!hydrated && typeof window !== "undefined") hydrateComments().catch(() => {});
  return cache
    .filter((c) => c.videoId === videoId && (includePending || c.status !== "rejected"))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function postComment(
  input: Omit<Comment, "id" | "createdAt" | "status">,
): Promise<Comment> {
  const { comment } = await api.post<{ comment: ApiComment }>("/api/comments", {
    videoId: input.videoId,
    author: input.author,
    email: input.email,
    body: input.body,
  });
  const c = fromApi(comment);
  cache = [c, ...cache];
  emit();
  return c;
}

export async function updateComment(id: string, patch: Partial<Comment>) {
  await api.patch(`/api/comments/${id}`, {
    author: patch.author,
    body: patch.body,
    status: patch.status,
  });
  cache = cache.map((c) => (c.id === id ? { ...c, ...patch } : c));
  emit();
}

export async function deleteComment(id: string) {
  await api.del(`/api/comments/${id}`);
  cache = cache.filter((c) => c.id !== id);
  emit();
}

export async function bulkUpdate(ids: string[], patch: Partial<Comment>) {
  await Promise.all(
    ids.map((id) =>
      api.patch(`/api/comments/${id}`, {
        author: patch.author,
        body: patch.body,
        status: patch.status,
      }),
    ),
  );
  const set = new Set(ids);
  cache = cache.map((c) => (set.has(c.id) ? { ...c, ...patch } : c));
  emit();
}

export async function bulkDelete(ids: string[]) {
  await api.post("/api/comments/bulk-delete", { ids });
  const set = new Set(ids);
  cache = cache.filter((c) => !set.has(c.id));
  emit();
}

/* ---------- per-video disable flag ---------- */

export function isCommentsDisabled(videoId: string): boolean {
  if (!disabledHydrated && typeof window !== "undefined") hydrateDisabled().catch(() => {});
  return !!disabledCache[videoId];
}

export async function setCommentsDisabled(videoId: string, disabled: boolean) {
  const cur = { ...disabledCache };
  if (disabled) cur[videoId] = true;
  else delete cur[videoId];
  await api.put("/api/settings/comments-disabled", { value: cur });
  disabledCache = cur;
  emit();
}
