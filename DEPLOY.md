# Self-Hosted Deployment Guide

HDPORNFORYOU is a fully self-hosted video embed site with automated content ingestion, designed for 50k-100k+ daily users on a single mid-range VPS.

- **Frontend:** React 19 + Vite SPA (static build)
- **Backend:** Node.js 20 + Express
- **Database:** PostgreSQL 18
- **Sessions:** Server-side in PostgreSQL (`connect-pg-simple`)
- **Cache:** In-process LRU + TTL + stale-while-revalidate
- **Writes:** In-memory batching for views / ad events / page events (flushed every 30s)
- **Protection:** Per-IP rate limiting, statement timeouts, connection pooling, graceful degradation

---

## 1. Docker Compose (Recommended)

```bash
git clone <your-repo> && cd <repo>
cp .env.example .env

# Generate secrets
sed -i "s/replace-me/$(openssl rand -hex 32)/" .env          # SESSION_SECRET
sed -i "s/replace-me/$(openssl rand -hex 16)/" .env          # PGPASSWORD

# Edit .env — set PGPASSWORD to match what you just generated
vi .env

docker compose up -d --build
```

Services:

| Service                    | Port           | Description                                              |
| -------------------------- | -------------- | -------------------------------------------------------- |
| `hdpornforyou-pg`           | 127.0.0.1:5432 | PostgreSQL (localhost only)                              |
| `hdpornforyou`              | 3001           | Node app (pure API worker — automation disabled)         |
| `hdpornforyou-automation`   | —              | Dedicated automation engine (single instance, never scale) |

Open `http://<vps-ip>:3001` → auto-redirects to `/setup` → create admin → done.

Health check:

```bash
curl http://localhost:3001/api/health
```

### Environment Variables

| Variable                            | Default                                                               | Description                                         |
| ----------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------- |
| `PORT`                              | `3001`                                                                | Express listen port                                 |
| `STATIC_DIR`                        | `/srv/public` (Docker) / `../../dist` from `server/src/` (bare-metal) | Built SPA path                                      |
| `SESSION_SECRET`                    | random                                                                | **Required in production** — `openssl rand -hex 32` |
| `PGHOST`                            | `127.0.0.1`                                                           | PostgreSQL host                                     |
| `PGPORT`                            | `5432`                                                                | PostgreSQL port                                     |
| `PGUSER`                            | `hdpornforyou`                                                         | PostgreSQL user                                     |
| `PGPASSWORD`                        | —                                                                     | **Required**                                        |
| `PGDATABASE`                        | `hdpornforyou`                                                         | Database name                                       |
| `PG_POOL_MAX`                       | CPU×4 (10-50)                                                         | Max DB connections                                  |
| `PG_POOL_MIN`                       | `2`                                                                   | Min DB connections per PM2 worker                   |
| `PG_STATEMENT_TIMEOUT_MS`           | `5000`                                                                | Query timeout (ms)                                  |
| `CLUSTER_WORKERS`                   | `max`                                                                 | PM2 worker count (`max`, `4`, `8`, etc.)            |
| `CACHE_MAX_KEYS`                    | `5000`                                                                | LRU cache max entries                               |
| `BATCH_FLUSH_MS`                    | `30000`                                                               | Write batch flush interval                          |
| `COOKIE_SECURE`                     | `0`                                                                   | Set `1` behind HTTPS proxy                          |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | —                                                                     | Optional: skip setup wizard                         |

---

## 2. Bare-Metal Install (Ubuntu/Debian)

### PostgreSQL

```bash
sudo apt update && sudo apt install -y postgresql-18
sudo -u postgres psql <<SQL
  CREATE USER hdpornforyou WITH PASSWORD 'CHANGE-ME';
  CREATE DATABASE hdpornforyou OWNER hdpornforyou;
SQL
```

### Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### Application

```bash
cd /opt
sudo git clone <your-repo>.git hdpornforyou && cd hdpornforyou

# Frontend build
sudo npm install
sudo npm run build    # produces ./dist

# Server deps
cd server
sudo npm install --omit=dev

# Environment
cp .env.example .env
vi .env   # set PGUSER, PGPASSWORD, SESSION_SECRET, STATIC_DIR=../dist
```

