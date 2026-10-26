// HDPORNFORYOU — self-hosted Node.js + PostgreSQL backend.
// All previously-SQLite endpoints translated to parameterized PG queries,
// wrapped in: LRU+TTL cache (stale-while-revalidate), in-memory write
// batching (views / ad_events / page_events), rate limiting, statement
// timeouts, and graceful degradation (stale cache on DB failure).
//
// Public HTTP contract is BYTE-IDENTICAL to v13 — every response field,
// status code, and behavior preserved so the existing frontend works
// without changes.

// Load + validate environment BEFORE any module that touches process.env
// (notably ./db.js which builds the pg Pool at import time).
import { validateEnv } from "./config.js";
validateEnv();

import express from "express";
import session from "express-session";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import bcrypt from "bcryptjs";
import ConnectPgSimple from "connect-pg-simple";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import { pool, q, one, many, tx, applySchema, hasAnyAdmin, waitForDb, poolStats } from "./db.js";
import { cached, invalidate, invalidatePrefix, cacheStats } from "./cache.js";
import {
  bufferView,
  bufferAdEvent,
  bufferPageEvent,
  startBatcher,
  flushAll,
  batchStats,
} from "./batch.js";
import { rateLimit } from "./rate-limit.js";
import { isSeoShellRequest, renderSeoShell, injectSeoShell } from "./seo-render.js";
import { AD_RETENTION_DAYS, startRetentionCleanup } from "./retention.js";
import {
  getSettings as getAutoSettings,
  saveSettings as saveAutoSettings,
  getKeywords,
  addKeyword,
  deleteKeyword,
  updateKeyword,
  getStatus as getAutoStatus,
  startAutomation,
  stopAutomation,
  triggerManualImport,
  triggerThumbnailScan,
  getLogs,
  clearLogs,
  initAutomation,
  fetchOpenRouterModels,
  getApiKeys,
  saveApiKeys,
  enrichInChunks,
  setAiCounterValue,
  fetchCategorySlugs,
  enqueueAutomationCommand,
  bumpVideosEpoch,
} from "./automation.js";

// When RUN_AUTOMATION=0 this process is a pure API worker: the automation
// engine timers/imports run in the dedicated automation worker process, and
// admin actions below are relayed through the automation_commands table.
const AUTOMATION_WORKER_MODE = process.env.RUN_AUTOMATION === "0";

// Worker-mode only: poll the shared status until it satisfies the predicate
// (i.e. until the dedicated automation process has actually applied the
// relayed command), then return the final snapshot. Falls back to the last
// observed snapshot after the timeout so the endpoint never hangs.
async function waitForAutomationStatus(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  do {
    last = await getAutoStatus();
    if (predicate(last.status)) return last;
    await new Promise((r) => setTimeout(r, 150));
  } while (Date.now() < deadline);
  return last;
}

const PORT = Number(process.env.PORT || 3001);
const BCRYPT_ROUNDS = 12;
// Default to the Vite build output at repo-root /dist (server lives in /server/src).
const STATIC_DIR = process.env.STATIC_DIR
  ? path.resolve(process.env.STATIC_DIR)
  : path.resolve(__dirname, "../../dist");
// The Vite "public/" folder. Files dropped here (e.g. exoclick.html,
// ads.txt, robots.txt) are served directly without a rebuild — mirroring
// Vite's dev-server behaviour in production.
const PUBLIC_DIR = process.env.PUBLIC_DIR
  ? path.resolve(process.env.PUBLIC_DIR)
  : path.resolve(__dirname, "../../public");
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

if (!process.env.SESSION_SECRET) {
  console.warn(
    "[server] SESSION_SECRET not set — using ephemeral secret. Sessions will be invalidated on restart.",
  );
}

// ---------------- Boot: wait for PG, apply schema, seed admin ----------------
await waitForDb();
await applySchema();

if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD && !(await hasAnyAdmin())) {
  await q(
    `INSERT INTO admins (username, password_hash) VALUES ($1, $2)
     ON CONFLICT (username) DO NOTHING`,
    [process.env.ADMIN_USERNAME, bcrypt.hashSync(process.env.ADMIN_PASSWORD, BCRYPT_ROUNDS)],
  );
  console.log(`[server] Seeded admin "${process.env.ADMIN_USERNAME}" from env`);
}

startBatcher();
startRetentionCleanup();
// In worker mode the automation engine lives in the dedicated automation
// process (server/src/automation-worker.js) — API workers must not start it.
if (!AUTOMATION_WORKER_MODE) {
  initAutomation().catch((e) => console.error("[server] automation init error:", e));
}

// ---------------- Express ----------------
const app = express();
const PgSession = ConnectPgSimple(session);

// Country headers are supplied by the CDN/reverse proxy (for example
// Cloudflare's CF-IPCountry). No third-party lookup or per-request API call.
app.get("/api/geo", (req, res) => {
  const candidates = [
    req.get("cf-ipcountry"),
    req.get("cloudfront-viewer-country"),
    req.get("x-country-code"),
  ];
  const country = candidates.find((value) => /^[A-Za-z]{2}$/.test(value || ""));
  res.set("Cache-Control", "private, max-age=3600");
  res.json({ country: country ? country.toUpperCase() : null });
});

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        fontSrc: ["'self'", "https:", "data:"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
        frameSrc: ["'self'", "https:", "data:", "blob:"],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https:", "data:", "blob:"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "https:", "'unsafe-inline'"],
        styleSrcAttr: ["'unsafe-inline'"],
        connectSrc: ["'self'", "https:", "wss:", "ws:", "data:", "blob:"],
        mediaSrc: ["'self'", "https:", "data:", "blob:"],
        workerSrc: ["'self'", "blob:"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true },
  }),
);
// Permissions-Policy is not set by helmet — add manually per DEPLOY.md / instruction.
app.use((req, res, next) => {
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(morgan("tiny", { skip: (req) => req.url.startsWith("/api/health") }));
app.use(express.json({ limit: "10mb" }));
const allowedOrigins = new Set(
  String(process.env.ALLOWED_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
app.use(
  cors((req, callback) => {
    callback(null, {
      credentials: true,
      origin(origin, originCallback) {
        const host = String(req.headers.host || "");
        let sameOrigin = false;
        try {
          sameOrigin = !!origin && new URL(origin).host === host;
        } catch {
          sameOrigin = false;
        }
        const localDevOrigin =
          typeof origin === "string" && /^https?:\/\/(localhost|127\.0\.0\.1):5173$/.test(origin);
        if (!origin || sameOrigin || localDevOrigin || allowedOrigins.has(origin)) {
          return originCallback(null, true);
        }
        return originCallback(new Error("Origin not allowed"));
      },
    });
  }),
);
app.use(
  session({
    store: new PgSession({ pool, tableName: "session", createTableIfMissing: false }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.COOKIE_SECURE === "1",
      maxAge: 1000 * 60 * 60 * 24 * 30,
    },
  }),
);

const uid = () => crypto.randomBytes(8).toString("hex");

function requireAdmin(req, res, next) {
  if (!req.session.admin) return res.status(401).json({ error: "Admin required" });
  next();
}
function requireUser(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Login required" });
  next();
}

// Wrap async handlers so thrown errors return JSON 500 (not crash the worker).
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Pagination helper — enforced cap.
function pageParams(req, { defaultLimit = 50, maxLimit = 200 } = {}) {
  const limit = Math.min(maxLimit, Math.max(1, Number(req.query.limit) || defaultLimit));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  return { limit, offset };
}

// Cache TTLs (ms).
const TTL = {
  videosAll: 120_000, // hot homepage list; stable across home/watch/back browsing
  videoOne: 60_000,
  categories: 300_000,
  settings: 60_000,
  reactions: 15_000,
  comments: 15_000,
  adStats: 60_000,
  liveAnalytics: 5_000,
  ytMeta: 24 * 3600_000,
  tagsPopular: 300_000,
};

/* ============================ Public config (admin prefix) ============================ */

// Public config endpoint. The admin URL prefix is intentionally NOT exposed
// here — it is treated as a shared secret. Clients must POST to
// /api/admin/check-prefix with a candidate value to verify a match.
app.get(
  "/api/config",
  ah(async (_req, res) => {
    res.json({});
  }),
);

// Verify whether a single path segment matches the configured admin prefix.
// Returns { match: boolean }. Rate-limited to prevent brute-force probing.
app.post(
  "/api/admin/check-prefix",
  rateLimit({ name: "check-prefix", limit: 30, windowMs: 60_000 }),
  ah(async (req, res) => {
    const candidate = String(req.body?.prefix || "")
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 64);
    if (!candidate) return res.json({ match: false });
    let prefix = "admin";
    try {
      const row = await one("SELECT value FROM settings WHERE key = 'auto_import'");
      const s = row ? (typeof row.value === "string" ? JSON.parse(row.value) : row.value) : {};
      prefix = (s.adminPrefix || "admin").replace(/[^a-z0-9-]/g, "") || "admin";
    } catch {
      /* default */
    }
    res.json({ match: candidate === prefix });
  }),
);

/* ============================ Setup wizard ============================ */

app.get(
  "/api/setup/status",
  ah(async (_req, res) => {
    res.json({ needsSetup: !(await hasAnyAdmin()) });
  }),
);

app.post(
  "/api/setup/initialize",
  rateLimit({ name: "setup", limit: 10, windowMs: 60_000 }),
  ah(async (req, res) => {
    if (await hasAnyAdmin()) return res.status(409).json({ error: "Already initialized" });
    const { username, password } = req.body || {};
    if (!username || typeof username !== "string" || username.length < 3)
      return res.status(400).json({ error: "Username must be at least 3 chars" });
    if (!password || password.length < 6)
      return res.status(400).json({ error: "Password must be at least 6 chars" });
    const existing = await one("SELECT 1 FROM admins WHERE username = $1", [username]);
    if (existing) return res.status(409).json({ error: "Username already taken" });
    await q(`INSERT INTO admins (username, password_hash) VALUES ($1, $2)`, [
      username,
      bcrypt.hashSync(password, BCRYPT_ROUNDS),
    ]);
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: "Could not create session" });
      req.session.admin = username;
      res.json({ ok: true, username });
    });
  }),
);

/* ============================ Admin auth ============================ */

app.post(
  "/api/auth/login",
  rateLimit({ name: "admin-login", limit: 10, windowMs: 60_000 }),
  ah(async (req, res) => {
    const { username, password } = req.body || {};
    const a = await one("SELECT username, password_hash FROM admins WHERE username = $1", [
      username,
    ]);
    if (!a || !bcrypt.compareSync(password || "", a.password_hash))
      return res.status(401).json({ error: "Invalid credentials" });
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: "Could not create session" });
      req.session.admin = username;
      res.json({ ok: true, username });
    });
  }),
);

app.post("/api/auth/logout", (req, res) => {
  delete req.session.admin;
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  res.json({ admin: req.session.admin || null });
});

app.post(
  "/api/auth/credentials",
  requireAdmin,
  ah(async (req, res) => {
    const { currentPassword, newUsername, newPassword } = req.body || {};
    const a = await one("SELECT username, password_hash FROM admins WHERE username = $1", [
      req.session.admin,
    ]);
    if (!a || !bcrypt.compareSync(currentPassword || "", a.password_hash))
      return res.status(401).json({ error: "Current password incorrect" });
    if (!newUsername || !newPassword || newPassword.length < 6)
      return res.status(400).json({ error: "Invalid new credentials" });
    await tx(async (c) => {
      await c.query("DELETE FROM admins WHERE username = $1", [req.session.admin]);
      await c.query("INSERT INTO admins (username, password_hash) VALUES ($1, $2)", [
        newUsername,
        bcrypt.hashSync(newPassword, BCRYPT_ROUNDS),
      ]);
    });
    req.session.admin = newUsername;
    res.json({ ok: true, username: newUsername });
  }),
);

/* ============================ User accounts ============================ */

const normEmail = (s) =>
  String(s || "")
    .trim()
    .toLowerCase();
const isValidEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

