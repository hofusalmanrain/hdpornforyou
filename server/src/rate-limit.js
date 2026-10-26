// Lightweight in-process rate limiter — fixed-window per (key, bucket).
// Self-hosted, no external services. Per-worker counters; for PM2 cluster
// the effective rate is N_workers * limit per window.

const buckets = new Map(); // key -> { count, resetAt }

function take(key, limit, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, resetMs: windowMs };
  }
  if (b.count >= limit) {
    return { ok: false, remaining: 0, resetMs: b.resetAt - now };
  }
  b.count += 1;
  return { ok: true, remaining: limit - b.count, resetMs: b.resetAt - now };
}

// Periodic GC so the map can't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
}, 60_000).unref?.();

function clientKey(req) {
  // Trust X-Forwarded-For only because `app.set('trust proxy', 1)` is on.
  return req.ip || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?";
}

export function rateLimit({ name, limit, windowMs }) {
  return (req, res, next) => {
    const key = `${name}:${clientKey(req)}`;
    const r = take(key, limit, windowMs);
    res.setHeader("X-RateLimit-Limit", String(limit));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, r.remaining)));
    if (!r.ok) {
      res.setHeader("Retry-After", String(Math.ceil(r.resetMs / 1000)));
      return res.status(429).json({ error: "Too many requests" });
    }
    next();
  };
}