### Run with PM2

Use the bundled **repo-root** `ecosystem.config.cjs` for cluster mode — **do not**
try to cluster `npm` directly (`pm2 start npm -- run start -i 4` does not
work; PM2 needs a real JS entrypoint to fork workers).

The root config resolves `server/src/index.js` and sets `cwd` to `server/`
so the same relative paths (`uploads/favicon`, `schema.sql`, `server/.env`)
work as `cd server && npm start`. A mirror config exists at
`server/ecosystem.config.cjs` for the legacy `cd server && pm2 start …`
workflow.

```bash
sudo npm i -g pm2
cd /opt/hdpornforyou

# 1. Build the SPA at repo root
npm install
npm run build           # produces ./dist

# 2. Start the API + static server (cluster mode, all CPU cores)
CLUSTER_WORKERS=4 \
  PORT=3001 \
  PG_POOL_MAX=5 PG_POOL_MIN=1 \
  PGHOST=127.0.0.1 PGUSER=hdpornforyou PGPASSWORD=CHANGE-ME PGDATABASE=hdpornforyou \
  SESSION_SECRET=$(openssl rand -hex 32) \
  COOKIE_SECURE=1 \
  pm2 start ecosystem.config.cjs

pm2 save && pm2 startup
```

> **Do not** append a `.` (or any other positional arg) after the config
> filename — PM2 treats it as a separate script path and spawns a stray
> fork-mode process named `.` that crashes with `ERR_UNSUPPORTED_DIR_IMPORT`.
> The cluster workers still come up, but the stray process clutters `pm2 list`
> and the error log. Just `pm2 start ecosystem.config.cjs` is enough.

`STATIC_DIR` defaults to the repo-root `dist/` (set explicitly in the
config), so no extra env var is needed when the layout is the standard
`/repo` + `/repo/server` layout.

The config starts **two apps**:

| App                      | Mode        | Instances | Role                                                                 |
| ------------------------ | ----------- | --------- | -------------------------------------------------------------------- |
| `hdpornforyou`            | cluster     | `CLUSTER_WORKERS` / `max` | Serves the SPA + public API + admin APIs (`RUN_AUTOMATION=0` — pure API workers) |
| `hdpornforyou-automation` | fork        | 1         | Dedicated automation engine: import timers/cycles, AI budget, thumbnail scans (`server/src/automation-worker.js`) |

### Dedicated Automation Worker

All automation state — `engineTimer`, `resumeTimer`, `nextCycleAt`, `isRunning`,
`isPaused`, cycle tokens — lives in exactly ONE process
(`hdpornforyou-automation`), so admin settings (`intervalMinutes`,
`aiBatchSize`, `aiDailyLimit`, `dailyImportLimit`, …) are honored precisely
instead of N cluster workers racing for work.

- Admin Start/Stop/Manual/Scan buttons on any API replica write into the
  `automation_commands` table; the automation worker polls it every second
  and executes the action in its own process.
- The engine watchdog re-checks settings every 5s: after a crash + PM2
  restart it re-arms the schedule from DB state, so 24/7 import resumes
  automatically. It also picks up `thumbnailAutoClean` toggles made from any
  replica.
- The PostgreSQL advisory lock stays in place as a **fail-safe**: if the old
  worker is still finishing during a restart window (kill_timeout 8s) or a
  duplicate process ever appears, only one of them can actually import —
  never double-imports, never double AI-spend.
- Single-process deployments keep working unchanged (`cd server && npm start`):
  with `RUN_AUTOMATION` unset the engine runs inside the API process and the
  hooks degrade to direct calls.

### PM2 Cluster Safety

PM2 cluster mode is supported for both normal traffic and the admin import tools.

