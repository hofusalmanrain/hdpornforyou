// Environment loading + startup validation.
// Loads .env from (in order): server/.env, then project-root .env.
// Existing process.env values always win (so systemd/Docker env beats files).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const candidates = [
  path.resolve(__dirname, "../.env"), // server/.env
  path.resolve(__dirname, "../../.env"), // project root .env
];

const loadedFrom = [];
for (const file of candidates) {
  if (fs.existsSync(file)) {
    dotenv.config({ path: file, override: false });
    loadedFrom.push(file);
  }
}

// Required env vars for the server to start.
// When DATABASE_URL is set, individual PG vars are not required.
const PG_INDIVIDUAL = ["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE"];
const REQUIRED = process.env.DATABASE_URL ? [] : PG_INDIVIDUAL;
const OPTIONAL = [
  "PORT",
  "STATIC_DIR",
  "SESSION_SECRET",
  "NODE_ENV",
  "COOKIE_SECURE",
  "PG_POOL_MAX",
  "PG_POOL_MIN",
  "PG_STATEMENT_TIMEOUT_MS",
  "PG_IDLE_TIMEOUT_MS",
  "PG_CONN_TIMEOUT_MS",
  "CACHE_MAX_KEYS",
  "BATCH_FLUSH_MS",
  "ADMIN_USERNAME",
  "ADMIN_PASSWORD",
  "DATABASE_URL",
  "PGSSLMODE",
  "SEO_SHELL_ENABLED",
  "SEO_SHELL_BOTS_ONLY",
  "SEO_SHELL_DEBUG",
  "TAG_MIN_VIDEOS",
  "SEO_CANONICAL_BASE",
];

// Apply safe defaults BEFORE validating.
process.env.PGHOST = process.env.PGHOST || "127.0.0.1";
process.env.PGPORT = process.env.PGPORT || "5432";
process.env.PGUSER = process.env.PGUSER || "hdpornforyou";
process.env.PGDATABASE = process.env.PGDATABASE || "hdpornforyou";

export function validateEnv() {
  console.log(
    "[config] .env files loaded:",
    loadedFrom.length ? loadedFrom.join(", ") : "(none — using process env only)",
  );

  const results = [];
  let missing = 0;
  for (const key of REQUIRED) {
    const present = !!process.env[key];
    results.push({ key, present });
    if (!present) missing++;
  }

  for (const { key, present } of results) {
    console.log(`  ${present ? "✓" : "✗"} ${key}${present ? " found" : " missing"}`);
  }

  // Safe startup summary — never log secret values.
  console.log("[config] Database configuration:");
  console.log(`  Host:               ${process.env.PGHOST}`);
  console.log(`  Port:               ${process.env.PGPORT}`);
  console.log(`  Database:           ${process.env.PGDATABASE}`);
  console.log(`  User:               ${process.env.PGUSER}`);
  console.log(`  Password configured: ${process.env.PGPASSWORD ? "Yes" : "No"}`);
  console.log(`  SSL mode:           ${process.env.PGSSLMODE || "(disabled)"}`);

  if (missing > 0) {
    console.error(
      `\n[config] FATAL: ${missing} required environment variable(s) missing.\n` +
        `  Copy server/.env.example to server/.env (or project-root .env) and fill in the values.\n` +
        `  Required: ${REQUIRED.join(", ")}`,
    );
    process.exit(1);
  }

  if (!process.env.SESSION_SECRET) {
    console.warn(
      "[config] WARNING: SESSION_SECRET not set — using ephemeral random value. Sessions will not survive restarts.",
    );
  }

  return { loadedFrom, required: REQUIRED, optional: OPTIONAL };
}