app.post(
  "/api/account/signup",
  rateLimit({ name: "signup", limit: 20, windowMs: 60_000 }),
  ah(async (req, res) => {
    const fullName = String(req.body?.fullName || req.body?.full_name || "")
      .trim()
      .slice(0, 100);
    const email = normEmail(req.body?.email);
    const password = req.body?.password;
    if (!fullName) return res.status(400).json({ error: "Full name is required" });
    if (!isValidEmail(email)) return res.status(400).json({ error: "Enter a valid email address" });
    if (!password || password.length < 6)
      return res.status(400).json({ error: "Password too short" });

    const existing = await one("SELECT id FROM users WHERE LOWER(email) = $1", [email]);
    if (existing) {
      return res
        .status(409)
        .json({ error: "An account with this email already exists. Please sign in instead." });
    }

    const base =
      (email.split("@")[0] || "").replace(/[^a-zA-Z0-9_.-]/g, "") ||
      `user${Math.random().toString(36).slice(2, 8)}`;
    let username = base;
    let suffix = 0;

    while (await one("SELECT 1 FROM users WHERE LOWER(username) = LOWER($1)", [username])) {
      suffix += 1;
      username = `${base}${suffix}`;
    }

    try {
      const id = `u-${uid()}`;
      const colors = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899"];
      const avatarColor = colors[Math.floor(Math.random() * colors.length)];
      await q(
        `INSERT INTO users (id, username, email, password_hash, avatar_color, full_name)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, username, email, bcrypt.hashSync(password, BCRYPT_ROUNDS), avatarColor, fullName],
      );
      req.session.userId = id;
      const u = await one(
        "SELECT id, username, email, avatar_color, full_name, created_at FROM users WHERE id = $1",
        [id],
      );
      res.json({ user: u });
    } catch (e) {
      if (String(e.message).toLowerCase().includes("duplicate") || e.code === "23505")
        return res.status(409).json({ error: "Email already in use" });
      console.error("[signup]", e);
      res.status(500).json({ error: "Server error" });
    }
  }),
);

app.post(
  "/api/account/login",
  rateLimit({ name: "login", limit: 20, windowMs: 60_000 }),
  ah(async (req, res) => {
    const email = normEmail(req.body?.email || req.body?.identifier);
    const password = req.body?.password;
    if (!email || !password) return res.status(400).json({ error: "Missing fields" });
    if (!isValidEmail(email)) return res.status(400).json({ error: "Enter a valid email address" });
    const u = await one("SELECT * FROM users WHERE LOWER(email) = $1", [email]);
    if (!u) return res.status(401).json({ error: "Invalid email or password" });
    if (!bcrypt.compareSync(password, u.password_hash)) {
      return res.status(401).json({ error: "Invalid password" });
    }
    req.session.userId = u.id;
    res.json({
      user: {
        id: u.id,
        username: u.username,
        email: u.email,
        avatar_color: u.avatar_color,
        full_name: u.full_name || "",
        created_at: u.created_at,
      },
    });
  }),
);

app.post("/api/account/logout", (req, res) => {
  delete req.session.userId;
  res.json({ ok: true });
});

app.get(
  "/api/account/me",
  ah(async (req, res) => {
    if (!req.session.userId) return res.json({ user: null });
    const u = await one(
      "SELECT id, username, email, avatar_color, full_name, created_at FROM users WHERE id = $1",
      [req.session.userId],
    );
    res.json({ user: u || null });
  }),
);

app.patch(
  "/api/account/me",
  requireUser,
  ah(async (req, res) => {
    const fullName = String(req.body?.fullName || req.body?.full_name || "")
      .trim()
      .slice(0, 100);
    if (!fullName) return res.status(400).json({ error: "Full name is required" });
    await q("UPDATE users SET full_name = $1 WHERE id = $2", [fullName, req.session.userId]);
    const u = await one(
      "SELECT id, username, email, avatar_color, full_name, created_at FROM users WHERE id = $1",
      [req.session.userId],
    );
    res.json({ user: u });
  }),
);

app.get(
  "/api/account/check-email",
  rateLimit({ name: "check-email", limit: 60, windowMs: 60_000 }),
  ah(async (req, res) => {
    const email = normEmail(req.query?.email);
    if (!isValidEmail(email)) return res.json({ exists: false, valid: false });
    const row = await one("SELECT 1 FROM users WHERE LOWER(email) = $1", [email]);
    res.json({ exists: !!row, valid: true });
  }),
);

/* ============================ Videos ============================ */

// Algorithm: identical to v13. Operates on plain JS array, no DB cost.
function withAlgorithmicFlags(items) {
  const now = Date.now();
  const decorated = items.map((v) => {
    const views = Number(v.views || 0);
    const likes = Number(v.likes || 0);
    const uploaded = v.uploadedAt ? new Date(v.uploadedAt).getTime() : now;
    const daysSince = Math.max(1, (now - uploaded) / 86400000);
    const vpd = views / daysSince;
    const freshness = Math.exp(-daysSince / 60);
    const trendingScore = vpd * (1 + freshness) + likes / Math.max(daysSince, 7);
    const eligible = views >= 100_000;
    const featuredScore = eligible ? (likes / Math.max(views, 1)) * Math.log10(views + 10) : 0;
    return { v, trendingScore, featuredScore };
  });
  const N = decorated.length || 1;
  const featuredCount = Math.max(1, Math.round(N * 0.15));
  const trendingCount = Math.max(1, Math.round(N * 0.15));
  const featuredIds = new Set(
    [...decorated]
      .sort((a, b) => b.featuredScore - a.featuredScore)
      .slice(0, featuredCount)
      .map((x) => x.v.id),
  );
  // Trending is drawn from OUTSIDE the featured picks so the hero, featured
  // row and trending row/page don't show the same videos.
  const trendingIds = new Set(
    [...decorated]
      .filter((x) => !featuredIds.has(x.v.id))
      .sort((a, b) => b.trendingScore - a.trendingScore)
      .slice(0, trendingCount)
      .map((x) => x.v.id),
  );
  return decorated.map(({ v }) => ({
    ...v,
    trending: trendingIds.has(v.id) || v.trending === true,
    featured: featuredIds.has(v.id) || v.featured === true,
  }));
}

function rowToVideo(r) {
  // data is JSONB — pg returns it parsed.
  const v = typeof r.data === "string" ? JSON.parse(r.data) : { ...r.data };
  v.id = r.id; // always use the authoritative DB id, not whatever is in data JSON
  v.slug = r.slug || v.slug || null;
  v.views = Number(r.views || 0) + Number(r.views_boost || 0);
  const base =
    r.likes_base && Number(r.likes_base) > 0 ? Number(r.likes_base) : Number(v.likes) || 0;
  v.likes = base + Number(r.likes_boost || 0) + Number(r.real_likes || 0);
  // Normalize legacy eporner URLs: /video/<id>/ -> /video-<id>/ (dash is correct per eporner.com)
  if (v.sourceUrl && typeof v.sourceUrl === "string") {
    v.sourceUrl = v.sourceUrl.replace(/eporner\.com\/video\//, "eporner.com/video-");
  }
  return v;
}

function normalizeSourceUrl(url) {
  if (!url || typeof url !== "string") return url;
  return url.replace(/eporner\.com\/video\//, "eporner.com/video-");
}

// Single SELECT joining the live reaction count.
const VIDEO_SELECT = `
  SELECT v.id, v.slug, v.data, v.views, v.views_boost, v.likes_boost, v.likes_base, v.updated_at,
         COALESCE(r.real_likes, 0) AS real_likes
    FROM videos v
    LEFT JOIN (
      SELECT video_id, COUNT(*)::bigint AS real_likes
        FROM reactions WHERE kind = 'like'
        GROUP BY video_id
    ) r ON r.video_id = v.id
`;

async function loadAllVideosFlagged() {
  const rows = await many(`${VIDEO_SELECT} ORDER BY v.updated_at DESC, v.id ASC`);
  return withAlgorithmicFlags(rows.map(rowToVideo));
}

app.get(
  "/api/videos",
  ah(async (req, res) => {
    await checkVideosEpoch().catch(() => {});
    const { tag } = req.query;
    if (tag) {
      const tagStr = String(tag).trim().toLowerCase();
      const all = await cached("videos:all", TTL.videosAll, loadAllVideosFlagged);
      const filtered = all.filter((v) => (v.tags || []).some((t) => t.toLowerCase() === tagStr));
      res.set("Cache-Control", "public, max-age=15");
      return res.json({ videos: filtered });
    }
    const videos = await cached("videos:all", TTL.videosAll, loadAllVideosFlagged);
    res.set("Cache-Control", "public, max-age=15");
    res.json({ videos });
  }),
);

app.get(
  "/api/videos/:id",
  ah(async (req, res) => {
    await checkVideosEpoch().catch(() => {});
    // Pull through the cached "all" list — single source of truth and zero
    // extra DB load on repeat views of the same video.
    const all = await cached("videos:all", TTL.videosAll, loadAllVideosFlagged);
    const v = all.find((x) => x.id === req.params.id);
    if (!v) return res.status(404).json({ error: "Not found" });
    res.json({ video: v });
  }),
);

function invalidateVideosCache() {
  invalidate("videos:all");
  invalidatePrefix("video:");
}
function invalidateSitemapCache() {
  invalidatePrefix("sitemap:");
}

// ---- Cross-process video cache invalidation ----
// The L1 cache is per-process: whichever process imports videos bumps the
// shared cache_epoch row in Postgres, and API workers compare their last-seen
// epoch before serving the cached /api/videos list, dropping the local copy
// when it changed. Keeps the public catalog fresh cluster-wide without Redis
// or IPC. The epoch read is itself cached for 1s (no stale-while-revalidate —
// serving a stale epoch would postpone the invalidation by one request), so
// each request costs at most one cheap PK lookup per second per worker.
let seenVideosEpoch = 0;
async function checkVideosEpoch() {
  const epoch = await cached(
    "db:cache_epoch",
    1000,
    async () => {
      const r = await one("SELECT value FROM settings WHERE key = 'cache_epoch'");
      const v = r?.value;
      return v && typeof v === "object" ? Number(v.videos) || 0 : 0;
    },
    { staleMs: 0 },
  );
  if (epoch !== seenVideosEpoch) {
    seenVideosEpoch = epoch;
    invalidateVideosCache();
    invalidateSitemapCache();
  }
}

app.post(
  "/api/videos/:id/adjust",
  requireAdmin,
  ah(async (req, res) => {
    const addViews = Math.trunc(Number(req.body?.addViews) || 0);
    const addLikes = Math.trunc(Number(req.body?.addLikes) || 0);
    const row = await one("SELECT 1 FROM videos WHERE id = $1", [req.params.id]);
    if (!row) return res.status(404).json({ error: "Not found" });
    if (addViews)
      await q("UPDATE videos SET views_boost = views_boost + $1 WHERE id = $2", [
        addViews,
        req.params.id,
      ]);
    if (addLikes)
      await q("UPDATE videos SET likes_boost = likes_boost + $1 WHERE id = $2", [
        addLikes,
        req.params.id,
      ]);
    const after = await one(`${VIDEO_SELECT} WHERE v.id = $1`, [req.params.id]);
    invalidateVideosCache();
    invalidateSitemapCache();
    await bumpVideosEpoch().catch(() => {});
    res.json({ ok: true, video: rowToVideo(after) });
  }),
);

app.post(
  "/api/videos",
  requireAdmin,
  ah(async (req, res) => {
    const v = req.body?.video;
    if (!v?.id || !v?.title || !v?.embedUrl)
      return res.status(400).json({ error: "id, title, embedUrl required" });
    const existing = await one("SELECT 1 FROM videos WHERE id = $1", [v.id]);
    const cleanV = { ...v };
    delete cleanV.views;
    delete cleanV.likes;
    if (cleanV.sourceUrl) cleanV.sourceUrl = normalizeSourceUrl(cleanV.sourceUrl);
    if (existing) {
      await q("UPDATE videos SET slug = $1, data = $2::jsonb, updated_at = NOW() WHERE id = $3", [
        v.slug || null,
        JSON.stringify(cleanV),
        v.id,
      ]);
    } else {
      const baseViews = Math.max(0, Math.trunc(Number(v.views) || 0));
      const baseLikes = Math.max(0, Math.trunc(Number(v.likes) || 0));
      await q(
        "INSERT INTO videos (id, slug, data, views, likes_base) VALUES ($1, $2, $3::jsonb, $4, $5)",
        [v.id, v.slug || null, JSON.stringify(cleanV), baseViews, baseLikes],
      );
    }
    invalidateVideosCache();
    invalidateSitemapCache();
    await bumpVideosEpoch().catch(() => {});
    res.json({ video: v });
  }),
);

app.put(
  "/api/videos/:id",
  requireAdmin,
  ah(async (req, res) => {
    const v = req.body?.video;
    if (!v) return res.status(400).json({ error: "Missing video" });
    v.id = req.params.id;
    const existing = await one("SELECT 1 FROM videos WHERE id = $1", [v.id]);
    const cleanV = { ...v };
    delete cleanV.views;
    delete cleanV.likes;
    if (cleanV.sourceUrl) cleanV.sourceUrl = normalizeSourceUrl(cleanV.sourceUrl);
    if (existing) {
      await q("UPDATE videos SET slug = $1, data = $2::jsonb, updated_at = NOW() WHERE id = $3", [
        v.slug || null,
        JSON.stringify(cleanV),
        v.id,
      ]);
    } else {
      const baseViews = Math.max(0, Math.trunc(Number(v.views) || 0));
      const baseLikes = Math.max(0, Math.trunc(Number(v.likes) || 0));
      await q(
        "INSERT INTO videos (id, slug, data, views, likes_base) VALUES ($1, $2, $3::jsonb, $4, $5)",
        [v.id, v.slug || null, JSON.stringify(cleanV), baseViews, baseLikes],
      );
    }
    invalidateVideosCache();
    invalidateSitemapCache();
    await bumpVideosEpoch().catch(() => {});
    res.json({ video: v });
  }),
);

app.delete(
  "/api/videos/:id",
  requireAdmin,
  ah(async (req, res) => {
    await tx(async (c) => {
      await c.query("DELETE FROM reactions WHERE video_id = $1", [req.params.id]);
      await c.query("DELETE FROM comments  WHERE video_id = $1", [req.params.id]);
      await c.query("DELETE FROM videos    WHERE id = $1", [req.params.id]);
    });
    invalidateVideosCache();
    invalidateSitemapCache();
    await bumpVideosEpoch().catch(() => {});
    invalidatePrefix("comments:");
    invalidatePrefix("reactions:");
    res.json({ ok: true });
  }),
);

app.put(
  "/api/videos",
  requireAdmin,
  ah(async (req, res) => {
    const list = Array.isArray(req.body?.videos) ? req.body.videos : [];
    await tx(async (c) => {
      await c.query("DELETE FROM reactions WHERE video_id IN (SELECT id FROM videos)");
      await c.query("DELETE FROM comments WHERE video_id IN (SELECT id FROM videos)");
      await c.query("DELETE FROM saved_videos WHERE video_id IN (SELECT id FROM videos)");
      await c.query("DELETE FROM videos");
      if (list.length) {
        const ids = [],
          slugs = [],
          datas = [],
          views = [],
          likes = [];
        for (const v of list) {
          const baseViews = Math.max(0, Math.trunc(Number(v.views) || 0));
          const baseLikes = Math.max(0, Math.trunc(Number(v.likes) || 0));
          const cleanV = { ...v };
          delete cleanV.views;
          delete cleanV.likes;
          if (cleanV.sourceUrl) cleanV.sourceUrl = normalizeSourceUrl(cleanV.sourceUrl);
          // Always ensure a non-null id — guard against null/undefined from client
          const vid =
            v.id != null && String(v.id).trim()
              ? String(v.id).trim()
              : `srv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          ids.push(vid);
          slugs.push(v.slug || null);
          datas.push(JSON.stringify(cleanV));
          views.push(baseViews);
          likes.push(baseLikes);
        }
        await c.query(
          `INSERT INTO videos (id, slug, data, views, likes_base, views_boost, likes_boost)
           SELECT * FROM UNNEST($1::text[], $2::text[], $3::jsonb[], $4::bigint[], $5::bigint[], $6::bigint[], $7::bigint[])
                  AS t(id, slug, data, views, likes_base, views_boost, likes_boost)
           ON CONFLICT (id) DO UPDATE SET
             slug = EXCLUDED.slug,
             data = EXCLUDED.data,
             updated_at = NOW()`,
          [
            ids,
            slugs,
            datas,
            views,
            likes,
            new Array(ids.length).fill(0),
            new Array(ids.length).fill(0),
          ],
        );
      }
    });
    invalidateVideosCache();
    invalidateSitemapCache();
    await bumpVideosEpoch().catch(() => {});
    res.json({ ok: true, count: list.length });
  }),
);

app.post(
  "/api/videos/bulk-import",
  requireAdmin,
  ah(async (req, res) => {
    const list = Array.isArray(req.body?.videos) ? req.body.videos : [];
    const ids = [],
      slugs = [],
      datas = [],
      views = [],
      likes = [];
    const seen = new Set();
    for (let i = 0; i < list.length; i++) {
      const v = list[i] || {};
      if (!v.title || !v.embedUrl || !v.thumbnail) continue;
      const vid =
        v.id != null && String(v.id).trim() ? String(v.id).trim() : `imp-${Date.now()}-${i}`;
      if (seen.has(vid)) continue;
      seen.add(vid);
      const cleanV = { ...v, id: vid };
      delete cleanV.views;
      delete cleanV.likes;
      if (cleanV.sourceUrl) cleanV.sourceUrl = normalizeSourceUrl(cleanV.sourceUrl);
      ids.push(vid);
      slugs.push(v.slug || null);
      datas.push(JSON.stringify(cleanV));
      views.push(Math.max(0, Math.trunc(Number(v.views) || 0)));
      likes.push(Math.max(0, Math.trunc(Number(v.likes) || 0)));
    }

    if (ids.length) {
      await q(
        `INSERT INTO videos (id, slug, data, views, likes_base, views_boost, likes_boost)
         SELECT * FROM UNNEST($1::text[], $2::text[], $3::jsonb[], $4::bigint[], $5::bigint[], $6::bigint[], $7::bigint[])
                AS t(id, slug, data, views, likes_base, views_boost, likes_boost)
         ON CONFLICT (id) DO UPDATE SET
           slug = EXCLUDED.slug,
           data = EXCLUDED.data,
           updated_at = NOW()`,
        [
          ids,
          slugs,
          datas,
          views,
          likes,
          new Array(ids.length).fill(0),
          new Array(ids.length).fill(0),
        ],
      );
      invalidateVideosCache();
      invalidateSitemapCache();
      await bumpVideosEpoch();
    }
    res.json({ ok: true, count: ids.length });
  }),
);

// One view per session per video — counted in memory, flushed in batches.
app.post(
  "/api/videos/:id/view",
  rateLimit({ name: "view", limit: 240, windowMs: 60_000 }),
  ah(async (req, res) => {
    if (!req.session.viewed) req.session.viewed = {};
    if (req.session.viewed[req.params.id]) return res.json({ ok: true, counted: false });
    // Cap the map so an attacker flooding fake IDs can't grow the session
    // (serialized to the session store on every request). FIFO eviction.
    const keys = Object.keys(req.session.viewed);
    if (keys.length >= 200) delete req.session.viewed[keys[0]];
    // Buffer the increment; the existence check happens at flush time —
    // bogus IDs simply update 0 rows.
    bufferView(req.params.id);
    req.session.viewed[req.params.id] = 1;
    res.json({ ok: true, counted: true });
  }),
);

/* ============================ Reactions ============================ */

async function reactionCounts(videoId) {
  const rows = await many(
    "SELECT kind, COUNT(*)::int AS c FROM reactions WHERE video_id = $1 GROUP BY kind",
    [videoId],
  );
  const out = { likes: 0, dislikes: 0, mine: null };
  for (const r of rows) {
    if (r.kind === "like") out.likes = r.c;
    if (r.kind === "dislike") out.dislikes = r.c;
  }
  return out;
}

