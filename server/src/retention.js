// Automatic retention for operational logs.
//
// - ad_events      → 30 days (ads/stats only ever reports the last 30 days)
// - page_events    → 30 days (traffic logs; no history beyond that)
// - import_logs    → newest 50 rows (the amount shown in Automation logs)
//
// Runs at boot and then hourly in every API/automation process. A Postgres
// advisory lock keeps concurrent workers from cleaning the same tables at
// once, so clustered deployments stay single-flight per interval.

import { pool } from "./db.js";

export const AD_RETENTION_DAYS = 30;
export const TRAFFIC_RETENTION_DAYS = 30;
export const AUTOMATION_LOG_KEEP = 50;

const CLEANUP_INTERVAL_MS = Math.max(
  60_000,
  Number(process.env.LOG_CLEANUP_INTERVAL_MS) || 60 * 60 * 1000,
);
const LOCK_KEY = 917_302_411;
const BATCH_SIZE = 5000;

async function deleteBatched(client, table, whereSql, params) {
  let deleted = 0;
  for (;;) {
    const res = await client.query(
      `DELETE FROM ${table}
        WHERE ctid IN (SELECT ctid FROM ${table} WHERE ${whereSql} LIMIT ${BATCH_SIZE})`,
      params,
    );
    deleted += res.rowCount;
    if (res.rowCount < BATCH_SIZE) break;
  }
  return deleted;
}

async function withAdvisoryLock(fn) {
  const client = await pool.connect();
  try {
    const lock = await client.query("SELECT pg_try_advisory_lock($1) AS ok", [
      LOCK_KEY,
    ]);
    if (!lock.rows[0]?.ok) return { skipped: true };
    try {
      return await fn(client);
    } finally {
      await client
        .query("SELECT pg_advisory_unlock($1)", [LOCK_KEY])
        .catch(() => {});
    }
  } finally {
    client.release();
  }
}

export async function runRetentionCleanup() {
  return withAdvisoryLock(async (client) => {
    const adsDeleted = await deleteBatched(
      client,
      "ad_events",
      `ts < NOW() - ($1 * INTERVAL '1 day')`,
      [AD_RETENTION_DAYS],
    );
    const trafficDeleted = await deleteBatched(
      client,
      "page_events",
      `ts < NOW() - ($1 * INTERVAL '1 day')`,
      [TRAFFIC_RETENTION_DAYS],
    );
    const logsDeleted = await deleteBatched(
      client,
      "import_logs",
      `id NOT IN (
         SELECT id FROM import_logs ORDER BY created_at DESC, id DESC LIMIT $1
       )`,
      [AUTOMATION_LOG_KEEP],
    );
    return { skipped: false, adsDeleted, trafficDeleted, logsDeleted };
  });
}

let timer = null;

export function startRetentionCleanup() {
  if (timer) return;
  const tick = async () => {
    try {
      const result = await runRetentionCleanup();
      if (
        !result.skipped &&
        (result.adsDeleted > 0 ||
          result.trafficDeleted > 0 ||
          result.logsDeleted > 0)
      ) {
        console.log(
          `[retention] pruned ad_events=${result.adsDeleted} page_events=${result.trafficDeleted} import_logs=${result.logsDeleted}`,
        );
      }
    } catch (e) {
      console.error("[retention] cleanup failed:", e.message);
    }
    timer = setTimeout(tick, CLEANUP_INTERVAL_MS);
    timer.unref?.();
  };
  timer = setTimeout(tick, 0);
  timer.unref?.();
}
