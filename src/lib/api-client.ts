/**
 * Tiny fetch wrapper used by every store.
 *
 * - Same-origin /api/* calls (works behind nginx/Caddy).
 * - Cookie-based session auth (credentials: "include").
 * - On non-2xx OR network failure: throws an `ApiError`.
 *   No silent fallback, no browser storage anywhere.
 */

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const isBrowser = typeof window !== "undefined";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!isBrowser) throw new ApiError("api only available in browser", 0);
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
      ...init,
    });
  } catch (e) {
    throw new ApiError(`network error: ${(e as Error).message}`, 0);
  }
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const msg = (body && (body.error || body.message)) || res.statusText || "request failed";
    throw new ApiError(msg, res.status);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

/** Fire-and-forget; never throws, never blocks UI. Used for analytics. */
export function beacon(path: string, body: unknown) {
  if (!isBrowser) return;
  try {
    const data = JSON.stringify(body);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(path, new Blob([data], { type: "application/json" }));
      return;
    }
    fetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: data,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* silent */
  }
}
