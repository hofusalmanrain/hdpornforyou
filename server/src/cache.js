// L1 in-memory cache with TTL + LRU eviction + stale-while-revalidate.
// 100% self-hosted, lives in the Node process. PM2 cluster-safe because
// the cache is per-process — workers fill independently and DB stays
// the source of truth.

const DEFAULT_MAX = Number(process.env.CACHE_MAX_KEYS || 5000);

class LRU {
  constructor(max) {
    this.max = max;
    this.map = new Map(); // key -> { value, expires, staleUntil, refreshing }
  }
  get(key) {
    const e = this.map.get(key);
    if (!e) return undefined;
    // touch — move to end for LRU.
    this.map.delete(key);
    this.map.set(key, e);
    return e;
  }
  set(key, entry) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, entry);
    while (this.map.size > this.max) {
      const first = this.map.keys().next().value;
      this.map.delete(first);
    }
  }
  del(key) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
  size() {
    return this.map.size;
  }
}

const store = new LRU(DEFAULT_MAX);

/**
 * Cache-first read with stale-while-revalidate.
 * - Fresh hit → return immediately.
 * - Stale hit → return stale immediately, refresh in background.
 * - Miss → await loader, populate, return.
 * - Loader failure with a stale entry available → serve stale (graceful degradation).
 */
export async function cached(key, ttlMs, loader, { staleMs = ttlMs * 4 } = {}) {
  const now = Date.now();
  const entry = store.get(key);
  if (entry && entry.expires > now) return entry.value;

  if (entry && entry.staleUntil > now) {
    // Serve stale, refresh in background once.
    if (!entry.refreshing) {
      entry.refreshing = true;
      Promise.resolve()
        .then(() => loader())
        .then((value) => {
          store.set(key, {
            value,
            expires: Date.now() + ttlMs,
            staleUntil: Date.now() + ttlMs + staleMs,
            refreshing: false,
          });
        })
        .catch((e) => {
          entry.refreshing = false;
          console.warn(`[cache] background refresh failed for ${key}: ${e.message}`);
        });
    }
    return entry.value;
  }

  // Cold miss or fully expired.
  try {
    const value = await loader();
    store.set(key, {
      value,
      expires: now + ttlMs,
      staleUntil: now + ttlMs + staleMs,
      refreshing: false,
    });
    return value;
  } catch (err) {
    if (entry) {
      console.warn(`[cache] loader failed for ${key}, serving stale: ${err.message}`);
      return entry.value;
    }
    throw err;
  }
}

export function invalidate(key) {
  store.del(key);
}
export function invalidatePrefix(prefix) {
  for (const k of [...store.map.keys()]) if (k.startsWith(prefix)) store.del(k);
}
export function clearAll() {
  store.clear();
}
export function cacheStats() {
  return { size: store.size(), max: store.max };
}