- Public pages, admin APIs, auth, comments, reactions, video APIs, and VideoImporter requests are load-balanced across all workers.
- Sessions are stored in PostgreSQL through `connect-pg-simple`, so sticky sessions are not required.
- The automation engine runs in the dedicated `hdpornforyou-automation` process; API workers relay admin actions through the `automation_commands` table.
- Automation cycles use a PostgreSQL advisory lock as a fail-safe, so even if a stale/duplicate process tries to run, only one imports videos.
- Start/Stop invalidates stale timers. Old interval callbacks re-check database ownership before running and exit if superseded.
- VideoImporter AI enrichment is request-driven and does not use the automation scheduler. It is safe in cluster mode because each request uses shared OpenRouter fallback and atomic AI daily-limit reservation.
- OpenRouter API fallback is shared by automation and VideoImporter: env key first, then stored keys by priority, retrying the same request on the next key after failures.
- AI request counters are updated atomically in PostgreSQL across all workers. Failed all-key OpenRouter attempts release the reserved counter slot.

After deploying a new cluster build, use the admin UI once to clear any old runtime state:

1. Click `Stop` in Automation.
2. Click `Start`.
3. Confirm status becomes `RUNNING` immediately.
4. Confirm exactly one countdown appears only after the cycle finishes.

### PM2 Worker Sizing Commands

Choose `CLUSTER_WORKERS` based on available CPU cores and RAM. A good baseline is one worker per physical/vCPU core, then tune from monitoring. Do not set workers much higher than CPU cores unless you have measured that the workload is mostly I/O-bound and CPU has headroom.

Recommended starting points:

| Workers | Suggested CPU cores | Suggested `PG_POOL_MAX` | Approx app DB connections | Use case                              |
| ------: | ------------------: | ----------------------: | ------------------------: | ------------------------------------- |
|       4 |             4 cores |                       5 |                        20 | Small/medium VPS, safest default      |
|       6 |             6 cores |                       5 |                        30 | Medium VPS with more traffic          |
|       8 |             8 cores |                     4-5 |                     32-40 | Larger VPS, high traffic              |
|      10 |            10 cores |                       4 |                        40 | High traffic, check Postgres capacity |
|      12 |            12 cores |                     3-4 |                     36-48 | Larger VPS, tune carefully            |

Fresh start commands:

```bash
# 4 workers, suggested for a 4-core VPS
CLUSTER_WORKERS=4 PG_POOL_MAX=5 PG_POOL_MIN=1 pm2 start ecosystem.config.cjs

# 6 workers, suggested for a 6-core VPS
CLUSTER_WORKERS=6 PG_POOL_MAX=5 PG_POOL_MIN=1 pm2 start ecosystem.config.cjs

# 8 workers, suggested for an 8-core VPS
CLUSTER_WORKERS=8 PG_POOL_MAX=4 PG_POOL_MIN=1 pm2 start ecosystem.config.cjs

# 10 workers, suggested for a 10-core VPS
CLUSTER_WORKERS=10 PG_POOL_MAX=4 PG_POOL_MIN=1 pm2 start ecosystem.config.cjs

# 12 workers, suggested for a 12-core VPS
CLUSTER_WORKERS=12 PG_POOL_MAX=3 PG_POOL_MIN=1 pm2 start ecosystem.config.cjs
```

If the app is already running, restart with updated environment:

```bash
# Switch to 4 workers
CLUSTER_WORKERS=4 PG_POOL_MAX=5 PG_POOL_MIN=1 pm2 restart ecosystem.config.cjs --update-env

# Switch to 6 workers
CLUSTER_WORKERS=6 PG_POOL_MAX=5 PG_POOL_MIN=1 pm2 restart ecosystem.config.cjs --update-env

# Switch to 8 workers
CLUSTER_WORKERS=8 PG_POOL_MAX=4 PG_POOL_MIN=1 pm2 restart ecosystem.config.cjs --update-env

# Switch to 10 workers
CLUSTER_WORKERS=10 PG_POOL_MAX=4 PG_POOL_MIN=1 pm2 restart ecosystem.config.cjs --update-env

# Switch to 12 workers
CLUSTER_WORKERS=12 PG_POOL_MAX=3 PG_POOL_MIN=1 pm2 restart ecosystem.config.cjs --update-env
```