app.get(
  "/api/reactions/:videoId",
  ah(async (req, res) => {
    const base = await cached(`reactions:${req.params.videoId}`, TTL.reactions, () =>
      reactionCounts(req.params.videoId),
    );
    const out = { ...base };
    if (req.session.userId) {
      const mine = await one("SELECT kind FROM reactions WHERE user_id = $1 AND video_id = $2", [
        req.session.userId,
        req.params.videoId,
      ]);
      out.mine = mine?.kind || null;
    }
    res.json(out);
  }),
);

app.post(
  "/api/reactions/:videoId",
  requireUser,
  ah(async (req, res) => {
    const { kind } = req.body || {};
    if (kind !== "like" && kind !== "dislike")
      return res.status(400).json({ error: "kind must be like|dislike" });
    const existing = await one("SELECT kind FROM reactions WHERE user_id = $1 AND video_id = $2", [
      req.session.userId,
      req.params.videoId,
    ]);
    if (existing?.kind === kind) {
      await q("DELETE FROM reactions WHERE user_id = $1 AND video_id = $2", [
        req.session.userId,
        req.params.videoId,
      ]);
    } else {
      await q(
        `INSERT INTO reactions (user_id, video_id, kind) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, video_id) DO UPDATE SET kind = EXCLUDED.kind`,
        [req.session.userId, req.params.videoId, kind],
      );
    }
    invalidate(`reactions:${req.params.videoId}`);
    invalidateVideosCache(); // likes count flows into v.likes
    const out = await reactionCounts(req.params.videoId);
    const mine = await one("SELECT kind FROM reactions WHERE user_id = $1 AND video_id = $2", [
      req.session.userId,
      req.params.videoId,
    ]);
    out.mine = mine?.kind || null;
    res.json(out);
  }),
);

/* ============================ Subscriptions ============================ */

app.get(
  "/api/subscriptions",
  ah(async (req, res) => {
    if (!req.session.userId) return res.json({ channels: [] });
    const rows = await many("SELECT channel FROM subscriptions WHERE user_id = $1", [
      req.session.userId,
    ]);
    res.json({ channels: rows.map((r) => r.channel) });
  }),
);

app.post(
  "/api/subscriptions",
  requireUser,
  ah(async (req, res) => {
    const channel = String(req.body?.channel || "")
      .trim()
      .slice(0, 200);
    if (!channel) return res.status(400).json({ error: "channel required" });
    const existing = await one("SELECT 1 FROM subscriptions WHERE user_id = $1 AND channel = $2", [
      req.session.userId,
      channel,
    ]);
    if (existing) {
      await q("DELETE FROM subscriptions WHERE user_id = $1 AND channel = $2", [
        req.session.userId,
        channel,
      ]);
      return res.json({ subscribed: false, channel });
    }
    await q("INSERT INTO subscriptions (user_id, channel) VALUES ($1, $2)", [
      req.session.userId,
      channel,
    ]);
    res.json({ subscribed: true, channel });
  }),
);

/* ============================ Saved videos ============================ */

app.get(
  "/api/saved",
  ah(async (req, res) => {
    if (!req.session.userId) return res.json({ ids: [] });
    const rows = await many(
      "SELECT video_id FROM saved_videos WHERE user_id = $1 ORDER BY created_at DESC",
      [req.session.userId],
    );
    res.json({ ids: rows.map((r) => r.video_id) });
  }),
);

app.get(
  "/api/saved/videos",
  requireUser,
  ah(async (req, res) => {
    const rows = await many(
      `SELECT v.id, v.data, v.views, v.views_boost, v.likes_boost, v.likes_base,
              COALESCE(r.real_likes, 0) AS real_likes
         FROM saved_videos s
         JOIN videos v ON v.id = s.video_id
         LEFT JOIN (
           SELECT video_id, COUNT(*)::bigint AS real_likes
             FROM reactions WHERE kind = 'like' GROUP BY video_id
         ) r ON r.video_id = v.id
        WHERE s.user_id = $1
        ORDER BY s.created_at DESC`,
      [req.session.userId],
    );
    res.json({ videos: rows.map(rowToVideo) });
  }),
);

app.post(
  "/api/saved",
  requireUser,
  ah(async (req, res) => {
    const videoId = String(req.body?.videoId || "")
      .trim()
      .slice(0, 200);
    if (!videoId) return res.status(400).json({ error: "videoId required" });
    const existing = await one("SELECT 1 FROM saved_videos WHERE user_id = $1 AND video_id = $2", [
      req.session.userId,
      videoId,
    ]);
    if (existing) {
      await q("DELETE FROM saved_videos WHERE user_id = $1 AND video_id = $2", [
        req.session.userId,
        videoId,
      ]);
      return res.json({ saved: false, videoId });
    }
    await q("INSERT INTO saved_videos (user_id, video_id) VALUES ($1, $2)", [
      req.session.userId,
      videoId,
    ]);
    res.json({ saved: true, videoId });
  }),
);

/* ============================ Categories ============================ */

app.get(
  "/api/categories",
  ah(async (_req, res) => {
    const value = await cached("categories", TTL.categories, async () => {
      const row = await one("SELECT value FROM settings WHERE key = 'categories'");
      return row ? (typeof row.value === "string" ? JSON.parse(row.value) : row.value) : [];
    });
    res.json({ categories: value });
  }),
);

app.put(
  "/api/categories",
  requireAdmin,
  ah(async (req, res) => {
    const list = Array.isArray(req.body?.categories) ? req.body.categories : [];
    await q(
      `INSERT INTO settings (key, value) VALUES ('categories', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(list)],
    );
    invalidate("categories");
    invalidateSitemapCache();
    res.json({ ok: true, count: list.length });
  }),
);

/* ============================ Comments ============================ */

app.get(
  "/api/comments",
  ah(async (req, res) => {
    const { videoId } = req.query;
    const { limit, offset } = pageParams(req, { defaultLimit: 500, maxLimit: 500 });
    const key = `comments:${videoId || "all"}:${limit}:${offset}`;
    const comments = await cached(key, TTL.comments, () =>
      videoId
        ? many(
            "SELECT id, video_id, author, email, body, status, user_id, created_at FROM comments WHERE video_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
            [videoId, limit, offset],
          )
        : many(
            "SELECT id, video_id, author, email, body, status, user_id, created_at FROM comments ORDER BY created_at DESC LIMIT $1 OFFSET $2",
            [limit, offset],
          ),
    );
    res.json({ comments });
  }),
);

app.post(
  "/api/comments",
  rateLimit({ name: "comment-post", limit: 30, windowMs: 60_000 }),
  ah(async (req, res) => {
    const { videoId, author, email, body } = req.body || {};
    if (!videoId || !author || !body) return res.status(400).json({ error: "Missing fields" });
    if (body.length > 1000) return res.status(400).json({ error: "Too long" });
    const id = `c-${uid()}`;
    const userId = req.session.userId || null;
    await q(
      `INSERT INTO comments (id, video_id, author, email, body, status, user_id)
       VALUES ($1, $2, $3, $4, $5, 'approved', $6)`,
      [id, videoId, String(author).slice(0, 60), email || null, body, userId],
    );
    invalidatePrefix("comments:");
    const comment = await one(
      "SELECT id, video_id, author, email, body, status, user_id, created_at FROM comments WHERE id = $1",
      [id],
    );
    res.json({ comment });
  }),
);

app.patch(
  "/api/comments/:id",
  requireAdmin,
  ah(async (req, res) => {
    const { author, body, status } = req.body || {};
    const sets = [];
    const vals = [];
    if (author != null) {
      sets.push(`author = $${sets.length + 1}`);
      vals.push(author);
    }
    if (body != null) {
      sets.push(`body = $${sets.length + 1}`);
      vals.push(body);
    }
    if (status != null) {
      sets.push(`status = $${sets.length + 1}`);
      vals.push(status);
    }
    if (!sets.length) return res.json({ ok: true });
    vals.push(req.params.id);
    await q(`UPDATE comments SET ${sets.join(", ")} WHERE id = $${vals.length}`, vals);
    invalidatePrefix("comments:");
    const comment = await one(
      "SELECT id, video_id, author, email, body, status, user_id, created_at FROM comments WHERE id = $1",
      [req.params.id],
    );
    res.json({ comment });
  }),
);

app.delete(
  "/api/comments/:id",
  requireAdmin,
  ah(async (req, res) => {
    await q("DELETE FROM comments WHERE id = $1", [req.params.id]);
    invalidatePrefix("comments:");
    res.json({ ok: true });
  }),
);

app.post(
  "/api/comments/bulk-delete",
  requireAdmin,
  ah(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (ids.length) await q("DELETE FROM comments WHERE id = ANY($1::text[])", [ids]);
    invalidatePrefix("comments:");
    res.json({ ok: true, count: ids.length });
  }),
);

/* ============================ Settings (key/value) ============================ */

const PUBLIC_SETTING_KEYS = new Set([
  "ads",
  "comments-disabled",
  "labels",
  "seo",
  "seo-pages",
  "theme",
]);
const WRITABLE_SETTING_KEYS = new Set(PUBLIC_SETTING_KEYS);

function validSettingsValue(value, depth = 0) {
  if (depth > 8) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.length <= 100_000;
  if (Array.isArray(value)) {
    return value.length <= 1000 && value.every((item) => validSettingsValue(item, depth + 1));
  }
  if (typeof value !== "object") return false;
  const entries = Object.entries(value);
  return (
    entries.length <= 1000 &&
    entries.every(([key, item]) => key.length <= 100 && validSettingsValue(item, depth + 1))
  );
}

async function readSettingValue(key) {
  const row = await one("SELECT value FROM settings WHERE key = $1", [key]);
  if (!row) return null;
  return typeof row.value === "string" ? JSON.parse(row.value) : row.value;
}

app.get(
  "/api/settings/:key",
  ah(async (req, res) => {
    if (!PUBLIC_SETTING_KEYS.has(req.params.key)) {
      return res.status(404).json({ error: "Setting not found" });
    }
    const value =
      req.params.key === "seo" || req.params.key === "seo-pages"
        ? await readSettingValue(req.params.key)
        : await cached(`settings:${req.params.key}`, TTL.settings, () =>
            readSettingValue(req.params.key),
          );
    res.json({ value });
  }),
);

app.put(
  "/api/settings/:key",
  requireAdmin,
  ah(async (req, res) => {
    if (!WRITABLE_SETTING_KEYS.has(req.params.key)) {
      return res.status(404).json({ error: "Setting not found" });
    }
    if (!validSettingsValue(req.body?.value)) {
      return res.status(400).json({ error: "Invalid setting value" });
    }
    await q(
      `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [req.params.key, JSON.stringify(req.body?.value ?? null)],
    );
    invalidate(`settings:${req.params.key}`);
    if (req.params.key === "seo") invalidate("seo:ads-txt");
    if (req.params.key === "seo") invalidate("seo:robots-txt");
    if (req.params.key === "auto_import") invalidate("api:config");
    res.json({ ok: true });
  }),
);

/* ============================ Favicon ============================ */

const FAVICON_DIR = path.resolve("uploads/favicon");
if (!fs.existsSync(FAVICON_DIR)) fs.mkdirSync(FAVICON_DIR, { recursive: true });

const FAVICON_EXT_MAP = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "image/x-icon": ".ico",
  "image/webp": ".webp",
};

function saveFaviconToDisk(dataUrl) {
  const sep = dataUrl.indexOf(";base64,");
  if (sep === -1) return null;
  const header = dataUrl.slice(5, sep);
  const b64 = dataUrl.slice(sep + 8);
  const mime = header.split(";")[0].trim().toLowerCase();
  if (!mime.startsWith("image/")) return null;
  const ext = FAVICON_EXT_MAP[mime] || ".png";
  const buf = Buffer.from(b64, "base64");
  if (buf.length > 2 * 1024 * 1024) return null;
  const filename = `favicon${ext}`;
  const filePath = path.join(FAVICON_DIR, filename);
  fs.writeFileSync(filePath, buf);
  for (const f of fs.readdirSync(FAVICON_DIR)) {
    if (f !== filename) {
      try {
        fs.unlinkSync(path.join(FAVICON_DIR, f));
      } catch {}
    }
  }
  return `/api/favicon/image?t=${Date.now()}`;
}

function deleteFaviconFromDisk() {
  for (const f of fs.readdirSync(FAVICON_DIR)) {
    try {
      fs.unlinkSync(path.join(FAVICON_DIR, f));
    } catch {}
  }
}

app.get(
  "/api/favicon/image",
  ah(async (_req, res) => {
    const files = fs.readdirSync(FAVICON_DIR);
    if (!files.length) return res.status(404).end();
    const file = files[0];
    const ext = path.extname(file).toLowerCase();
    const ct =
      {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".gif": "image/gif",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon",
        ".webp": "image/webp",
      }[ext] || "image/png";
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "public, max-age=86400");
    fs.createReadStream(path.join(FAVICON_DIR, file)).pipe(res);
  }),
);

app.get(
  "/api/favicon",
  ah(async (_req, res) => {
    const value = await cached("settings:favicon", TTL.settings, async () => {
      const row = await one("SELECT value FROM settings WHERE key = $1", ["favicon"]);
      if (!row) return null;
      return typeof row.value === "string" ? JSON.parse(row.value) : row.value;
    });
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=86400");
    res.json({ url: value?.url ?? null });
  }),
);

app.put(
  "/api/favicon",
  requireAdmin,
  ah(async (req, res) => {
    const { url } = req.body || {};
    if (!url || typeof url !== "string") return res.status(400).json({ error: "Missing url" });
    let storedUrl = url;
    if (url.startsWith("data:image/")) {
      const saved = saveFaviconToDisk(url);
      if (!saved) return res.status(400).json({ error: "Invalid or too-large image (max 2 MB)" });
      storedUrl = saved;
    } else if (/^https?:\/\//.test(url)) {
      storedUrl = url.slice(0, 2048);
    } else {
      return res.status(400).json({ error: "Invalid URL" });
    }
    const value = { url: storedUrl };
    await q(
      `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      ["favicon", JSON.stringify(value)],
    );
    invalidate("settings:favicon");
    res.json({ ok: true, url: storedUrl });
  }),
);

app.delete(
  "/api/favicon",
  requireAdmin,
  ah(async (_req, res) => {
    deleteFaviconFromDisk();
    await q("DELETE FROM settings WHERE key = $1", ["favicon"]);
    invalidate("settings:favicon");
    res.json({ ok: true });
  }),
);

/* ============================ Brand logo ============================ */
// Same pattern as favicon: data-URL upload → save to disk, or remote URL.
// Stored in settings under key 'brand_logo'. When empty, the navbar falls
// back to the first letter of the brand name.

const BRAND_LOGO_DIR = path.resolve("uploads/brand-logo");
if (!fs.existsSync(BRAND_LOGO_DIR)) fs.mkdirSync(BRAND_LOGO_DIR, { recursive: true });

const BRAND_LOGO_EXT_MAP = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "image/x-icon": ".ico",
  "image/webp": ".webp",
};

function saveBrandLogoToDisk(dataUrl) {
  const sep = dataUrl.indexOf(";base64,");
  if (sep === -1) return null;
  const header = dataUrl.slice(5, sep);
  const b64 = dataUrl.slice(sep + 8);
  const mime = header.split(";")[0].trim().toLowerCase();
  if (!mime.startsWith("image/")) return null;
  const ext = BRAND_LOGO_EXT_MAP[mime] || ".png";
  const buf = Buffer.from(b64, "base64");
  if (buf.length > 2 * 1024 * 1024) return null;
  const filename = `brand-logo${ext}`;
  const filePath = path.join(BRAND_LOGO_DIR, filename);
  fs.writeFileSync(filePath, buf);
  for (const f of fs.readdirSync(BRAND_LOGO_DIR)) {
    if (f !== filename) {
      try {
        fs.unlinkSync(path.join(BRAND_LOGO_DIR, f));
      } catch {}
    }
  }
  return `/api/brand-logo/image?t=${Date.now()}`;
}

function deleteBrandLogoFromDisk() {
  for (const f of fs.readdirSync(BRAND_LOGO_DIR)) {
    try {
      fs.unlinkSync(path.join(BRAND_LOGO_DIR, f));
    } catch {}
  }
}

app.get(
  "/api/brand-logo/image",
  ah(async (_req, res) => {
    const files = fs.readdirSync(BRAND_LOGO_DIR);
    if (!files.length) return res.status(404).end();
    const file = files[0];
    const ext = path.extname(file).toLowerCase();
    const ct =
      {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".gif": "image/gif",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon",
        ".webp": "image/webp",
      }[ext] || "image/png";
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "public, max-age=86400");
    fs.createReadStream(path.join(BRAND_LOGO_DIR, file)).pipe(res);
  }),
);

app.get(
  "/api/brand-logo",
  ah(async (_req, res) => {
    const value = await cached("settings:brand_logo", TTL.settings, async () => {
      const row = await one("SELECT value FROM settings WHERE key = $1", ["brand_logo"]);
      if (!row) return null;
      return typeof row.value === "string" ? JSON.parse(row.value) : row.value;
    });
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=86400");
    res.json({ url: value?.url ?? null });
  }),
);

app.put(
  "/api/brand-logo",
  requireAdmin,
  ah(async (req, res) => {
    const { url } = req.body || {};
    if (!url || typeof url !== "string") return res.status(400).json({ error: "Missing url" });
    let storedUrl = url;
    if (url.startsWith("data:image/")) {
      const saved = saveBrandLogoToDisk(url);
      if (!saved) return res.status(400).json({ error: "Invalid or too-large image (max 2 MB)" });
      storedUrl = saved;
    } else if (/^https?:\/\//.test(url)) {
      storedUrl = url.slice(0, 2048);
    } else {
      return res.status(400).json({ error: "Invalid URL" });
    }
    const value = { url: storedUrl };
    await q(
      `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      ["brand_logo", JSON.stringify(value)],
    );
    invalidate("settings:brand_logo");
    res.json({ ok: true, url: storedUrl });
  }),
);

