// In-memory write batchers. Flushed every FLUSH_MS by a single timer.
// Goal: collapse thousands of view/ad/pageview inserts into a few atomic
// bulk inserts per minute so PG write load stays flat under traffic spikes.

import { pool, tx } from "./db.js";
import { invalidate } from "./cache.js";

const FLUSH_MS = Number(process.env.BATCH_FLUSH_MS || 30000);
const MAX_BUFFER = Number(process.env.BATCH_MAX_BUFFER || 50000);

// Per-video view increments. videoId -> count.
const viewBuf = new Map();
// ad_events queued rows.
const adEventBuf = [];
// page_events queued rows.
const pageEventBuf = [];

export function bufferView(videoId) {
  if (!videoId) return;
  viewBuf.set(videoId, (viewBuf.get(videoId) || 0) + 1);
  if (viewBuf.size > MAX_BUFFER) void flushViews();
}

export function bufferAdEvent(zone, format, event) {
  adEventBuf.push([zone, format, event]);
  if (adEventBuf.length > MAX_BUFFER) void flushAdEvents();
}

export function bufferPageEvent(path, sessionId) {
  pageEventBuf.push([path, sessionId]);
  if (pageEventBuf.length > MAX_BUFFER) void flushPageEvents();
}

async function flushViews() {
  if (viewBuf.size === 0) return;
  const snapshot = [...viewBuf.entries()];
  viewBuf.clear();
  try {
    await tx(async (c) => {
      const ids = snapshot.map(([id]) => id);
      const counts = snapshot.map(([, n]) => n);
      await c.query(
        `UPDATE videos AS v
           SET views = v.views + d.delta
          FROM (SELECT UNNEST($1::text[]) AS id, UNNEST($2::bigint[]) AS delta) d
         WHERE v.id = d.id`,
        [ids, counts],
      );
    });
    if (snapshot.length) invalidate("videos:all");
  } catch (e) {
    console.error("[batch] view flush failed:", e.message);
    for (const [id, n] of snapshot) viewBuf.set(id, (viewBuf.get(id) || 0) + n);
  }
}

async function flushAdEvents() {
  if (adEventBuf.length === 0) return;
  const rows = adEventBuf.splice(0, adEventBuf.length);
  try {
    const zones = rows.map((r) => r[0]);
    const formats = rows.map((r) => r[1]);
    const events = rows.map((r) => r[2]);
    await pool.query(
      `INSERT INTO ad_events (zone, format, event)
       SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[])`,
      [zones, formats, events],
    );
    invalidate("ads:stats");
  } catch (e) {
    console.error("[batch] ad_event flush failed:", e.message);
    adEventBuf.push(...rows);
  }
}

async function flushPageEvents() {
  if (pageEventBuf.length === 0) return;
  const rows = pageEventBuf.splice(0, pageEventBuf.length);
  try {
    const paths = rows.map((r) => r[0]);
    const sessions = rows.map((r) => r[1]);
    await pool.query(
      `INSERT INTO page_events (path, session_id)
       SELECT * FROM UNNEST($1::text[], $2::text[])`,
      [paths, sessions],
    );
  } catch (e) {
    console.error("[batch] page_event flush failed:", e.message);
    pageEventBuf.push(...rows);
  }
}

let timer = null;
export function startBatcher() {
  if (timer) return;
  timer = setInterval(() => {
    void flushViews();
    void flushAdEvents();
    void flushPageEvents();
  }, FLUSH_MS);
  timer.unref?.();
}

export async function flushAll() {
  await Promise.allSettled([flushViews(), flushAdEvents(), flushPageEvents()]);
}

export function batchStats() {
  return {
    pendingViews: viewBuf.size,
    pendingAdEvents: adEventBuf.length,
    pendingPageEvents: pageEventBuf.length,
    flushMs: FLUSH_MS,
  };
}