Full example with required production variables:

```bash
CLUSTER_WORKERS=8 \
PORT=3001 \
PG_POOL_MAX=4 \
PG_POOL_MIN=1 \
PGHOST=127.0.0.1 \
PGUSER=hdpornforyou \
PGPASSWORD=CHANGE-ME \
PGDATABASE=hdpornforyou \
SESSION_SECRET=your-existing-session-secret \
COOKIE_SECURE=1 \
pm2 start ecosystem.config.cjs
```

For restarts, keep the same required environment values available through your shell, PM2 ecosystem environment, or server `.env`. Use `--update-env` whenever changing worker or pool values.

### Reverse Proxy (Caddy)

The Node server listens on `PORT` (default **3001**) and serves both the
API and the built SPA. Proxy to that port — never to `5173` (Vite dev
only; nothing listens there in production, which is the cause of `502 Bad
Gateway`).

```caddyfile
hdpornforyou.example.com {
    encode zstd gzip

    reverse_proxy 127.0.0.1:3001

    # SECURITY: Express (helmet) is the single source for security headers
    # (CSP, Permissions-Policy, etc.). Do NOT add them here — duplicating
    # Permissions-Policy/CSP across Caddy and Node produces duplicate
    # headers that browsers reject.

    log {
        output file /var/log/caddy/hdpornforyou-access.log
        format json
    }
}
```

For accurate, zero-cost ad GEO routing, proxy the domain through Cloudflare
(orange-cloud DNS). Cloudflare adds `CF-IPCountry`; Caddy forwards that header
to Node automatically, and `/api/geo` uses it without a third-party lookup or
GeoIP database. Set Cloudflare SSL/TLS mode to **Full (strict)**.

Protect the origin so clients cannot bypass Cloudflare and spoof country
headers. Prefer Cloudflare Tunnel, or restrict public HTTP/HTTPS access to
Cloudflare's published IP ranges. Keep Node bound to `127.0.0.1:3001` and never
expose PostgreSQL publicly.

For a LAN/IP host with self-signed TLS:

```caddyfile
192.168.100.10 {
    tls internal
    encode zstd gzip
    reverse_proxy 127.0.0.1:3001
}
```

Remember to set `COOKIE_SECURE=1` when fronting with HTTPS.

---

## 3. PostgreSQL Tuning

Safe ratios for different VPS sizes:

| VPS RAM | shared_buffers | effective_cache_size | work_mem | max_connections |
| ------- | -------------- | -------------------- | -------- | --------------- |
| 2 GB    | 256 MB         | 1 GB                 | 4 MB     | 100             |
| 4 GB    | 512 MB         | 1.5 GB               | 8 MB     | 200             |
| 8 GB    | 2 GB           | 4 GB                 | 16 MB    | 300             |
| 16 GB   | 4 GB           | 10 GB                | 32 MB    | 500             |

Each PM2 worker creates its own PostgreSQL pool. Total possible app connections are approximately:

```text
CLUSTER_WORKERS × PG_POOL_MAX
```

Recommended PM2 pool baselines:

| PM2 workers | Suggested `PG_POOL_MAX` | Suggested `PG_POOL_MIN` | Approx app DB connections |
| ----------: | ----------------------: | ----------------------: | ------------------------: |
|           2 |                       8 |                       1 |                        16 |
|           4 |                       5 |                       1 |                        20 |
|           6 |                       5 |                       1 |                        30 |
|           8 |                     4-5 |                       1 |                     32-40 |
|          10 |                       4 |                       1 |                        40 |
|          12 |                     3-4 |                       1 |                     36-48 |

Keep total app connections below PostgreSQL `max_connections`, leaving room for `psql`, migrations, backups, monitoring, and admin tools. For most VPS deployments, start with:

```bash
CLUSTER_WORKERS=4
PG_POOL_MAX=5
PG_POOL_MIN=1
```