app.delete(
  "/api/brand-logo",
  requireAdmin,
  ah(async (_req, res) => {
    deleteBrandLogoFromDisk();
    await q("DELETE FROM settings WHERE key = $1", ["brand_logo"]);
    invalidate("settings:brand_logo");
    res.json({ ok: true });
  }),
);

/* ============================ Public file uploads ============================ */
// Admin-only file upload to the PUBLIC_DIR (Vite "public/" folder).
// Uploaded files are immediately accessible at domain.com/filename —
// no rebuild required.  Used for exoclick.html, beta.html, verification
// files, etc.

// Safety: block filenames that could escape PUBLIC_DIR or overwrite the SPA.
const BLOCKED_PUBLIC_NAMES = new Set([
  "index.html",
  "index.htm",
  "favicon.ico",
  "robots.txt",
  "ads.txt",
  "sitemap.xml",
  "sitemap.txt",
]);

function safePublicFilename(raw) {
  // Strip path separators, keep only the basename.
  const base = String(raw || "")
    .replace(/[\\/]/g, "")
    .trim();
  if (!base || base.includes("..")) return null;
  if (base.length > 200) return null;
  if (BLOCKED_PUBLIC_NAMES.has(base.toLowerCase())) return null;
  // Allow common web file extensions + plain text.
  const ext = path.extname(base).toLowerCase();
  const okExt = new Set([
    ".html",
    ".htm",
    ".txt",
    ".xml",
    ".json",
    ".js",
    ".css",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".svg",
    ".ico",
    ".webp",
    ".avif",
    ".pdf",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".otf",
    ".map",
    ".webmanifest",
  ]);
  if (ext && !okExt.has(ext)) return null;
  return base;
}

app.get(
  "/api/seo/files",
  requireAdmin,
  ah(async (_req, res) => {
    if (!fs.existsSync(PUBLIC_DIR)) return res.json({ files: [] });
    const entries = fs.readdirSync(PUBLIC_DIR, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile())
      .map((e) => {
        const fp = path.join(PUBLIC_DIR, e.name);
        const stat = fs.statSync(fp);
        return { name: e.name, size: stat.size, mtime: stat.mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);
    res.json({ files });
  }),
);

app.post(
  "/api/seo/upload",
  requireAdmin,
  ah(async (req, res) => {
    const { filename, content } = req.body || {};
    const safeName = safePublicFilename(filename);
    if (!safeName) return res.status(400).json({ error: "Invalid or blocked filename" });
    if (!content || typeof content !== "string")
      return res.status(400).json({ error: "Missing file content" });

    // Accept either a data URL (data:...;base64,...) or raw text content.
    let buf;
    if (content.startsWith("data:")) {
      const sep = content.indexOf(";base64,");
      if (sep === -1) return res.status(400).json({ error: "Invalid data URL" });
      const b64 = content.slice(sep + 8);
      try {
        buf = Buffer.from(b64, "base64");
      } catch {
        return res.status(400).json({ error: "Invalid base64 content" });
      }
    } else {
      buf = Buffer.from(content, "utf8");
    }
    if (buf.length > 10 * 1024 * 1024)
      return res.status(400).json({ error: "File too large (max 10 MB)" });

    const filePath = path.join(PUBLIC_DIR, safeName);
    fs.writeFileSync(filePath, buf);
    res.json({ ok: true, name: safeName, url: `/${safeName}`, size: buf.length });
  }),
);

app.delete(
  "/api/seo/files/:name",
  requireAdmin,
  ah(async (req, res) => {
    const safeName = safePublicFilename(req.params.name);
    if (!safeName) return res.status(400).json({ error: "Invalid filename" });
    const filePath = path.join(PUBLIC_DIR, safeName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found" });
    fs.unlinkSync(filePath);
    res.json({ ok: true });
  }),
);

/* ============================ Ad analytics ============================ */

app.post(
  "/api/ads/event",
  rateLimit({ name: "ad-event", limit: 300, windowMs: 60_000 }),
  ah(async (req, res) => {
    const { zone, format, event } = req.body || {};
    if (!zone || !event) return res.status(400).json({ error: "Missing fields" });
    if (!new Set(["impression", "click"]).has(event)) {
      return res.status(400).json({ error: "Invalid event" });
    }
    bufferAdEvent(
      String(zone).slice(0, 100),
      format ? String(format).slice(0, 30) : null,
      String(event).slice(0, 30),
    );
    res.json({ ok: true });
  }),
);

app.get(
  "/api/ads/stats",
  requireAdmin,
  ah(async (_req, res) => {
    const data = await cached("ads:stats", TTL.adStats, async () => {
      const totals = await many(
        `SELECT zone, format, event, COUNT(*)::int AS count
           FROM ad_events WHERE ts >= NOW() - ($1 * INTERVAL '1 day')
          GROUP BY zone, format, event ORDER BY count DESC LIMIT 500`,
        [AD_RETENTION_DAYS],
      );
      const daily = await many(
        `SELECT to_char(ts, 'YYYY-MM-DD') AS day, event, COUNT(*)::int AS count
           FROM ad_events WHERE ts >= NOW() - ($1 * INTERVAL '1 day')
           GROUP BY day, event ORDER BY day DESC`,
        [AD_RETENTION_DAYS],
      );
      const total = await many(
        `SELECT event, COUNT(*)::int AS count FROM ad_events
          WHERE ts >= NOW() - ($1 * INTERVAL '1 day') GROUP BY event`,
        [AD_RETENTION_DAYS],
      );
      return { totals, daily, total };
    });
    res.json(data);
  }),
);

/* ============================ ads.txt & robots.txt ============================ */

async function readSeoField(field, fallback) {
  try {
    const value = await readSettingValue("seo");
    const v = value?.[field];
    if (typeof v === "string" && v.trim()) return v;
  } catch {
    /* ignore */
  }
  return fallback;
}

app.get(
  "/ads.txt",
  ah(async (_req, res) => {
    res.type("text/plain");
    res.send(await readSeoField("adsTxt", "# ads.txt — configure via admin > SEO tab\n"));
  }),
);

app.get(
  "/robots.txt",
  ah(async (_req, res) => {
    res.type("text/plain");
    const custom = await readSeoField("robotsTxt", null);
    const s = await getAutoSettings();
    const prefix = (s.adminPrefix || "admin").replace(/[^a-z0-9-]/g, "") || "admin";
    let host = `${_req.protocol}://${_req.get("host")}`;
    try {
      const seoRow = await one("SELECT value FROM settings WHERE key = 'seo'");
      const seoVal = seoRow ? (typeof seoRow.value === "string" ? JSON.parse(seoRow.value) : seoRow.value) : null;
      if (seoVal?.canonicalBase && typeof seoVal.canonicalBase === "string" && seoVal.canonicalBase.trim()) {
        host = seoVal.canonicalBase.trim().replace(/\/$/, "");
      } else {
        const envBase = String(process.env.SEO_CANONICAL_BASE || "").trim().replace(/\/$/, "");
        if (envBase) host = envBase;
        else if (/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(host)) host = "https://hdpornforyou.com";
      }
    } catch {}
    if (/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(host)) host = "https://hdpornforyou.com";
    const disallow = [`/${prefix}`, "/account", "/setup", "/api/"];
    if (custom) {
      let out = String(custom);
      for (const path of disallow) {
        if (!out.includes(`Disallow: ${path}`)) out = out.trimEnd() + `\nDisallow: ${path}\n`;
      }
      if (!/Sitemap:/i.test(out)) {
        out = out.trimEnd() + `\nSitemap: ${host}/sitemap.xml\n`;
      }
      return res.send(out);
    }
    res.send(
      `User-agent: *\nAllow: /\n${disallow.map((path) => `Disallow: ${path}`).join("\n")}\nSitemap: ${host}/sitemap.xml\n`,
    );
  }),
);

/* ============================ YouTube metadata ============================ */

app.get(
  "/api/youtube/meta/:id",
  rateLimit({ name: "yt-meta", limit: 60, windowMs: 60_000 }),
  ah(async (req, res) => {
    const id = String(req.params.id || "").slice(0, 11);
    if (!/^[\w-]{11}$/.test(id)) return res.status(400).json({ error: "bad id" });
    try {
      const meta = await cached(`yt:${id}`, TTL.ytMeta, async () => {
        const r = await fetch(`https://www.youtube.com/watch?v=${id}`, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
          },
        });
        if (!r.ok) throw new Error("fetch failed");
        const html = await r.text();
        let seconds = 0;
        const m1 = html.match(/"lengthSeconds":"(\d+)"/);
        const m2 = html.match(/"approxDurationMs":"(\d+)"/);
        if (m1) seconds = Number(m1[1]);
        else if (m2) seconds = Math.round(Number(m2[1]) / 1000);
        const fmt = (s) => {
          if (!s) return "0:00";
          const h = Math.floor(s / 3600);
          const m = Math.floor((s % 3600) / 60);
          const sec = s % 60;
          return h > 0
            ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
            : `${m}:${String(sec).padStart(2, "0")}`;
        };
        return { id, seconds, duration: fmt(seconds) };
      });
      res.json(meta);
    } catch (e) {
      res.status(502).json({ error: String(e.message || e) });
    }
  }),
);

/* ============================ Site analytics ============================ */

// Popular tags from real tag-page traffic (last 30 days, distinct sessions).
// Powers the dynamic "Popular searches" block. Empty until tag pages get
// visits — clients fall back to a curated high-SEO list.
async function popularTags(limit) {
  const rows = await many(
    `WITH valid AS (
       SELECT trim(both '-' from regexp_replace(lower(trim(tag)), '[^a-z0-9]+', '-', 'g')) AS slug
         FROM videos, jsonb_array_elements_text(data->'tags') AS tag
        WHERE tag IS NOT NULL AND tag <> ''
        GROUP BY 1
       HAVING COUNT(*) >= $2
     )
     SELECT lower(regexp_replace(path, '^/tags/([^/?#]+).*$', '\\1')) AS slug,
            COUNT(DISTINCT session_id)::int AS hits
       FROM page_events
      WHERE path LIKE '/tags/%'
        AND ts > NOW() - INTERVAL '30 days'
        AND lower(regexp_replace(path, '^/tags/([^/?#]+).*$', '\\1')) IN (SELECT slug FROM valid)
      GROUP BY 1
      HAVING lower(regexp_replace(path, '^/tags/([^/?#]+).*$', '\\1')) ~ '^[a-z0-9-]{1,48}$'
      ORDER BY hits DESC
      LIMIT $1`,
    [Math.max(1, Math.min(24, limit | 0 || 12)), TAG_MIN_VIDEOS],
  );
  return rows.map((r) => r.slug).filter(Boolean);
}

app.get(
  "/api/tags/popular",
  rateLimit({ name: "tags-popular", limit: 300, windowMs: 60_000 }),
  ah(async (req, res) => {
    const limit = Math.max(1, Math.min(24, Number(req.query.limit) || 12));
    const tags = await cached(`tags:popular:v2:${limit}`, TTL.tagsPopular, () =>
      popularTags(limit),
    );
    res.json({ tags });
  }),
);

app.post(
  "/api/analytics/pageview",
  rateLimit({ name: "pageview", limit: 240, windowMs: 60_000 }),
  ah(async (req, res) => {
    const p = String(req.body?.path || "").slice(0, 300);
    const sid = req.sessionID || null;
    bufferPageEvent(p, sid);
    res.json({ ok: true });
  }),
);

app.get(
  "/api/analytics/live",
  requireAdmin,
  ah(async (_req, res) => {
    const data = await cached("analytics:live", TTL.liveAnalytics, async () => {
      const [a5, a1, v24, v1, top, perMin] = await Promise.all([
        one(
          `SELECT COUNT(DISTINCT session_id)::int AS n FROM page_events WHERE ts >= NOW() - INTERVAL '5 minutes'`,
        ),
        one(
          `SELECT COUNT(DISTINCT session_id)::int AS n FROM page_events WHERE ts >= NOW() - INTERVAL '1 minute'`,
        ),
        one(`SELECT COUNT(*)::int AS n FROM page_events WHERE ts >= NOW() - INTERVAL '1 day'`),
        one(`SELECT COUNT(*)::int AS n FROM page_events WHERE ts >= NOW() - INTERVAL '1 hour'`),
        many(
          `SELECT path, COUNT(*)::int AS hits FROM page_events
            WHERE ts >= NOW() - INTERVAL '1 day'
            GROUP BY path ORDER BY hits DESC LIMIT 10`,
        ),
        many(
          `SELECT to_char(ts, 'YYYY-MM-DD"T"HH24:MI') AS minute, COUNT(*)::int AS hits
             FROM page_events WHERE ts >= NOW() - INTERVAL '30 minutes'
             GROUP BY minute ORDER BY minute ASC`,
        ),
      ]);
      return {
        now: new Date().toISOString(),
        active1m: a1?.n || 0,
        active5m: a5?.n || 0,
        views1h: v1?.n || 0,
        views24h: v24?.n || 0,
        topPaths: top,
        perMinute: perMin,
      };
    });
    res.json(data);
  }),
);

/* ============================ Admin prefix API rewrite ============================ */
/* When a custom prefix is set (e.g. "teamspace"), requests to /teamspace/settings,
   /teamspace/keywords, etc. are transparently rewritten to /api/admin/settings,
   /api/admin/keywords, etc. — so all admin API routes follow the prefix.
   /teamspace/import/* maps to /api/import/* as well.                                */

app.use(async (req, res, next) => {
  const segs = req.path.split("/");
  if (segs.length < 3) return next();
  const firstSeg = segs[1] || "";
  if (firstSeg === "api" || firstSeg === "admin") return next();
  try {
    const cfg = await cached("api:config", 30000, async () => {
      const s = await getAutoSettings();
      return { adminPrefix: (s.adminPrefix || "").replace(/[^a-z0-9-]/g, "") };
    });
    if (cfg.adminPrefix && cfg.adminPrefix !== "admin" && firstSeg === cfg.adminPrefix) {
      const rest = req.path.slice(cfg.adminPrefix.length + 1);
      if (rest.startsWith("import/")) {
        req.url = `/api/${rest}${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`;
      } else {
        req.url = `/api/admin/${rest}${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`;
      }
    }
  } catch {
    /* ignore */
  }
  next();
});

/* ============================ Auto-import / Automation ============================ */

app.get(
  "/api/admin/settings",
  requireAdmin,
  ah(async (_req, res) => {
    const s = await getAutoSettings();
    res.json(s);
  }),
);

app.post(
  "/api/admin/settings",
  requireAdmin,
  ah(async (req, res) => {
    await saveAutoSettings(req.body);
    invalidate("api:config");
    invalidate("settings:auto_import");
    // The automation process (or the in-process watchdog, in single-process
    // mode) detects thumbnailAutoClean changes and re-arms its 24h timer.
    res.json({ ok: true });
  }),
);

app.get(
  "/api/admin/keywords",
  requireAdmin,
  ah(async (_req, res) => {
    const keywords = await getKeywords();
    res.json({ keywords });
  }),
);

app.post(
  "/api/admin/keywords",
  requireAdmin,
  ah(async (req, res) => {
    const { keyword, priority } = req.body || {};
    try {
      const row = await addKeyword(keyword, priority);
      res.json({ keyword: row });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }),
);

app.put(
  "/api/admin/keywords/:id",
  requireAdmin,
  ah(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });
    const row = await updateKeyword(id, req.body || {});
    if (!row) return res.status(404).json({ error: "Not found" });
    res.json({ keyword: row });
  }),
);

