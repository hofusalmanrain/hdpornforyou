// PostgreSQL connection pool + safe query runner.
// Self-hosted, no external services. Dynamic pool sizing so the same code
// scales from a 1-vCPU VPS to a 16-vCPU box without changes.

import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Dynamic pool sizing — scales with CPU count, overridable via env.
const cpuCount = Math.max(1, os.cpus()?.length || 1);
const DEFAULT_POOL = Math.min(50, Math.max(10, cpuCount * 4));
const POOL_MAX = Number(process.env.PG_POOL_MAX || DEFAULT_POOL);
const POOL_MIN = Number(process.env.PG_POOL_MIN || 2);
const STATEMENT_TIMEOUT_MS = Number(process.env.PG_STATEMENT_TIMEOUT_MS || 5000);
const IDLE_TIMEOUT_MS = Number(process.env.PG_IDLE_TIMEOUT_MS || 30000);
const CONN_TIMEOUT_MS = Number(process.env.PG_CONN_TIMEOUT_MS || 5000);

// SSL — opt-in via PGSSLMODE=require; works with current PostgreSQL SSL modes.
const sslConfig =
  process.env.PGSSLMODE && process.env.PGSSLMODE !== "disable"
    ? { rejectUnauthorized: process.env.PGSSLMODE === "verify-full" }
    : false;

const poolConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
    };

export const pool = new Pool({
  ...poolConfig,
  ssl: sslConfig,
  max: POOL_MAX,
  min: POOL_MIN,
  idleTimeoutMillis: IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: CONN_TIMEOUT_MS,
  statement_timeout: STATEMENT_TIMEOUT_MS,
  application_name: "hdpornforyou",
});

pool.on("error", (err) => {
  // Idle client errors should never crash the process.
  console.error("[pg] idle client error:", err.message);
});

// ---------------- Safe query runner ----------------

export async function q(text, params = []) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const dur = Date.now() - start;
    if (dur > 500) console.warn(`[pg slow ${dur}ms]`, text.slice(0, 120));
    return res;
  } catch (err) {
    console.error(`[pg error] ${err.code || ""} ${err.message}`);
    throw err;
  }
}

export async function one(text, params = []) {
  const res = await q(text, params);
  return res.rows[0] || null;
}

export async function many(text, params = []) {
  const res = await q(text, params);
  return res.rows;
}

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
}

// ---------------- Schema bootstrap ----------------

export async function applySchema() {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(sql);
}

export async function hasAnyAdmin() {
  try {
    const r = await pool.query("SELECT 1 FROM admins LIMIT 1");
    return r.rowCount > 0;
  } catch {
    return false;
  }
}

export function poolStats() {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
    max: POOL_MAX,
  };
}

// ---------------- Connection diagnostics ----------------
// Classify a pg connection error into an actionable message. Never leaks
// passwords or secrets — only echoes the host/port/db/user already logged
// at startup.
function diagnose(err) {
  const code = err && err.code;
  const msg = (err && err.message) || String(err);
  const where = `host=${process.env.PGHOST} port=${process.env.PGPORT} db=${process.env.PGDATABASE} user=${process.env.PGUSER}`;

  // pg error codes: https://www.postgresql.org/docs/current/errcodes-appendix.html
  if (code === "28P01" || /password authentication failed/i.test(msg)) {
    return `Database authentication failed for user "${process.env.PGUSER}". Check DB_USER and DB_PASSWORD. (${where})`;
  }
  if (code === "28000" || /role .* does not exist/i.test(msg)) {
    return `PostgreSQL role "${process.env.PGUSER}" does not exist. Create the role or update PGUSER. (${where})`;
  }
  if (code === "3D000" || /database .* does not exist/i.test(msg)) {
    return `Database "${process.env.PGDATABASE}" does not exist. Create the database or update PGDATABASE. (${where})`;
  }
  if (code === "ECONNREFUSED") {
    return `PostgreSQL server is not running or not accepting connections at ${process.env.PGHOST}:${process.env.PGPORT}.`;
  }
  if (code === "ETIMEDOUT" || code === "EHOSTUNREACH" || /timeout/i.test(msg)) {
    return `Unable to reach PostgreSQL server at ${process.env.PGHOST}:${process.env.PGPORT}. Check host, port, firewall, and service status.`;
  }
  if (code === "ENOTFOUND") {
    return `PostgreSQL host "${process.env.PGHOST}" could not be resolved (DNS).`;
  }
  if (/ssl|sslmode|self.?signed|certificate/i.test(msg)) {
    return `SSL configuration mismatch detected. Adjust PGSSLMODE (current: ${process.env.PGSSLMODE || "disable"}).`;
  }
  return `Database connection error: ${msg} (${where})`;
}

// Wait for Postgres to be reachable, with retries. Auth/role/db errors are
// non-retryable — fail fast with a precise diagnostic.
export async function waitForDb(retries = 30, delayMs = 1000) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query("SELECT 1");
      console.log("[pg] connected.");
      return true;
    } catch (e) {
      lastErr = e;
      const fatal = ["28P01", "28000", "3D000", "ENOTFOUND"].includes(e.code);
      if (fatal) {
        console.error(`[pg] ${diagnose(e)}`);
        throw new Error(diagnose(e));
      }
      if (i === 0) console.log(`[pg] waiting for database… (${e.code || ""} ${e.message})`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  const detail = lastErr ? diagnose(lastErr) : "unknown error";
  throw new Error(`Database unreachable after ${retries} retries. ${detail}`);
}
