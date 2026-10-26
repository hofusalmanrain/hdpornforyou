# HDPORNFORYOU — VPS Edition

Self-hosted full-stack video embed platform with automated content ingestion.

**Stack:** React 19 + Vite SPA (frontend) · Node.js 20 + Express (backend) · PostgreSQL 18 · session-cookie auth · no browser storage · no external services.

## Layout

```
/                  React + Vite SPA
/server            Express API + PostgreSQL
/server/src/       Server source (index.js, automation.js, db.js, etc.)
/dist              Vite build output (served by Express in production)
```

## Quick Start (Development)

```bash
npm install
npm run dev
```

Vite (5173) + Express API (3001) run concurrently. Open http://localhost:5173.

## Production Build

```bash
npm install                  # installs root + server (postinstall)
npm run build                # builds the SPA to ./dist
npm start                    # runs Express on :3001, serves ./dist
```

The Express server serves the built SPA **and** the API on a single port
(default `3001`). Point your reverse proxy (nginx/Caddy) at
`http://127.0.0.1:3001` — **not** `5173` (that's Vite dev only).

### PM2 (cluster mode)

```bash
cd server
PORT=3001 \
  PGHOST=127.0.0.1 PGUSER=hdpornforyou PGPASSWORD=CHANGE-ME PGDATABASE=hdpornforyou \
  SESSION_SECRET=$(openssl rand -hex 32) \
  COOKIE_SECURE=1 \
  pm2 start ecosystem.config.cjs
pm2 save && pm2 startup
```

> Do **not** use `pm2 start npm -- run start -i 4`. PM2 cannot cluster `npm`
> reliably; use the ecosystem file (it points to `src/index.js`).

### Caddy

```caddyfile
your.domain {
    encode zstd gzip

    reverse_proxy 127.0.0.1:3001

    header {
        X-Content-Type-Options nosniff
        Referrer-Policy strict-origin-when-cross-origin
        Permissions-Policy "camera=(), microphone=(), geolocation=()"
    }

    log {
        output file /var/log/caddy/hdpornforyou-access.log
        format json
    }
}
```

For HTTPS make sure to set `COOKIE_SECURE=1` in the server env.

For accurate free ad GEO routing, enable Cloudflare's orange-cloud proxy and
set SSL/TLS mode to **Full (strict)**. Cloudflare supplies `CF-IPCountry`, Caddy
forwards it automatically, and the app reads it from `/api/geo`. Caddy by itself
does not determine visitor countries. Prevent direct access to the origin with
Cloudflare Tunnel or firewall rules restricted to Cloudflare IP ranges; keep
Node bound to `127.0.0.1:3001`.

Refresh/deep links are handled by the Express production server: every non-API
route falls back to `dist/index.html`. In production, Caddy/nginx must proxy to
the Node port (`3001`), not the Vite dev port (`5173`).

## Docker Compose

```bash
cp .env.example .env
# edit .env: set SESSION_SECRET, PGPASSWORD
docker compose up -d --build
```

Services:

- `hdpornforyou-pg` — PostgreSQL 18 (localhost:5432 only)
- `hdpornforyou` — Node app (port 3001)

## Environment Variables

| Var                                 | Default                                 | Purpose                                          |
| ----------------------------------- | --------------------------------------- | ------------------------------------------------ |
| `PORT`                              | `3001`                                  | Express port                                     |
| `STATIC_DIR`                        | `../dist` (resolved from `server/src/`) | Built SPA folder served by Express               |
| `SESSION_SECRET`                    | random                                  | **Set in production**                            |
| `PGHOST` / `PGPORT`                 | localhost / 5432                        | PostgreSQL connection                            |
| `PGUSER` / `PGPASSWORD`             | —                                       | PostgreSQL credentials                           |
| `PGDATABASE`                        | `hdpornforyou`                           | Database name                                    |
| `PG_POOL_MAX`                       | CPU×4 (10-50)                           | Max DB connections                               |
| `PG_POOL_MIN`                       | `2`                                     | Min DB connections per PM2 worker                |
| `PG_STATEMENT_TIMEOUT_MS`           | `5000`                                  | Query timeout                                    |
| `CLUSTER_WORKERS`                   | `max`                                   | PM2 cluster worker count (`max`, `4`, `8`, etc.) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | —                                       | Optional first-admin bootstrap                   |

## PM2 Cluster And DB Pooling

PM2 cluster mode is supported. Start from the repo root with:

```bash
CLUSTER_WORKERS=4 \
PG_POOL_MAX=5 \
PG_POOL_MIN=1 \
pm2 start ecosystem.config.cjs
```

Traffic and background work behave differently in cluster mode:

- Normal HTTP/API traffic is load-balanced across all PM2 workers.
- Sessions are stored in PostgreSQL, so sticky sessions are not required.
- Automation is single-owner: only one worker owns the active countdown and only one worker can run an automation cycle at a time.
- Stale automation timers from older workers or old Start clicks check DB ownership and exit without running.
- VideoImporter AI enrichment is request-based; each request runs on one worker and uses the same OpenRouter fallback/counter logic.
- AI request counting is atomic in PostgreSQL across all workers, so concurrent automation and VideoImporter requests share the daily limit safely.

Each PM2 worker creates its own PostgreSQL connection pool. Total possible DB connections are roughly:

```text
CLUSTER_WORKERS × PG_POOL_MAX
```

Recommended starting values:

| PM2 workers | Suggested `PG_POOL_MAX` | Approx app DB connections |
| ----------: | ----------------------: | ------------------------: |
|           2 |                       8 |                        16 |
|           4 |                       5 |                        20 |
|           8 |                     4-5 |                     32-40 |

Keep total app connections below PostgreSQL `max_connections`, leaving room for `psql`, migrations, backups, and admin tools. For most VPS deployments, `CLUSTER_WORKERS=4 PG_POOL_MAX=5 PG_POOL_MIN=1` is a safe baseline.

## Setup Wizard

On first deploy, visit `/setup` (or any page — auto-redirects). Create the admin user. Runs only once.

## Admin Prefix

Default admin URL is `/admin`. Change in admin settings to a custom prefix (e.g. `my-panel` → `/my-panel`). The server redirects `/admin` → `/{prefix}` automatically.

## Features

### Video Catalog

- Admin CRUD for videos (title, description, category, tags, slug, thumbnail, embed URL)
- Bulk import via CSV/JSON
- VideoImporter: search Eporner API, preview with thumbnails, AI enrichment, select & import
- Category management with 19 default categories (anal, blowjob, creampie, milf, teen, lesbian, threesome, gangbang, solo, bdsm, pov, amateur, bigtits, bigass, squirt, orgy, interracial, vintage, compilation)

### AI Enrichment (OpenRouter)

- Generates SEO title, description, tags, and category for each video
- Sends batch of videos to OpenRouter API (model configurable, default: openai/gpt-4o-mini)
- Dynamic max_tokens: `batch × 350 + 500` (min 8000) to prevent truncation
- Retry logic: up to 2 retries for missing videos per batch
- API key fallback: env key → stored keys by priority → next key on auth, quota, rate-limit, timeout, server, network, or request failure
- Daily AI request limit (default 50), shared atomically by automation and VideoImporter across PM2 workers

### Automation Engine (`server/src/automation.js`)

- Fixed-interval video ingestion: Eporner fetch → AI SEO → DB store
- Configurable batch size, interval, daily import limit
- `stopRequested` flag checked at all loop points (keyword, page, batch)
- Already-in-DB videos filtered before processing
- `saveSettings` reads existing settings first (no overwrite with defaults)
- Scheduler: `scheduleNext()` for import cycles, `scheduleThumbnailCleanup()` for 24h thumbnail scan
- PM2 cluster safe: schedule ownership is persisted in PostgreSQL, stale timers exit, and cycles use a PostgreSQL advisory lock
- Runtime state and daily counters are persisted in PostgreSQL `settings` table

### Manual Import (VideoImporter)

- Search Eporner with configurable query, page size, thumbnail size, sort order, quality
- Preview videos with thumbnails before import
- AI enrichment sends only missing videos each attempt (up to 5 retries)
- Category validation against configured categories

### VAST Ads

- FluidPlayer v3 CDN (JS bundles CSS automatically — no separate CSS file)
- Preroll VAST tags: ExoClick (Tier-2/3) / TrafficStars (Tier-1)
- Imperative `<video>` creation inside `<div ref>` (React StrictMode safe)
- SPA navigation: resets ad phase when video changes
- `start()` recomputes VAST tag via `hydrateAds()` to avoid stale closures
- `onDone` uses `useRef` pattern (not inline function dependency)

### Ad Routing (`src/lib/ad-router.ts`)

- Shared `detectGeoTier()` from `src/lib/geo.ts` (timezone + `__EMBED_COUNTRY__`)
- 16 placements: homeBannerTop, homeNativeFeed, watchSidebar, watchAbove, watchUnder, searchBanner, searchNative, trendingNative, relatedNative, accountBanner, accountNative, watchOutstream, interstitial, videoSlider, sticky, popunder
- Tier-1 (US/UK/CA/AU/EU): TrafficStars zones
- Tier-2/3 (Asia, LATAM, etc.): ExoClick zones

### Thumbnail Cleanup

- **Manual**: Admin button scans all videos, removes dead thumbnails (browser Image() check, no CORS)
- **Auto 24h**: Server-side `runThumbnailScan()` fetches each thumbnail URL, deletes videos with dead thumbnails from DB
- Toggle in admin settings → re-triggers scheduler on save

### Performance

- PostgreSQL with dynamic pool sizing (CPU×4, clamped 10-50)
- LRU + TTL + stale-while-revalidate cache on hot reads
- In-memory write batching for views, ad events, page events (flush every 30s)
- Statement timeout (5s default), graceful degradation
- Per-IP rate limiting on sensitive endpoints

## API Endpoints

### Public

- `GET /api/config` — returns `{ adminPrefix }`
- `GET /api/setup/status` · `POST /api/setup/initialize`
- `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me`
- `GET /api/videos` · `GET /api/videos/:id` · `POST /api/videos/:id/view`
- `GET /api/categories` · `GET /api/settings/ads`
- `POST /api/ads/event` · `GET /api/ads/stats`
- `GET /api/health`

### Admin (requireAdmin)

- `GET|POST|PUT|DELETE /api/admin/settings` — automation settings
- `POST /api/admin/ai/enrich` — AI enrichment for VideoImporter
- `GET|POST|PUT|DELETE /api/admin/keywords` — import keywords
- `POST /api/admin/import/start|stop` — automation control
- `POST /api/admin/import/manual` — trigger manual cycle
- `GET /api/admin/import/status` — automation status
- `POST /api/admin/import/scan-thumbnails` — trigger thumbnail scan
- `GET /api/admin/import/logs` — import logs
- `DELETE /api/admin/import/logs` — clear logs
- `GET|POST /api/admin/api-keys` — OpenRouter API keys
- `GET /api/admin/openrouter/models` — available AI models
- `GET|PUT|DELETE /api/videos/:id` · `PUT /api/videos` (bulk)
- `GET|POST|PUT|DELETE /api/categories`
- `GET|POST|PATCH|DELETE /api/comments`
- `GET /api/settings/:key` · `PUT /api/settings/:key`

## Database Schema

Tables: `users`, `videos`, `comments`, `reactions`, `saved_videos`, `sessions`, `settings`, `import_keywords`, `import_logs`, `thumbnail_queue`

Key indexes: JSONB GIN on `videos.data`, composite on `(comments.video_id, created_at DESC)`, `LOWER()` functional indexes for case-insensitive lookups.

## File Structure

```
src/
├── routes/
│   ├── admin.tsx          — Admin dashboard (catalog, settings, logs)
│   ├── watch.$slug.tsx    — Watch page with above-player ads
│   └── setup.tsx          — First-run setup wizard
├── components/
│   ├── site/
│   │   ├── Player.tsx     — FluidPlayer + VAST overlay (StrictMode safe)
│   │   └── AdProvider.tsx — FluidPlayer CDN loader
│   └── admin/
│       ├── VideoImporter.tsx  — Eporner search + AI enrichment
│       ├── AutoImporter.tsx   — Automation settings UI
│       └── AdsEditor.tsx      — Ad configuration editor
├── lib/
│   ├── ads-config.ts      — VAST tag selection, ad settings cache
│   ├── ad-router.ts       — GEO-based ad zone routing (16 placements)
│   ├── geo.ts             — Shared timezone/GEO tier detection
│   ├── api-client.ts      — API client with error handling
│   ├── auto-import-store.ts — Automation state management
│   └── video-store.ts     — Video cache + CRUD
server/
├── src/
│   ├── index.js           — Express app, routes, middleware
│   ├── automation.js      — Import engine, AI calls, thumbnail scan
│   ├── db.js              — PostgreSQL pool, helpers, schema runner
│   ├── schema.sql         — Database schema (idempotent)
│   ├── cache.js           — LRU + TTL + stale-while-revalidate
│   ├── batch.js           — Write batching (views, events)
│   └── rate-limit.js      — Per-IP rate limiting
```

## Deployment

See [DEPLOY.md](./DEPLOY.md) for detailed VPS deployment instructions (Docker Compose and bare-metal with PM2).