app.delete(
  "/api/admin/keywords/:id",
  requireAdmin,
  ah(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });
    const found = await deleteKeyword(id);
    if (!found) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  }),
);

app.get(
  "/api/admin/logs",
  requireAdmin,
  ah(async (req, res) => {
    const { limit, offset } = pageParams(req, {
      defaultLimit: 50,
      maxLimit: 50,
    });
    const filterType = req.query.type || null;
    const logs = await getLogs(limit, offset, filterType);
    res.json({ logs });
  }),
);

app.post(
  "/api/admin/logs/clear",
  requireAdmin,
  ah(async (_req, res) => {
    await clearLogs();
    res.json({ ok: true });
  }),
);

app.get(
  "/api/admin/stats",
  requireAdmin,
  ah(async (_req, res) => {
    const status = await getAutoStatus();
    const [totalVideos, totalComments, totalUsers] = await Promise.all([
      one("SELECT COUNT(*)::int AS n FROM videos"),
      one("SELECT COUNT(*)::int AS n FROM comments"),
      one("SELECT COUNT(*)::int AS n FROM users"),
    ]);
    res.json({
      totalVideos: totalVideos?.n || 0,
      totalComments: totalComments?.n || 0,
      totalUsers: totalUsers?.n || 0,
      ...status,
    });
  }),
);

app.get(
  "/api/import/status",
  requireAdmin,
  ah(async (_req, res) => {
    const status = await getAutoStatus();
    res.json(status);
  }),
);

app.post(
  "/api/import/start",
  requireAdmin,
  ah(async (_req, res) => {
    // Worker mode: relay to the dedicated automation process. Direct mode:
    // run the engine right here (single-process deployments).
    const result = AUTOMATION_WORKER_MODE
      ? await enqueueAutomationCommand("start")
      : await startAutomation();
    if (!result.ok) return res.status(429).json(result);
    // In worker mode the command is applied asynchronously by the automation
    // process; wait for it so the response (and the frontend card) reflects
    // the post-apply state instead of a stale one.
    const status = AUTOMATION_WORKER_MODE
      ? await waitForAutomationStatus((s) => s === "RUNNING", 5000)
      : await getAutoStatus();
    res.json({ ...result, status });
  }),
);

app.post(
  "/api/import/stop",
  requireAdmin,
  ah(async (_req, res) => {
    const result = AUTOMATION_WORKER_MODE
      ? await enqueueAutomationCommand("stop")
      : await stopAutomation();
    // Same as above: don't answer until the worker has actually stopped, so
    // the frontend never keeps showing the countdown after Stop is pressed.
    const status = AUTOMATION_WORKER_MODE
      ? await waitForAutomationStatus((s) => s === "STOPPED")
      : await getAutoStatus();
    res.json({ ...result, status });
  }),
);

app.post(
  "/api/import/manual",
  requireAdmin,
  ah(async (_req, res) => {
    const result = AUTOMATION_WORKER_MODE
      ? await enqueueAutomationCommand("manual")
      : await triggerManualImport();
    if (!result.ok) return res.status(409).json(result);
    res.json(result);
  }),
);

app.post(
  "/api/import/scan-thumbnails",
  requireAdmin,
  ah(async (_req, res) => {
    const result = AUTOMATION_WORKER_MODE
      ? await enqueueAutomationCommand("scan-thumbnails")
      : await triggerThumbnailScan();
    if (!result.ok) return res.status(409).json(result);
    res.json(result);
  }),
);

/* ============================ OpenRouter models & API keys ============================ */

app.get(
  "/api/admin/openrouter/models",
  requireAdmin,
  ah(async (_req, res) => {
    const models = await fetchOpenRouterModels();
    res.json({ models });
  }),
);

app.get(
  "/api/admin/openrouter/keys",
  requireAdmin,
  ah(async (_req, res) => {
    const keys = await getApiKeys();
    const sanitized = keys.map((k) => ({
      id: k.id,
      label: k.label || "",
      priority: k.priority || 99,
      partial: k.key ? k.key.slice(0, 12) + "..." : "",
    }));
    res.json({ keys: sanitized, hasEnvKey: !!process.env.OPENROUTER_API_KEY });
  }),
);

app.post(
  "/api/admin/openrouter/keys",
  requireAdmin,
  ah(async (req, res) => {
    const { key, label, priority } = req.body || {};
    if (!key || !key.startsWith("sk-or-"))
      return res.status(400).json({ error: "Invalid OpenRouter key format" });
    const keys = await getApiKeys();
    const id = `or-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    keys.push({ id, key, label: label || "", priority: priority || 99 });
    await saveApiKeys(keys);
    res.json({ ok: true, id });
  }),
);

app.delete(
  "/api/admin/openrouter/keys/:id",
  requireAdmin,
  ah(async (req, res) => {
    const keys = await getApiKeys();
    const filtered = keys.filter((k) => k.id !== req.params.id);
    if (filtered.length === keys.length) return res.status(404).json({ error: "Key not found" });
    await saveApiKeys(filtered);
    res.json({ ok: true });
  }),
);

app.patch(
  "/api/admin/openrouter/keys/:id",
  requireAdmin,
  ah(async (req, res) => {
    const keys = await getApiKeys();
    const idx = keys.findIndex((k) => k.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Key not found" });
    if (req.body.priority != null) keys[idx].priority = req.body.priority;
    if (req.body.label != null) keys[idx].label = req.body.label;
    await saveApiKeys(keys);
    res.json({ ok: true });
  }),
);

/* ============================ Eporner proxy ============================ */

app.get(
  "/api/eporner/video/search",
  requireAdmin,
  rateLimit({ name: "eporner-search", limit: 120, windowMs: 60_000 }),
  ah(async (req, res) => {
    const params = new URLSearchParams({
      query: String(req.query.query || ""),
      per_page: String(req.query.per_page || "20"),
      page: String(req.query.page || "1"),
      thumbsize: String(req.query.thumbsize || "big"),
      order: String(req.query.order || "latest"),
      gay: "0",
      lq: String(req.query.lq || "0"),
      format: "json",
    });
    const url = `https://www.eporner.com/api/v2/video/search/?${params}`;
    const opts = {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HDPORNFORYOU/2.0)" },
      redirect: "follow",
    };
    let r;
    for (let i = 0; i < 3; i++) {
      try {
        r = await fetch(url, { ...opts, signal: AbortSignal.timeout(20000 + i * 10000) });
        break;
      } catch (e) {
        if (i === 2 || e.name === "AbortError")
          return res.status(502).json({ error: "Eporner unreachable" });
      }
    }
    if (!r.ok) return res.status(r.status).json({ error: `Eporner API error ${r.status}` });
    const data = await r.json();
    res.json(data);
  }),
);

/* ============================ AI counter reset ============================ */

app.post(
  "/api/admin/ai-counter",
  requireAdmin,
  ah(async (req, res) => {
    const count = Number(req.body?.count ?? 0);
    await setAiCounterValue(count);
    // In worker mode also sync the dedicated automation process's in-memory
    // counter so a PAUSED engine sees the headroom on its next poll tick.
    if (AUTOMATION_WORKER_MODE) {
      await enqueueAutomationCommand("set-ai-counter", { count });
    }
    res.json({ ok: true, count });
  }),
);

/* ============================ AI enrich for VideoImporter ============================ */

app.post(
  "/api/admin/ai/enrich",
  requireAdmin,
  ah(async (req, res) => {
    const videos = Array.isArray(req.body?.videos) ? req.body.videos : [];
    if (!videos.length) return res.status(400).json({ error: "No videos provided" });

    const settings = await getAutoSettings();
    if (!settings.aiEnabled) return res.status(400).json({ error: "AI is disabled" });

    try {
      const catSlugs = await fetchCategorySlugs();
      const categories = catSlugs.map((s) => ({ slug: s }));
      // Split into small chunks so each request fits the capped max_tokens
      // (works even on a low OpenRouter credit balance).
      const results = await enrichInChunks(
        videos,
        settings.aiModel,
        settings.aiPrompt,
        categories,
        { aiDailyLimit: settings.aiDailyLimit },
      );
      res.json({ results });
    } catch (e) {
      const msg = e && e.message ? String(e.message) : "AI enrichment failed";
      // Detect OpenRouter rate-limit / quota errors and surface a clean message.
      let status = 502;
      if (/\b429\b|rate limit|too many requests/i.test(msg)) status = 429;
      else if (/\b401\b|\b403\b|unauthor/i.test(msg)) status = 401;
      else if (/\b402\b|insufficient|credits|quota|limit/i.test(msg)) status = 402;
      else if (/timeout|aborterror/i.test(msg)) status = 504;
      console.error("[ai/enrich]", msg);
      res.status(status).json({ error: msg });
    }
  }),
);

/* ============================ Admin route redirect ============================ */

/* ============================ Health & static ============================ */

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

/* ============================ Sitemap ============================ */

const SITEMAP_PAGE_SIZE = 50000;
const SSR_PAGE_SIZE = 22;
const CATEGORY_MIN_VIDEOS = 2;
// Tags with fewer videos than this are treated as thin content: they stay
// reachable and return 200, but are noindexed and omitted from sitemaps.
const TAG_MIN_VIDEOS = Math.max(1, parseInt(process.env.TAG_MIN_VIDEOS || "2", 10) || 2);

async function getSitemapHost(req) {
  let host = `${req.protocol}://${req.get("host")}`;
  try {
    const seoRow = await one("SELECT value FROM settings WHERE key = 'seo'");
    const seoVal = seoRow ? (typeof seoRow.value === "string" ? JSON.parse(seoRow.value) : seoRow.value) : null;
    if (seoVal?.canonicalBase && typeof seoVal.canonicalBase === "string" && seoVal.canonicalBase.trim()) {
      host = seoVal.canonicalBase.trim().replace(/\/$/, "");
    } else {
      const envBase = String(process.env.SEO_CANONICAL_BASE || "").trim().replace(/\/$/, "");
      if (envBase) host = envBase;
      else if (/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(host)) host = "https://hdpornforyou.com";
    }
  } catch {}
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(host)) host = "https://hdpornforyou.com";
  return host;
}

function sitemapEsc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function sendSitemapXml(req, res, xml) {
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.setHeader("Vary", "Accept-Encoding");
  const enc = String(req.headers["accept-encoding"] || "");
  if (/\bgzip\b/.test(enc)) {
    try {
      const gz = zlib.gzipSync(Buffer.from(xml, "utf8"));
      res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Content-Length", String(gz.length));
      return res.send(gz);
    } catch {}
  }
  return res.send(xml);
}