Only increase `PG_POOL_MAX` after checking `/api/health`, PM2 CPU/memory, PostgreSQL active connections, and query latency.

---

## 4. Backups

```bash
# Dump
docker compose exec -T postgres pg_dump -U hdpornforyou hdpornforyou \
  | gzip > backup-$(date +%F).sql.gz

# Restore
gunzip -c backup-YYYY-MM-DD.sql.gz \
  | docker compose exec -T postgres psql -U hdpornforyou hdpornforyou
```

---

## 5. Key Architecture

### Automation Engine

- **Purpose:** Automated video ingestion from Eporner API
- **Flow:** Fetch videos by keyword → AI enrichment (OpenRouter) → DB store
- **Settings:** Configurable batch size, interval, daily limits, AI model
- **Control:** Start/stop via admin UI or API (`/api/admin/import/start|stop`)
- **Safety:** `stopRequested` flag checked at all loop points; daily AI limit with auto-pause
- **Dedicated worker:** All timers/state live in the single `hdpornforyou-automation` process (PM2 fork, auto-restart), or inline in single-process mode. Admin actions arrive via the `automation_commands` relay. The PostgreSQL advisory lock remains a fail-safe against double-imports during restart windows.
- **Counters:** AI request usage is atomic in PostgreSQL and shared with VideoImporter

### Thumbnail Cleanup

- **Manual:** Admin button scans all videos via browser `Image()` — removes dead thumbnails
- **Auto 24h:** Server-side scan fetches each thumbnail URL, deletes videos with dead thumbnails
- **Toggle:** Admin settings → "Auto-clean 24h: ON/OFF"

### VAST Ads

- **Player:** FluidPlayer v3 (CDN, CSS bundled in JS)
- **VAST tags:** ExoClick (Tier-2/3 GEO) / TrafficStars (Tier-1 GEO)
- **Geo routing:** Timezone + `__EMBED_COUNTRY__` detection → tier assignment
- **16 placements:** homeBannerTop, homeNativeFeed, watchSidebar, watchAbove, watchUnder, searchBanner, searchNative, trendingNative, relatedNative, accountBanner, accountNative, watchOutstream, interstitial, videoSlider, sticky, popunder

### Admin URL Prefix

- Default: `/admin`
- Custom prefix configurable in admin settings
- Server auto-redirects `/admin` → `/{prefix}`

---

## 6. API Reference

### Public Endpoints

| Method | Path                    | Description                     |
| ------ | ----------------------- | ------------------------------- |
| `GET`  | `/api/config`           | Returns `{ adminPrefix }`       |
| `GET`  | `/api/setup/status`     | Setup wizard status             |
| `POST` | `/api/setup/initialize` | Create admin user               |
| `POST` | `/api/auth/login`       | Admin login                     |
| `POST` | `/api/auth/logout`      | Admin logout                    |
| `GET`  | `/api/auth/me`          | Current admin                   |
| `GET`  | `/api/videos`           | List videos (paginated)         |
| `GET`  | `/api/videos/:id`       | Get single video                |
| `POST` | `/api/videos/:id/view`  | Increment view count            |
| `GET`  | `/api/categories`       | List categories                 |
| `GET`  | `/api/settings/ads`     | Ad configuration                |
| `POST` | `/api/ads/event`        | Log ad event                    |
| `GET`  | `/api/ads/stats`        | Ad statistics                   |
| `GET`  | `/api/health`           | Health + pool/cache/batch stats |

### Admin Endpoints

