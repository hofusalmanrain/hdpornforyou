// PM2 cluster config — run from the project root:
//   pm2 start ecosystem.config.cjs
//
// This file is fully self-contained. It does NOT depend on any other file,
// so it works even if server/ecosystem.config.cjs is deleted.
//
// Sessions are stored in PostgreSQL via connect-pg-simple, so sticky
// sessions are NOT required and cluster mode is safe.
const path = require("node:path");

module.exports = {
  apps: [
    {
      name: "hdpornforyou",
      // Entry point lives under server/src — resolve relative to this file
      // so the command works no matter what cwd it was launched from.
      script: path.resolve(__dirname, "server/src/index.js"),
      // Run with the server/ folder as cwd so the in-process relative
      // paths (uploads/favicon, schema.sql, server/.env) resolve the
      // same way they do under `cd server && npm start`.
      cwd: path.resolve(__dirname, "server"),
      instances: process.env.CLUSTER_WORKERS || "max",
      exec_mode: "cluster",
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: process.env.PORT || 3001,
        // HOST=127.0.0.1 binds the API to loopback only — the reverse proxy
        // (Caddy) is the only thing allowed to reach it from the network.
        HOST: process.env.HOST || "127.0.0.1",
        // RUN_AUTOMATION=0 turns these workers into pure API replicas: every
        // automation timer/import lives in hdpornforyou-automation below.
        RUN_AUTOMATION: "0",
        // STATIC_DIR resolves to the repo-root ./dist (the Vite build
        // output). server/src/index.js already defaults to ../../dist
        // from its own __dirname, but we set it explicitly so there is
        // no ambiguity under PM2.
        STATIC_DIR: process.env.STATIC_DIR || path.resolve(__dirname, "dist"),
        // PUBLIC_DIR is the Vite "public/" folder. Files dropped here
        // (e.g. exoclick.html) are served immediately without a rebuild.
        PUBLIC_DIR: process.env.PUBLIC_DIR || path.resolve(__dirname, "public"),
        DATABASE_URL: process.env.DATABASE_URL,
        PGHOST: process.env.PGHOST,
        PGPORT: process.env.PGPORT,
        PGUSER: process.env.PGUSER,
        PGPASSWORD: process.env.PGPASSWORD,
        PGDATABASE: process.env.PGDATABASE,
        PGSSLMODE: process.env.PGSSLMODE,
        PG_POOL_MAX: process.env.PG_POOL_MAX,
        PG_POOL_MIN: process.env.PG_POOL_MIN,
        PG_STATEMENT_TIMEOUT_MS: process.env.PG_STATEMENT_TIMEOUT_MS,
        PG_CONN_TIMEOUT_MS: process.env.PG_CONN_TIMEOUT_MS,
        PG_IDLE_TIMEOUT_MS: process.env.PG_IDLE_TIMEOUT_MS,
        SESSION_SECRET: process.env.SESSION_SECRET,
        COOKIE_SECURE: process.env.COOKIE_SECURE,
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
        ADMIN_USERNAME: process.env.ADMIN_USERNAME,
        ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
      },
      // Give the batcher + automation timers time to flush on shutdown.
      kill_timeout: 8000,
      wait_ready: false,
      watch: false,
    },
    {
      // Dedicated automation engine: EXACTLY ONE process owns all engine
      // timers, import cycles and thumbnail scans. PM2 restarts it on crash;
      // the engine watchdog re-arms the schedule from DB state, so imports
      // resume automatically. The Postgres advisory lock remains a fail-safe
      // against double-imports during restart windows.
      name: "hdpornforyou-automation",
      script: path.resolve(__dirname, "server/src/automation-worker.js"),
      cwd: path.resolve(__dirname, "server"),
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        RUN_AUTOMATION: "1",
        DATABASE_URL: process.env.DATABASE_URL,
        PGHOST: process.env.PGHOST,
        PGPORT: process.env.PGPORT,
        PGUSER: process.env.PGUSER,
        PGPASSWORD: process.env.PGPASSWORD,
        PGDATABASE: process.env.PGDATABASE,
        PGSSLMODE: process.env.PGSSLMODE,
        PG_POOL_MAX: process.env.PG_POOL_MAX,
        PG_POOL_MIN: process.env.PG_POOL_MIN,
        PG_STATEMENT_TIMEOUT_MS: process.env.PG_STATEMENT_TIMEOUT_MS,
        PG_CONN_TIMEOUT_MS: process.env.PG_CONN_TIMEOUT_MS,
        PG_IDLE_TIMEOUT_MS: process.env.PG_IDLE_TIMEOUT_MS,
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      },
      kill_timeout: 8000,
      wait_ready: false,
      watch: false,
    },
  ],
};