app.get(
  "/sitemap.xml",
  ah(async (_req, res) => {
    await checkVideosEpoch().catch(() => {});
    const countRow = await one("SELECT COUNT(*)::int as n FROM videos");
    const total = countRow?.n || 0;
    const pages = Math.max(1, Math.ceil(total / SITEMAP_PAGE_SIZE));
    const host = await getSitemapHost(_req);
    // If unlimited (>50k) return sitemap index, else single sitemap via cached generator
    if (total > SITEMAP_PAGE_SIZE) {
      let maxIso = new Date().toISOString();
      try {
        const mr = await one("SELECT MAX(updated_at) as max FROM videos");
        if (mr?.max) maxIso = new Date(mr.max).toISOString();
      } catch {}
      let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
      xml += `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
      xml += `  <sitemap><loc>${sitemapEsc(host + "/sitemap-static.xml")}</loc><lastmod>${sitemapEsc(maxIso)}</lastmod></sitemap>\n`;
      for (let p = 1; p <= pages; p++) {
        xml += `  <sitemap><loc>${sitemapEsc(host + "/sitemap-videos-" + p + ".xml")}</loc><lastmod>${sitemapEsc(maxIso)}</lastmod></sitemap>\n`;
      }
      xml += `</sitemapindex>`;
      return sendSitemapXml(_req, res, xml);
    }
    // host outside cached: cache raw data only, render XML with current host outside
    const cacheData = await cached(`sitemap:xml:data:v2:${TAG_MIN_VIDEOS}`, 300000, async () => {
      const rows = await many(
        `SELECT id, slug, data, updated_at FROM videos ORDER BY updated_at DESC, id DESC LIMIT ${SITEMAP_PAGE_SIZE}`,
      );
      let cats = [];
      let tagRows = [];
      try {
        cats = await many(
          "SELECT data->>'category' AS cat, COUNT(*)::int AS cnt FROM videos WHERE data->>'category' IS NOT NULL GROUP BY 1 HAVING COUNT(*) >= $1 LIMIT 100",
          [CATEGORY_MIN_VIDEOS],
        );
      } catch {}
      try {
        tagRows = await many(`
          SELECT tag, COUNT(*)::int as cnt
          FROM (SELECT jsonb_array_elements_text(data->'tags') as tag FROM videos) t
          WHERE tag IS NOT NULL AND tag <> ''
          GROUP BY tag ORDER BY cnt DESC LIMIT 500
        `);
      } catch {}
      return { rows, cats, tagRows };
    });
    const nowIso = new Date().toISOString();
    let maxIso = nowIso;
    try {
      const mr = await one("SELECT MAX(updated_at) as max FROM videos");
      if (mr?.max) maxIso = new Date(mr.max).toISOString();
    } catch {}
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n`;
    const staticPages = ["/", "/explore", "/trending", "/latest", "/about", "/contact", "/privacy", "/terms", "/dmca", "/2257", "/careers", "/press"];
    for (const p of staticPages) {
      xml += `  <url><loc>${sitemapEsc(host + p)}</loc><lastmod>${sitemapEsc(maxIso)}</lastmod><changefreq>weekly</changefreq><priority>${p === "/" ? "1.0" : "0.5"}</priority></url>\n`;
    }
    for (const c of cacheData.cats) {
      const slug = c.cat;
      if (!slug) continue;
      xml += `  <url><loc>${sitemapEsc(host + "/category/" + encodeURIComponent(slug))}</loc><lastmod>${sitemapEsc(maxIso)}</lastmod><changefreq>weekly</changefreq><priority>0.6</priority></url>\n`;
    }
    for (const t of cacheData.tagRows) {
      if (Number(t.cnt) < TAG_MIN_VIDEOS) continue;
      const slug = String(t.tag).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      if (!slug) continue;
      xml += `  <url><loc>${sitemapEsc(host + "/tags/" + encodeURIComponent(slug))}</loc><lastmod>${sitemapEsc(maxIso)}</lastmod><changefreq>weekly</changefreq><priority>0.5</priority></url>\n`;
    }
    for (const r of cacheData.rows) {
      const d = typeof r.data === "string" ? JSON.parse(r.data) : r.data || {};
      const slug = r.slug || d.slug || r.id;
      const lastmod = r.updated_at ? new Date(r.updated_at).toISOString() : "";
      const thumb = d.thumbnail || "";
      xml += `  <url>\n`;
      xml += `    <loc>${sitemapEsc(host + "/watch/" + encodeURIComponent(r.id) + "/" + encodeURIComponent(slug))}</loc>\n`;
      if (lastmod) xml += `    <lastmod>${sitemapEsc(lastmod)}</lastmod>\n`;
      xml += `    <changefreq>weekly</changefreq>\n`;
      xml += `    <priority>0.7</priority>\n`;
      if (thumb) xml += `    <image:image><image:loc>${sitemapEsc(thumb)}</image:loc></image:image>\n`;
      xml += `  </url>\n`;
    }
    xml += `</urlset>`;
    return sendSitemapXml(_req, res, xml);
  }),
);

// Static sitemap for unlimited handling (categories + tags + static)
app.get(
  "/sitemap-static.xml",
  ah(async (_req, res) => {
    await checkVideosEpoch().catch(() => {});
    const host = await getSitemapHost(_req);
    const cacheData = await cached(`sitemap:static:data:v2:${TAG_MIN_VIDEOS}`, 300000, async () => {
      let cats = [];
      let tagRows = [];
      try {
        cats = await many(
          "SELECT data->>'category' AS cat, COUNT(*)::int AS cnt FROM videos WHERE data->>'category' IS NOT NULL GROUP BY 1 HAVING COUNT(*) >= $1 LIMIT 100",
          [CATEGORY_MIN_VIDEOS],
        );
      } catch {}
      try {
        tagRows = await many(`SELECT tag, COUNT(*)::int as cnt FROM (SELECT jsonb_array_elements_text(data->'tags') as tag FROM videos) t WHERE tag IS NOT NULL AND tag <> '' GROUP BY tag ORDER BY cnt DESC LIMIT 500`);
      } catch {}
      return { cats, tagRows };
    });
    const nowIso = new Date().toISOString();
    let maxIso = nowIso;
    try {
      const mr = await one("SELECT MAX(updated_at) as max FROM videos");
      if (mr?.max) maxIso = new Date(mr.max).toISOString();
    } catch {}
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n`;
    const staticPages = ["/", "/explore", "/trending", "/latest", "/about", "/contact", "/privacy", "/terms", "/dmca", "/2257", "/careers", "/press"];
    for (const p of staticPages) xml += `  <url><loc>${sitemapEsc(host + p)}</loc><lastmod>${sitemapEsc(maxIso)}</lastmod><changefreq>weekly</changefreq><priority>${p === "/" ? "1.0" : "0.5"}</priority></url>\n`;
    for (const c of cacheData.cats) if (c.cat) xml += `  <url><loc>${sitemapEsc(host + "/category/" + encodeURIComponent(c.cat))}</loc><lastmod>${sitemapEsc(maxIso)}</lastmod><changefreq>weekly</changefreq><priority>0.6</priority></url>\n`;
    for (const t of cacheData.tagRows) {
      if (Number(t.cnt) < TAG_MIN_VIDEOS) continue;
      const slug = String(t.tag).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      if (slug) xml += `  <url><loc>${sitemapEsc(host + "/tags/" + encodeURIComponent(slug))}</loc><lastmod>${sitemapEsc(maxIso)}</lastmod><changefreq>weekly</changefreq><priority>0.5</priority></url>\n`;
    }
    xml += `</urlset>`;
    return sendSitemapXml(_req, res, xml);
  }),
);

app.get(
  "/sitemap-videos-:page.xml",
  ah(async (req, res) => {
    await checkVideosEpoch().catch(() => {});
    const page = Math.max(1, parseInt(String(req.params.page).replace(/\D/g, "")) || 1);
    const host = await getSitemapHost(req);
    // Return 404 for page beyond totalPages instead of empty urlset
    try {
      const cntRow = await one("SELECT COUNT(*)::int AS n FROM videos");
      const total = cntRow?.n || 0;
      const totalPages = Math.max(1, Math.ceil(total / SITEMAP_PAGE_SIZE));
      if (page > totalPages) {
        res.status(404);
        const empty = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n</urlset>`;
        return sendSitemapXml(req, res, empty);
      }
    } catch {}
    // host outside cached: cache rows only (no host in key), render XML with host after
    const rows = await cached(`sitemap:videos:rows:${page}`, 300000, async () => {
      if (page === 1) {
        return await many(`SELECT id, slug, data, updated_at FROM videos ORDER BY updated_at DESC, id DESC LIMIT ${SITEMAP_PAGE_SIZE}`);
      }
      // iterative keyset pagination without OFFSET: walk page by page using WHERE (updated_at,id) < cursor
      let cursorUpdatedAt = null;
      let cursorId = null;
      for (let p = 1; p < page; p++) {
        let batch;
        if (cursorUpdatedAt === null) {
          batch = await many(`SELECT updated_at, id FROM videos ORDER BY updated_at DESC, id DESC LIMIT ${SITEMAP_PAGE_SIZE}`);
        } else {
          batch = await many(`SELECT updated_at, id FROM videos WHERE (updated_at, id) < ($1::timestamptz, $2::text) ORDER BY updated_at DESC, id DESC LIMIT ${SITEMAP_PAGE_SIZE}`, [cursorUpdatedAt, cursorId]);
        }
        if (!batch.length) return [];
        if (batch.length < SITEMAP_PAGE_SIZE) return [];
        const last = batch[batch.length - 1];
        cursorUpdatedAt = last.updated_at;
        cursorId = last.id;
      }
      if (cursorUpdatedAt === null) return [];
      return await many(`SELECT id, slug, data, updated_at FROM videos WHERE (updated_at, id) < ($1::timestamptz, $2::text) ORDER BY updated_at DESC, id DESC LIMIT ${SITEMAP_PAGE_SIZE}`, [cursorUpdatedAt, cursorId]);
    });
    if (!Array.isArray(rows) || !rows.length) {
      res.status(404);
      const empty = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n</urlset>`;
      return sendSitemapXml(req, res, empty);
    }
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n`;
    for (const r of rows) {
      const d = typeof r.data === "string" ? JSON.parse(r.data) : r.data || {};
      const slug = r.slug || d.slug || r.id;
      const lastmod = r.updated_at ? new Date(r.updated_at).toISOString() : "";
      const thumb = d.thumbnail || "";
      xml += `  <url><loc>${sitemapEsc(host + "/watch/" + encodeURIComponent(r.id) + "/" + encodeURIComponent(slug))}</loc>${lastmod ? `<lastmod>${sitemapEsc(lastmod)}</lastmod>` : ""}<changefreq>weekly</changefreq><priority>0.7</priority>${thumb ? `<image:image><image:loc>${sitemapEsc(thumb)}</image:loc></image:image>` : ""}</url>\n`;
    }
    xml += `</urlset>`;
    return sendSitemapXml(req, res, xml);
  }),
);

// Final error handler — never leak stack traces in prod.
// NOTE: this MUST be registered AFTER the static SPA fallback below so that
// errors thrown inside that handler are also caught.

// JSON 404 for any unmatched /api/* route — without this, Express returns
// its default HTML "Cannot GET /api/…" page, which the browser fetch
// wrapper doesn't know how to parse as JSON.
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Not found" });
  }
  next();
});