| Method                  | Path                                | Description                     |
| ----------------------- | ----------------------------------- | ------------------------------- |
| `GET/POST/PUT/DELETE`   | `/api/admin/settings`               | Automation settings             |
| `POST`                  | `/api/admin/ai/enrich`              | AI enrichment for VideoImporter |
| `GET/POST/PUT/DELETE`   | `/api/admin/keywords`               | Import keywords                 |
| `POST`                  | `/api/admin/import/start`           | Start automation                |
| `POST`                  | `/api/admin/import/stop`            | Stop automation                 |
| `POST`                  | `/api/admin/import/manual`          | Trigger manual cycle            |
| `GET`                   | `/api/admin/import/status`          | Automation status               |
| `POST`                  | `/api/admin/import/scan-thumbnails` | Trigger thumbnail scan          |
| `GET`                   | `/api/admin/import/logs`            | Import logs                     |
| `DELETE`                | `/api/admin/import/logs`            | Clear logs                      |
| `GET/POST`              | `/api/admin/api-keys`               | OpenRouter API keys             |
| `GET`                   | `/api/admin/openrouter/models`      | Available AI models             |
| `GET/PUT/DELETE`        | `/api/videos/:id`                   | Video CRUD                      |
| `PUT`                   | `/api/videos`                       | Bulk video import               |
| `GET/POST/PUT/DELETE`   | `/api/categories`                   | Category CRUD                   |
| `GET/POST/PATCH/DELETE` | `/api/comments`                     | Comment moderation              |

---

## 7. Database Schema

| Table             | Purpose                             |
| ----------------- | ----------------------------------- |
| `users`           | Admin accounts                      |
| `videos`          | Video catalog (JSONB `data` column) |
| `comments`        | User comments                       |
| `reactions`       | Video reactions (like/dislike)      |
| `saved_videos`    | User watchlists                     |
| `sessions`        | PostgreSQL-backed sessions          |
| `settings`        | Key-value config store              |
| `import_keywords` | Automation keyword targets          |
| `import_logs`     | Automation import logs              |
| `thumbnail_queue` | Thumbnail health status             |

Key indexes: JSONB GIN on `videos.data`, composite on `(comments.video_id, created_at DESC)`, functional `LOWER()` indexes for case-insensitive lookups.

---

## 8. Troubleshooting

| Issue                                                                                                   | Fix                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PGPASSWORD missing`                                                                                    | Set `PGPASSWORD` in `.env` or `docker-compose.yml`                                                                                                                                                                                                        |
| Session cookie not working                                                                              | Set `COOKIE_SECURE=1` behind HTTPS, `0` for HTTP                                                                                                                                                                                                          |
| Admin 401 on all requests                                                                               | Check `SESSION_SECRET` is set                                                                                                                                                                                                                             |
| Automation not starting                                                                                 | Check AI daily limit not reached; check OpenRouter API keys                                                                                                                                                                                               |
| Thumbnails failing                                                                                      | Check Eporner API access; check network from VPS                                                                                                                                                                                                          |
| AI enrichment failing                                                                                   | Verify OpenRouter API key in admin → API Keys                                                                                                                                                                                                             |
| Caddy / nginx returns `502 Bad Gateway`                                                                 | Proxy target must be the **Node** port (default `3001`), not Vite's `5173`. `5173` only exists during `npm run dev`.                                                                                                                                      |
| Refreshing `/watch/...`, `/category/...`, or the admin prefix shows 404                                 | You are serving `dist/` directly instead of the Express server. Proxy all production traffic to `127.0.0.1:3001`; Express serves `dist/index.html` for non-API routes.                                                                                    |
| Blank page on first load, OK after refresh                                                              | Express isn't serving the SPA — usually because `STATIC_DIR` points at an empty folder. Run `npm run build` at the repo root and keep the default `STATIC_DIR` (resolves to `../../dist` from `server/src/`), or set `STATIC_DIR=/absolute/path/to/dist`. |
| `pm2 start npm -- run start -i 4` shows running but Caddy still 502s                                    | Don't cluster `npm`. Use `pm2 start ecosystem.config.cjs` (from repo root) — it points to `server/src/index.js` and clusters cleanly.                                                                                                                     |
| `pm2 start ecosystem.config.cjs .` shows a stray `.` process crashing with `ERR_UNSUPPORTED_DIR_IMPORT` | Drop the trailing `.`. PM2 treats it as a separate script path and spawns a fork-mode process on the directory. `pm2 start ecosystem.config.cjs` is enough.                                                                                               |
| Port conflict                                                                                           | Change `PORT` in `.env`                                                                                                                                                                                                                                   |
