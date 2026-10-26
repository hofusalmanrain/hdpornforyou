// PM2 cluster config — run from the /server directory:
//   cd server && pm2 start ecosystem.config.cjs
//
// This file is fully self-contained. It does NOT depend on the root
// ecosystem.config.cjs, so it works even if that file is deleted.
//
// Sessions are stored in PostgreSQL via connect-pg-simple, so sticky
// sessions are NOT required and cluster mode is safe.
const path = require("node:path");

module.exports = {
  apps: [
    {
      name: "hdpornforyou",
      script: "src/index.js",
      cwd: __dirname,
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
        // STATIC_DIR defaults to the repo-root ./dist (the Vite build output).
        STATIC_DIR: process.env.STATIC_DIR || path.resolve(__dirname, "../dist"),
        // PUBLIC_DIR is the Vite "public/" folder — files dropped here are
        // served immediately without a rebuild.
        PUBLIC_DIR: process.env.PUBLIC_DIR || path.resolve(__dirname, "../public"),
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
      script: "src/automation-worker.js",
      cwd: __dirname,
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