// Serve the Vite "public/" folder FIRST so files dropped there (e.g.
// exoclick.html, custom verification files, etc.) are accessible
// immediately without a rebuild — mirroring Vite's dev-server behaviour.
// Static files here get a short cache so updates are picked up quickly.
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(
    express.static(PUBLIC_DIR, {
      maxAge: "5m",
      etag: true,
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}fonts${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );
}

// --- SSR helpers for SEO prerender ---
function ssrEscape(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function ssrSlugify(s) {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function ssrTitleCase(s) {
  return String(s || "")
    .trim()
    .split(/\s+/)
    .map((word) => {
      if (!word) return "";
      if (word.toLowerCase() === "bbc") return "BBC";
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}
function ssrGetEmbedId(embedUrl, fallbackId) {
  const url = String(embedUrl || "");
  const patterns = [/\/embed\/([A-Za-z0-9_-]{6,})/, /[?&]v=([A-Za-z0-9_-]{6,})/, /\/v\/([A-Za-z0-9_-]{6,})/, /youtu\.be\/([A-Za-z0-9_-]{6,})/];
  for (const re of patterns) {
    const m = url.match(re);
    if (m && m[1]) return m[1];
  }
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean).pop();
    if (seg) return seg;
  } catch {}
  return fallbackId;
}
function ssrToISO8601(d) {
  if (!d || d === "LIVE") return "PT0S";
  const parts = d.split(":").map((p) => parseInt(p, 10));
  if (parts.some(isNaN)) return "PT0S";
  let h = 0, m = 0, s = 0;
  if (parts.length === 3) [h, m, s] = parts;
  else if (parts.length === 2) [m, s] = parts;
  else if (parts.length === 1) s = parts[0];
  let out = "PT";
  if (h) out += `${h}H`;
  if (m) out += `${m}M`;
  if (s || (!h && !m)) out += `${s}S`;
  return out;
}
function ssrUpsertMeta(html, attr, key, content) {
  const esc = ssrEscape(content);
  const escKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<meta\\s+[^>]*${attr}\\s*=\\s*["']${escKey}["'][^>]*>`, "i");
  const tag = `<meta ${attr}="${key}" content="${esc}">`;
  if (re.test(html)) return html.replace(re, tag);
  return html.replace("</head>", `  ${tag}\n</head>`);
}
function ssrUpsertLink(html, rel, href) {
  const esc = ssrEscape(href);
  const escRel = rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<link\\s+[^>]*rel\\s*=\\s*["']${escRel}["'][^>]*>`, "i");
  const tag = `<link rel="${rel}" href="${esc}">`;
  if (re.test(html)) return html.replace(re, tag);
  return html.replace("</head>", `  ${tag}\n</head>`);
}
function ssrRemoveLinkByRel(html, rel) {
  const escRel = rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.replace(new RegExp(`\\s*<link\\s+[^>]*rel\\s*=\\s*["']${escRel}["'][^>]*>`, "gi"), "");
}
function ssrRemoveHreflangLinks(html) {
  return html.replace(/\s*<link\s+[^>]*hreflang\s*=\s*["'][^"']+["'][^>]*>/gi, "");
}
function ssrRemoveMeta(html, attr, key) {
  const escKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.replace(
    new RegExp(`\\s*<meta\\s+[^>]*${attr}\\s*=\\s*["']${escKey}["'][^>]*>`, "gi"),
    "",
  );
}
function ssrRemoveJsonLd(html) {
  return html.replace(/\s*<script\s+[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi, "");
}
function ssrUpsertHreflang(html, hreflang, href) {
  const esc = ssrEscape(href);
  const escLang = hreflang.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<link\\s+[^>]*hreflang\\s*=\\s*["']${escLang}["'][^>]*>`, "i");
  const tag = `<link rel="alternate" hreflang="${hreflang}" href="${esc}">`;
  if (re.test(html)) return html.replace(re, tag);
  return html.replace("</head>", `  ${tag}\n</head>`);
}
async function ssrGetBrandName() {
  try {
    const row = await one("SELECT value FROM settings WHERE key = 'labels'");
    const v = row ? (typeof row.value === "string" ? JSON.parse(row.value) : row.value) : null;
    if (v && typeof v.brandName === "string" && v.brandName.trim()) return v.brandName.trim();
  } catch {}
  return "HDPORNFORYOU";
}
async function ssrGetContactEmail() {
  try {
    const row = await one("SELECT value FROM settings WHERE key = 'labels'");
    const v = row ? (typeof row.value === "string" ? JSON.parse(row.value) : row.value) : null;
    if (v && typeof v.contactEmail === "string" && v.contactEmail.trim()) return v.contactEmail.trim();
  } catch {}
  return "contact@hdpornforyou.com";
}
async function ssrGetCanonicalBase(req) {
  try {
    const row = await one("SELECT value FROM settings WHERE key = 'seo'");
    const v = row ? (typeof row.value === "string" ? JSON.parse(row.value) : row.value) : null;
    if (v?.canonicalBase && typeof v.canonicalBase === "string" && v.canonicalBase.trim()) return v.canonicalBase.trim().replace(/\/$/, "");
  } catch {}
  const envBase = String(process.env.SEO_CANONICAL_BASE || "").trim().replace(/\/$/, "");
  if (envBase) return envBase;
  const host = `${req.protocol}://${req.get("host")}`;
  // Ensure canonical always points to production domain when DB is empty and request is from localhost/dev
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(host)) return "https://hdpornforyou.com";
  return host;
}
function ssrAbsoluteUrl(base, value) {
  const v = String(value || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return `${String(base || "").replace(/\/$/, "")}/${v.replace(/^\/+/, "")}`;
}
async function ssrGetSeoOgImage(req) {
  const base = await ssrGetCanonicalBase(req);
  try {
    const row = await one("SELECT value FROM settings WHERE key = 'seo'");
    const v = row ? (typeof row.value === "string" ? JSON.parse(row.value) : row.value) : null;
    const img = v?.og?.image || v?.ogImage;
    if (img) return ssrAbsoluteUrl(base, img);
  } catch {}
  return `${base}/og-image.jpg`;
}
let ssrIndexTemplateCache = { mtimeMs: 0, html: "" };
function ssrReadIndexTemplate(indexFile) {
  try {
    const stat = fs.statSync(indexFile);
    if (stat.mtimeMs !== ssrIndexTemplateCache.mtimeMs) {
      ssrIndexTemplateCache = {
        mtimeMs: stat.mtimeMs,
        html: fs.readFileSync(indexFile, "utf8"),
      };
    }
    return ssrIndexTemplateCache.html;
  } catch {
    return fs.readFileSync(indexFile, "utf8");
  }
}
async function ssrGetSeoVideoCards({
  category = "",
  tagRaw = "",
  tagSlug = "",
  tagDisplay = "",
  limit = 24,
  offset = 0,
} = {}) {
  const lim = Math.min(48, Math.max(1, Number(limit) || 24));
  const off = Math.max(0, Number(offset) || 0);
  let rows = [];
  if (category) {
    rows = await many(
      `SELECT id, slug, data FROM videos WHERE data->>'category' = $1
       ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT $2 OFFSET $3`,
      [category, lim, off],
    );
  } else if (tagRaw) {
    rows = await many(
      `SELECT id, slug, data FROM videos
       WHERE EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(data->'tags') t
         WHERE lower(t) = lower($1)
            OR lower(replace(t, ' ', '-')) = lower($2)
            OR lower(t) = lower($3)
       )
       ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT $4 OFFSET $5`,
      [tagRaw, tagSlug, tagDisplay, lim, off],
    );
  } else {
    rows = await many(
      `SELECT id, slug, data FROM videos ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT $1 OFFSET $2`,
      [lim, off],
    );
  }
  return rows.map((row) => {
    const d = typeof row.data === "string" ? JSON.parse(row.data) : row.data || {};
    const eid = ssrGetEmbedId(d.embedUrl, row.id);
    const slug = row.slug || d.slug || row.id;
    return {
      title: d.title || row.id,
      thumbnail: d.thumbnail || "",
      category: d.category || "",
      href: `/watch/${encodeURIComponent(eid)}/${encodeURIComponent(slug)}`,
    };
  });
}
async function ssrGetSeoCategories(limit = 24) {
  const out = [];
  try {
    const row = await one("SELECT value FROM settings WHERE key = 'categories'");
    const value = row ? (typeof row.value === "string" ? JSON.parse(row.value) : row.value) : null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const name = typeof item === "string" ? item : item?.name || item?.slug;
        const slug = typeof item === "string" ? item : item?.slug || item?.name;
        if (name && slug && slug !== "all") out.push({ name, slug });
      }
    }
  } catch {}
  if (!out.length) {
    try {
      const rows = await many(
        `SELECT DISTINCT data->>'category' AS name FROM videos
         WHERE data->>'category' IS NOT NULL AND data->>'category' <> ''
         ORDER BY name LIMIT $1`,
        [Math.min(48, Math.max(1, Number(limit) || 24))],
      );
      for (const row of rows) {
        if (row.name) out.push({ name: row.name, slug: row.name });
      }
    } catch {}
  }
  return out.slice(0, Math.max(1, Number(limit) || 24));
}

// Legacy single-segment /watch/:slug → 301 to canonical /watch/:embedId/:slug for SEO.
// Must be registered before the SPA fallback so crawlers follow the canonical URL.
// Client intentionally skips this redirect (watch.$slug.tsx) to avoid animation flicker.
app.get(
  "/watch/:slug",
  ah(async (req, res, next) => {
    // Only handle single-segment /watch/:slug; /watch/:embedId/:slug has two segments and won't match this route.
    const slugParam = String(req.params.slug || "").trim();
    if (!slugParam) return next();
    try {
      let videoRow = await one(
        "SELECT id, slug, data FROM videos WHERE id = $1 OR slug = $1 LIMIT 1",
        [slugParam],
      );
      if (!videoRow) {
        try {
          videoRow = await one(
            "SELECT id, slug, data FROM videos WHERE data->>'embedUrl' LIKE '%' || $1 || '%' LIMIT 1",
            [slugParam],
          );
        } catch {}
      }
      if (!videoRow) return next();
      const d = typeof videoRow.data === "string" ? JSON.parse(videoRow.data) : videoRow.data || {};
      const eid = ssrGetEmbedId(d.embedUrl, videoRow.id);
      const canonicalSlug = videoRow.slug || d.slug || videoRow.id;
      const target = `/watch/${encodeURIComponent(eid)}/${encodeURIComponent(canonicalSlug)}`;
      const qs = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
      // Preserve query string, 301 permanent for SEO
      return res.redirect(301, target + qs);
    } catch {
      return next();
    }
  }),
);

// Then serve the built SPA assets from dist/.
if (fs.existsSync(STATIC_DIR)) {
  // Keep a single canonical entry point. Without this, /index.html is directly
  // indexable and duplicates the home page.
  app.get(["/index.html", "/index.htm"], (req, res) => {
    const qs = req.originalUrl.includes("?")
      ? req.originalUrl.slice(req.originalUrl.indexOf("?"))
      : "";
    return res.redirect(301, `/${qs}`);
  });
  // index:false is critical: the SSR meta renderer below must own "/" and
  // "/?page=N". Letting express.static answer "/" bypasses all SSR metadata.
  app.use(
    express.static(STATIC_DIR, {
      index: false,
      maxAge: "1h",
      etag: true,
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );
  app.get(
    "*",
    ah(async (req, res, next) => {
      if (req.path.startsWith("/api/")) return next();
      const KNOWN_EXACT = new Set(["/", "/explore", "/trending", "/latest", "/search", "/about", "/contact", "/privacy", "/terms", "/dmca", "/2257", "/careers", "/press", "/account", "/setup"]);
      const KNOWN_PREFIXES = ["/watch/", "/category/", "/tags/"];
      function isKnownRoute(p) {
        const norm = p.endsWith("/") && p.length > 1 ? p.slice(0, -1) : p;
        if (KNOWN_EXACT.has(norm) || KNOWN_EXACT.has(p)) return true;
        for (const pref of KNOWN_PREFIXES) if (p.startsWith(pref)) return true;
        return false;
      }

      let status = 200;
      let ssrTitle = null;
      let ssrDesc = null;
      let ssrCanonical = null;
      let ssrOgImage = null;
      let ssrOgType = "website";
      let ssrRobots = null;
      let ssrPrev = null;
      let ssrNext = null;
      let ssrPageType = "page";
      let ssrHeading = "";
      let ssrStaticTitle = "";
      let ssrStaticDescription = "";
      let ssrVideo = null;
      let ssrTags = [];
      let ssrCategory = "";
      let ssrTagRaw = "";
      let ssrTagSlug = "";
      let ssrTagDisplay = "";
      let ssrPage = 1;
      let ssrTotalPages = 1;
      const ssrJsonLds = [];

      try {
        const pth = req.path;
        if (!isKnownRoute(pth)) {
          status = 404;
        } else if (pth === "/search") {
          ssrPageType = "search";
          const brand = await ssrGetBrandName();
          const base = await ssrGetCanonicalBase(req);
          const q = String(req.query.q || req.query.query || "").trim().slice(0, 120);
          ssrTitle = q ? `Search results for "${q}" | ${brand}` : `Search | ${brand}`;
          ssrHeading = q ? `Search results for "${q}"` : "Search";
          ssrDesc = q
            ? `Search results for "${q}" on ${brand} — browse free 18+ embedded videos, all models 18+.`
            : `Search free 18+ videos on ${brand} — all content embedded via Eporner, no files hosted.`;
          ssrCanonical = `${base}/search`;
          ssrRobots = "noindex,follow";
        } else if (pth.startsWith("/watch/")) {
          const parts = pth.split("/").filter(Boolean);
          const idPart = parts[1] || "";
          const slugPart = parts[2] || "";
          let videoRow = null;
          if (idPart) {
            videoRow = await one("SELECT id, slug, data, views, views_boost, updated_at FROM videos WHERE id = $1 OR slug = $1 LIMIT 1", [idPart]);
            if (!videoRow && slugPart) {
              videoRow = await one("SELECT id, slug, data, views, views_boost, updated_at FROM videos WHERE id = $1 OR slug = $1 LIMIT 1", [slugPart]);
            }
            if (!videoRow) {
              try {
                videoRow = await one("SELECT id, slug, data, views, views_boost, updated_at FROM videos WHERE data->>'embedUrl' LIKE '%' || $1 || '%' LIMIT 1", [idPart]);
              } catch {}
            }
          }
          if (!videoRow) {
            status = 404;
          } else {
            const d = typeof videoRow.data === "string" ? JSON.parse(videoRow.data) : videoRow.data || {};
            const brand = await ssrGetBrandName();
            const base = await ssrGetCanonicalBase(req);
            const title = `${d.title || videoRow.id} - Watch ${d.category || "Video"} Porn in HD | ${brand}`;
            const desc = (d.description || "").slice(0, 155).replace(/\s+/g, " ").trim() || `${d.title || ""} - ${(d.category || "")} porn video embedded via Eporner.`;
            const eid = ssrGetEmbedId(d.embedUrl, videoRow.id);
            const slug = videoRow.slug || d.slug || videoRow.id;
            const canonical = `${base}/watch/${encodeURIComponent(eid)}/${encodeURIComponent(slug)}`;
            ssrTitle = title;
            ssrDesc = desc;
            ssrCanonical = canonical;
            ssrOgImage = d.thumbnail || "";
            ssrOgType = "video.other";
            ssrPageType = "watch";
            ssrHeading = d.title || videoRow.id;
            ssrVideo = {
              title: d.title || videoRow.id,
              thumbnail: d.thumbnail || "",
              category: d.category || "",
              duration: d.duration || "",
              views: Number(videoRow.views || 0) + Number(videoRow.views_boost || 0) || Number(d.views || 0) || 0,
            };
            ssrTags = (Array.isArray(d.tags) ? d.tags : [])
              .filter(Boolean)
              .slice(0, 8)
              .map((tag) => ({ name: String(tag), slug: ssrSlugify(tag) }));
            const contentUrl = (d.sourceUrl ? String(d.sourceUrl).replace(/eporner\.com\/video\//, "eporner.com/video-") : `https://www.eporner.com/video-${eid}/${ssrSlugify(d.title || slug)}`);
            // Mirror client isNaN guard for uploadDate
            const _rawUploadDate = d.uploadedAt ? new Date(d.uploadedAt) : null;
            const _isoUploadDate = _rawUploadDate && !isNaN(_rawUploadDate.getTime()) ? _rawUploadDate.toISOString() : new Date(videoRow.updated_at || Date.now()).toISOString();
            ssrJsonLds.push({
              "@context": "https://schema.org",
              "@type": "VideoObject",
              name: d.title || "",
              description: desc,
              thumbnailUrl: [d.thumbnail].filter(Boolean),
              uploadDate: _isoUploadDate,
              duration: ssrToISO8601(d.duration || ""),
              embedUrl: d.embedUrl || "",
              contentUrl,
              genre: d.category || "",
              keywords: (d.tags || []).join(", "),
              interactionStatistic: {
                "@type": "InteractionCounter",
                interactionType: { "@type": "WatchAction" },
                userInteractionCount: Number(videoRow.views || 0) + Number(videoRow.views_boost || 0) || Number(d.views || 0) || 0,
              },
              isFamilyFriendly: false,
              isAccessibleForFree: true,
            });
            ssrJsonLds.push({
              "@context": "https://schema.org",
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "Home", item: `${base}/` },
                { "@type": "ListItem", position: 2, name: d.category || "Category", item: `${base}/category/${encodeURIComponent(d.category || "")}` },
                { "@type": "ListItem", position: 3, name: d.title || "", item: canonical },
              ],
            });
          }
        } else if (pth.startsWith("/category/")) {
          const slug = decodeURIComponent(pth.split("/")[2] || "").trim();
          if (slug) {
            const brand = await ssrGetBrandName();
            const base = await ssrGetCanonicalBase(req);
            let catName = null;
            let catFound = false;
            try {
              const crow = await one("SELECT value FROM settings WHERE key = 'categories'");
              if (crow) {
                const v = typeof crow.value === "string" ? JSON.parse(crow.value) : crow.value;
                if (Array.isArray(v)) {
                  const found = v.find((c) => (c.slug || c) === slug);
                  if (found) {
                    catName = found.name || found.slug || slug;
                    catFound = true;
                  }
                }
              }
            } catch {}
            if (!catFound) {
              try {
                const rows = await many("SELECT DISTINCT data->>'category' as cat FROM videos LIMIT 200");
                const list = rows.map((r) => r.cat).filter(Boolean);
                if (list.includes(slug)) {
                  catName = slug;
                  catFound = true;
                } else {
                  const vidCat = await one("SELECT 1 FROM videos WHERE data->>'category' = $1 LIMIT 1", [slug]);
                  if (vidCat) {
                    catName = slug;
                    catFound = true;
                  }
                }
              } catch {}
            }
            if (!catFound) {
              status = 404;
            } else {
              const countRow = await one("SELECT COUNT(*)::int AS n FROM videos WHERE data->>'category' = $1", [slug]).catch(() => ({ n: 0 }));
              const count = countRow?.n || 0;
              const catTotalPages = Math.max(1, Math.ceil(count / SSR_PAGE_SIZE));
              const _catPage = Math.max(1, parseInt(String(req.query?.page || "1"), 10) || 1);
              if (_catPage > catTotalPages) {
                return res.redirect(301, catTotalPages > 1 ? `${base}/category/${encodeURIComponent(slug)}?page=${catTotalPages}` : `${base}/category/${encodeURIComponent(slug)}`);
              }
              const _catSuffix = _catPage > 1 ? ` — Page ${_catPage}` : "";
              const catDisplay = ssrTitleCase(catName);
              const title = `${catDisplay} Videos - Watch ${catDisplay} in HD | ${brand}${_catSuffix}`;
              const desc = `Watch ${count} ${catDisplay} porn videos in HD on ${brand}. Free 18+ ${catDisplay} streaming, embedded via Eporner.${_catSuffix}`;
              const canonical = `${base}/category/${encodeURIComponent(slug)}${_catPage > 1 ? `?page=${_catPage}` : ""}`;
              ssrTitle = title;
              ssrDesc = desc;
              ssrCanonical = canonical;
              ssrPageType = "category";
              ssrHeading = `${catDisplay} Videos`;
              ssrCategory = catName;
              ssrPage = _catPage;
              if (count < CATEGORY_MIN_VIDEOS) ssrRobots = "noindex,follow";
              ssrTotalPages = catTotalPages;
              ssrPrev = _catPage > 1 ? (_catPage === 2 ? `${base}/category/${encodeURIComponent(slug)}` : `${base}/category/${encodeURIComponent(slug)}?page=${_catPage - 1}`) : null;
              ssrNext = _catPage < catTotalPages ? `${base}/category/${encodeURIComponent(slug)}?page=${_catPage + 1}` : null;
              ssrJsonLds.push({
                "@context": "https://schema.org",
                "@type": "CollectionPage",
                name: title,
                description: desc,
                url: canonical,
              });
              ssrJsonLds.push({
                "@context": "https://schema.org",
                "@type": "BreadcrumbList",
                itemListElement: [
                  { "@type": "ListItem", position: 1, name: "Home", item: `${base}/` },
                  { "@type": "ListItem", position: 2, name: catDisplay, item: canonical },
                ],
              });
            }
          } else {
            status = 404;
          }
        } else if (pth.startsWith("/tags/")) {
          const raw = decodeURIComponent(pth.split("/")[2] || "");
          if (raw) {
            const slug = ssrSlugify(raw);
            const displayTag = raw.replace(/-/g, " ").trim() || raw;
            const brand = await ssrGetBrandName();
            const base = await ssrGetCanonicalBase(req);
            let exists = null;
            try {
              exists = await one("SELECT 1 FROM videos WHERE EXISTS (SELECT 1 FROM jsonb_array_elements_text(data->'tags') t WHERE lower(t) = lower($1) OR lower(replace(t, ' ', '-')) = lower($2) OR lower(replace(t, ' ', '-')) = lower($3) LIMIT 1) LIMIT 1", [raw, slug, displayTag]);
              if (!exists) {
                exists = await one("SELECT 1 FROM videos WHERE EXISTS (SELECT 1 FROM jsonb_array_elements_text(data->'tags') t WHERE lower(t) = lower($1) LIMIT 1) LIMIT 1", [displayTag]);
              }
            } catch {}
            if (!exists) {
              status = 404;
            } else {
              let count = 0;
              try {
                const cr = await one("SELECT COUNT(*)::int AS n FROM (SELECT jsonb_array_elements_text(data->'tags') AS tag FROM videos) t WHERE lower(tag) = lower($1) OR lower(replace(tag,' ','-')) = lower($2) OR lower(tag) = lower($3)", [raw, slug, displayTag]);
                count = cr?.n || 0;
              } catch {}
              const tagTotalPages = Math.max(1, Math.ceil(count / SSR_PAGE_SIZE));
              const _tagPage = Math.max(1, parseInt(String(req.query?.page || "1"), 10) || 1);
              if (_tagPage > tagTotalPages) {
                return res.redirect(301, tagTotalPages > 1 ? `${base}/tags/${encodeURIComponent(slug)}?page=${tagTotalPages}` : `${base}/tags/${encodeURIComponent(slug)}`);
              }
              const _tagSuffix = _tagPage > 1 ? ` — Page ${_tagPage}` : "";
              const title = `${displayTag} Videos - Watch ${displayTag} in HD | ${brand}${_tagSuffix}`;
              const desc = `Watch ${count} ${displayTag} videos in HD on ${brand}. Free 18+ ${displayTag} porn, embedded via Eporner — no files hosted.${_tagSuffix}`;
              const canonical = `${base}/tags/${encodeURIComponent(slug)}${_tagPage > 1 ? `?page=${_tagPage}` : ""}`;
              ssrTitle = title;
              ssrDesc = desc;
              ssrCanonical = canonical;
              ssrPageType = "tag";
              ssrHeading = `${displayTag} Videos`;
              ssrTagRaw = raw;
              ssrTagSlug = slug;
              ssrTagDisplay = displayTag;
              ssrPage = _tagPage;
              if (count < TAG_MIN_VIDEOS) ssrRobots = "noindex,follow";
              ssrTotalPages = tagTotalPages;
              ssrPrev = _tagPage > 1 ? (_tagPage === 2 ? `${base}/tags/${encodeURIComponent(slug)}` : `${base}/tags/${encodeURIComponent(slug)}?page=${_tagPage - 1}`) : null;
              ssrNext = _tagPage < tagTotalPages ? `${base}/tags/${encodeURIComponent(slug)}?page=${_tagPage + 1}` : null;
              ssrJsonLds.push({
                "@context": "https://schema.org",
                "@type": "CollectionPage",
                name: title,
                description: desc,
                url: canonical,
              });
              ssrJsonLds.push({
                "@context": "https://schema.org",
                "@type": "BreadcrumbList",
                itemListElement: [
                  { "@type": "ListItem", position: 1, name: "Home", item: `${base}/` },
                  { "@type": "ListItem", position: 2, name: displayTag, item: canonical },
                ],
              });
            }
          } else {
            status = 404;
          }
        } else if (pth === "/" || pth === "/explore" || pth === "/trending" || pth === "/latest") {
          const _rawPage = Math.max(1, parseInt(String(req.query?.page || "1"), 10) || 1);
          const base = await ssrGetCanonicalBase(req);
          const brand = await ssrGetBrandName();
          // Compute totalPages before clamping title/canonical (fix duplicate title for ?page beyond range)
          let _totalPages = 1;
          try {
            if (pth === "/explore") {
              let catCount = 0;
              try {
                const crow = await one("SELECT value FROM settings WHERE key = 'categories'");
                if (crow) {
                  const v = typeof crow.value === "string" ? JSON.parse(crow.value) : crow.value;
                  if (Array.isArray(v)) catCount = v.filter((c) => (c.slug || c) !== "all").length;
                }
              } catch {}
              if (!catCount) {
                try {
                  const dr = await many("SELECT DISTINCT data->>'category' as cat FROM videos WHERE data->>'category' IS NOT NULL");
                  catCount = dr.filter((r) => r.cat).length;
                } catch {}
              }
              _totalPages = Math.max(1, Math.ceil(catCount / SSR_PAGE_SIZE));
            } else {
              const cntRow = await one("SELECT COUNT(*)::int AS n FROM videos").catch(() => ({ n: 0 }));
              const total = cntRow?.n || 0;
              if (pth === "/trending") {
                const trendCount = Math.max(1, Math.round(total * 0.15)) || 1;
                _totalPages = Math.max(1, Math.ceil(trendCount / SSR_PAGE_SIZE));
              } else {
                _totalPages = Math.max(1, Math.ceil(total / SSR_PAGE_SIZE));
              }
            }
          } catch {}
          if (_rawPage > _totalPages) {
            return res.redirect(301, _totalPages > 1 ? `${base}${pth}?page=${_totalPages}` : `${base}${pth}`);
          }
          const _page = Math.min(_rawPage, _totalPages);
          const _suffix = _page > 1 ? ` — Page ${_page}` : "";
          ssrPageType = pth === "/" ? "home" : pth.slice(1);
          ssrPage = _page;
          ssrTotalPages = _totalPages;
          if (pth === "/") {
            ssrHeading = "Watch free 18+ videos";
            ssrTitle = `Watch Free 18+ Videos | ${brand}${_suffix}`;
            ssrDesc = `Watch free 18+ videos in HD on ${brand} — thousands of embedded adult videos, all models 18+, streaming via Eporner. No files hosted.${_suffix}`;
            ssrCanonical = _page > 1 ? `${base}/?page=${_page}` : `${base}/`;
          } else if (pth === "/explore") {
            ssrHeading = "Explore categories";
            ssrTitle = `Explore Categories | ${brand}${_suffix}`;
            ssrDesc = `Browse 18+ categories on ${brand} — every section is indexed and embedded via Eporner. All models 18+, no files hosted.${_suffix}`;
            ssrCanonical = _page > 1 ? `${base}/explore?page=${_page}` : `${base}/explore`;
          } else if (pth === "/trending") {
            ssrHeading = "Trending 18+ videos";
            ssrTitle = `Trending 18+ Videos | ${brand}${_suffix}`;
            ssrDesc = `Trending 18+ videos on ${brand} — most watched embedded adult videos right now, all models 18+, streaming via Eporner.${_suffix}`;
            ssrCanonical = _page > 1 ? `${base}/trending?page=${_page}` : `${base}/trending`;
          } else if (pth === "/latest") {
            ssrHeading = "Latest 18+ uploads";
            ssrTitle = `Latest 18+ Uploads | ${brand}${_suffix}`;
            ssrDesc = `Latest 18+ uploads on ${brand} — newest embedded adult videos, all models 18+, streaming via Eporner.${_suffix}`;
            ssrCanonical = _page > 1 ? `${base}/latest?page=${_page}` : `${base}/latest`;
          }
          // paginated rel prev/next based on clamped page and total pages
          try {
            if (pth === "/") {
              ssrPrev = _page > 1 ? (_page === 2 ? `${base}/` : `${base}/?page=${_page - 1}`) : null;
              ssrNext = _page < _totalPages ? `${base}/?page=${_page + 1}` : null;
            } else {
              ssrPrev = _page > 1 ? (_page === 2 ? `${base}${pth}` : `${base}${pth}?page=${_page - 1}`) : null;
              ssrNext = _page < _totalPages ? `${base}${pth}?page=${_page + 1}` : null;
            }
          } catch {}
        } else if (pth === "/account" || pth === "/setup") {
          ssrPageType = pth === "/account" ? "account" : "setup";
          const brand = await ssrGetBrandName();
          const base = await ssrGetCanonicalBase(req);
          ssrRobots = "noindex, nofollow";
          if (pth === "/account") {
            ssrTitle = `Your account | ${brand}`;
            ssrDesc = `Sign in or create an account to save favorites and sync history on ${brand} — 18+ embedded streaming.`;
            ssrCanonical = `${base}/account`;
          } else {
            ssrTitle = `Setup | ${brand}`;
            ssrDesc = `First-run setup — create the admin account for ${brand}.`;
            ssrCanonical = `${base}/setup`;
          }
          ssrStaticTitle = ssrTitle;
          ssrStaticDescription = ssrDesc;
          ssrJsonLds.push({
            "@context": "https://schema.org",
            "@type": "WebPage",
            name: ssrTitle,
            description: ssrDesc,
            url: ssrCanonical,
          });
        } else if (["/about", "/contact", "/privacy", "/terms", "/dmca", "/2257", "/careers", "/press"].includes(pth)) {
          const brand = await ssrGetBrandName();
          const contactEmail = await ssrGetContactEmail();
          const base = await ssrGetCanonicalBase(req);
          ssrCanonical = `${base}${pth}`;
          let titleText = "";
          let subtitle = "";
          if (pth === "/about") {
            titleText = `About ${brand}`;
            subtitle = "Adults 18+ only — A fast, embed-only video discovery platform.";
          } else if (pth === "/contact") {
            titleText = "Get in touch";
            subtitle = `We usually reply within 1–2 business days. Messages go to ${contactEmail}. For DMCA or 2257 notices, please include the exact page URL and the Eporner source URL for fastest processing.`;
          } else if (pth === "/privacy") {
            titleText = "Privacy Policy";
            subtitle = "Last updated: January 2026 — How we handle your data on an 18+ embedded streaming site.";
          } else if (pth === "/terms") {
            titleText = "Terms of Service";
            subtitle = "Last updated: January 2026 — Please read carefully. You must be 18+ to use this site.";
          } else if (pth === "/dmca") {
            titleText = "DMCA Policy";
            subtitle = "Copyright takedown requests for embedded content.";
          } else if (pth === "/2257") {
            titleText = "2257 Statement";
            subtitle = "18 U.S.C. § 2257 Record-Keeping Requirements Compliance.";
          } else if (pth === "/careers") {
            titleText = "Build the future of video";
            subtitle = `We're a small, fully-remote team shipping an 18+ embedded video platform. Applications go to ${contactEmail}. You must be 18+ to apply.`;
          } else if (pth === "/press") {
            titleText = "Press & media";
            subtitle = "Brand assets, story highlights and contact details for this 18+ embedded streaming platform.";
          }
          ssrTitle = `${titleText} | ${brand}`;
          ssrDesc = subtitle.slice(0, 155);
          ssrPageType = "static";
          ssrHeading = titleText;
          ssrStaticTitle = titleText;
          ssrStaticDescription = subtitle;
          ssrJsonLds.push({
            "@context": "https://schema.org",
            "@type": "WebPage",
            name: ssrTitle,
            description: ssrDesc,
            url: ssrCanonical,
          });
          ssrJsonLds.push({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Home", item: `${base}/` },
              { "@type": "ListItem", position: 2, name: titleText, item: ssrCanonical },
            ],
          });
        }
      } catch {}

      // Never let a missing route inherit the homepage canonical or title.
      // The SPA still renders its own NotFound page; these tags only describe
      // the HTTP 404 response for crawlers and link unfurlers.
      if (status === 404) {
        const brand = await ssrGetBrandName();
        ssrTitle = `Page not found | ${brand}`;
        ssrDesc = `The page you requested could not be found. Browse ${brand} for 18+ embedded videos, categories and tags.`;
        ssrCanonical = null;
        ssrOgType = "website";
        ssrRobots = "noindex, follow";
        ssrPrev = null;
        ssrNext = null;
        ssrPageType = "notfound";
        ssrHeading = "Page not found";
        ssrJsonLds.length = 0;
      }

      // Crawler-only body content. This runs after the head metadata has been
      // resolved, so the shell always mirrors the exact same canonical and
      // title. Normal browsers skip every query below.
      let seoShell = "";
      if (isSeoShellRequest(req)) {
        try {
          const page = Math.max(1, Number(ssrPage) || 1);
          const offset = (page - 1) * SSR_PAGE_SIZE;
          let items = [];
          let categories = [];
          if (ssrPageType === "watch" && ssrVideo?.category) {
            items = await ssrGetSeoVideoCards({ category: ssrVideo.category, limit: 8 });
          } else if (ssrPageType === "category") {
            items = await ssrGetSeoVideoCards({ category: ssrCategory, limit: SSR_PAGE_SIZE, offset });
          } else if (ssrPageType === "tag") {
            items = await ssrGetSeoVideoCards({
              tagRaw: ssrTagRaw,
              tagSlug: ssrTagSlug,
              tagDisplay: ssrTagDisplay,
              limit: SSR_PAGE_SIZE,
              offset,
            });
          } else if (["home", "trending", "latest"].includes(ssrPageType)) {
            items = await ssrGetSeoVideoCards({ limit: SSR_PAGE_SIZE, offset });
            categories = await ssrGetSeoCategories(12);
          } else if (ssrPageType === "explore") {
            categories = await ssrGetSeoCategories(24);
          }
          seoShell = renderSeoShell({
            pageType: ssrPageType,
            brand: await ssrGetBrandName(),
            title: ssrTitle || "",
            description: ssrDesc || "",
            canonical: ssrCanonical || "",
            status,
            heading: ssrHeading || ssrTitle || "",
            video: ssrVideo,
            items,
            categories,
            tags: ssrTags,
            staticTitle: ssrStaticTitle,
            staticDescription: ssrStaticDescription,
            page: ssrPage,
            totalPages: ssrTotalPages,
            prev: ssrPrev,
            next: ssrNext,
          });
        } catch (err) {
          console.error("[seo-shell]", err?.message || err);
        }
      }

      const indexFile = path.resolve(STATIC_DIR, "index.html");
      if (fs.existsSync(indexFile)) {
        if (status === 404) res.status(404);
        if (ssrRobots) res.setHeader("X-Robots-Tag", ssrRobots);
        else if (status === 404) res.setHeader("X-Robots-Tag", "noindex, follow");
        if (ssrTitle || ssrDesc || ssrCanonical || ssrJsonLds.length || ssrRobots || ssrPrev || ssrNext) {
          try {
            let html = ssrReadIndexTemplate(indexFile);
            if (status === 404) {
              // Strip every URL-bearing head tag inherited from index.html so
              // the 404 cannot claim the homepage as canonical.
              html = ssrRemoveLinkByRel(html, "canonical");
              html = ssrRemoveHreflangLinks(html);
              html = ssrRemoveLinkByRel(html, "prev");
              html = ssrRemoveLinkByRel(html, "next");
              html = ssrRemoveMeta(html, "property", "og:url");
              html = ssrRemoveJsonLd(html);
            }
            if (ssrTitle) {
              html = html.replace(/<title>.*?<\/title>/i, `<title>${ssrEscape(ssrTitle)}</title>`);
              html = ssrUpsertMeta(html, "property", "og:title", ssrTitle);
              html = ssrUpsertMeta(html, "name", "twitter:title", ssrTitle);
            }
            if (ssrDesc) {
              html = ssrUpsertMeta(html, "name", "description", ssrDesc);
              html = ssrUpsertMeta(html, "property", "og:description", ssrDesc);
              html = ssrUpsertMeta(html, "name", "twitter:description", ssrDesc);
            }
            if (ssrCanonical) {
              html = ssrUpsertLink(html, "canonical", ssrCanonical);
              html = ssrUpsertHreflang(html, "en", ssrCanonical);
              html = ssrUpsertHreflang(html, "x-default", ssrCanonical);
              html = ssrUpsertMeta(html, "property", "og:url", ssrCanonical);
              html = ssrUpsertMeta(html, "property", "og:type", ssrOgType);
              const hasVideoThumb = ssrPageType === "watch" && ssrOgImage;
              const ogImage = hasVideoThumb
                ? ssrAbsoluteUrl(ssrCanonical, ssrOgImage)
                : await ssrGetSeoOgImage(req);
              if (ogImage) {
                html = ssrUpsertMeta(html, "property", "og:image", ogImage);
                html = ssrUpsertMeta(html, "property", "og:image:width", hasVideoThumb ? "640" : "1200");
                html = ssrUpsertMeta(html, "property", "og:image:height", hasVideoThumb ? "360" : "630");
                html = ssrUpsertMeta(html, "property", "og:image:type", "image/jpeg");
                html = ssrUpsertMeta(html, "name", "twitter:image", ogImage);
              }
              html = ssrUpsertMeta(html, "name", "twitter:card", "summary_large_image");
            }
            if (ssrRobots) {
              html = ssrUpsertMeta(html, "name", "robots", ssrRobots);
            } else if (status === 404) {
              // ensure 404 page is not indexed
              html = ssrUpsertMeta(html, "name", "robots", "noindex, follow");
            }
            if (ssrPrev) html = ssrUpsertLink(html, "prev", ssrPrev);
            if (ssrNext) html = ssrUpsertLink(html, "next", ssrNext);
            for (let i = 0; i < ssrJsonLds.length; i++) {
              const json = JSON.stringify(ssrJsonLds[i]).replace(/</g, "\\u003c");
              const tag = `<script type="application/ld+json">${json}</script>`;
              html = html.replace("</head>", `  ${tag}\n</head>`);
            }
            if (seoShell) html = injectSeoShell(html, seoShell);
            // Crawler and browser HTML differ only by the body shell.
            res.vary("User-Agent");
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            return res.send(html);
          } catch {}
        }
        res.vary("User-Agent");
        return res.sendFile(indexFile);
      }
      next();
    }),
  );
}

app.use((err, req, res, _next) => {
  console.error("[unhandled]", req.method, req.url, err);
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error" });
});

const HOST = process.env.HOST || "127.0.0.1";
const server = app.listen(PORT, HOST, () => {
  console.log(`[server] Listening on http://${HOST}:${PORT}`);
  console.log(`[server] Pool stats:`, poolStats());
});

// ---------------- Graceful shutdown ----------------
async function shutdown(signal) {
  console.log(`[server] ${signal} received — flushing buffers…`);
  server.close();
  await flushAll();
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("uncaughtException", (e) => console.error("[uncaughtException]", e));
process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));
