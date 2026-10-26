// HDPORNFORYOU Automation Engine
// Fixed-interval video ingestion: Eporner fetch -> OpenRouter AI SEO -> DB store
// NO time windows, NO fallback mode, PAUSED at 50 AI requests/day

import crypto from "node:crypto";
import { q, one, many, tx, pool } from "./db.js";
import { invalidate } from "./cache.js";
import { AUTOMATION_LOG_KEEP } from "./retention.js";

const EPORNER_API = "https://www.eporner.com/api/v2";
const OPENROUTER_API = "https://openrouter.ai/api/v1";
const AI_LIMIT_DAILY_DEFAULT = 50; // fallback if not set in DB
const WORKER_ID = `${process.pid}-${crypto.randomUUID()}`;
const AUTOMATION_RUN_LOCK_KEY = 44004401;
// Fail-safe for thumbnail scans: a scan in any process holds this lock so a
// duplicate trigger (e.g. two processes scanning at once) can never run in
// parallel with itself.
const THUMBNAIL_SCAN_LOCK_KEY = 44004402;
// How often the dedicated automation worker polls automation_commands.
const COMMAND_POLL_MS = 1000;
const COMMANDS_PER_TICK = 10;
// How often the engine watchdog re-checks settings for self-heal / thumbnail
// timer re-arming (single-row SELECTs — cheap at 5s cadence).
const WATCHDOG_MS = 5000;
// When a cycle overruns its interval, re-check for completion this often
// instead of re-publishing WAITING while the cycle is still executing.
const CYCLE_RECHECK_MS = 10 * 1000;

// True when a SEPARATE dedicated automation process exists (PM2 automation
// app / docker-compose automation service). API workers then only relay admin
// actions through automation_commands instead of running engine timers here.
const AUTOMATION_WORKER_MODE = process.env.RUN_AUTOMATION === "0";

// ---- In-memory state (per-process) ----
let engineTimer = null;
let resumeTimer = null;
let dailyResetTimer = null;
let isRunning = false;
let isPaused = false;
let stopRequested = false;
let currentBatch = 0;
let nextCycleAt = null;
let aiCounter = 0;
let aiCounterDate = "";
let scheduleSeq = 0;
// Monotonic token identifying the current "automation run generation".
// Every Start click bumps this — any pending scheduled callback whose
// captured token no longer matches must exit without running/rescheduling
// so we can never end up with two parallel timer loops.
let cycleToken = 0;
// Set by startAutomation() when the admin clicks Start WHILE a cycle is
// mid-flight. On completion of that cycle, we immediately run a fresh
// cycle instead of waiting the full interval — matching the "every Start
// = fresh countdown from the interval value" contract.
let restartRequested = false;
// Dedicated-worker plumbing: command relay consumer + settings watchdog.
let commandConsumerTimer = null;
let watchdogTimer = null;
let lastThumbnailAutoClean = null;

// ---- Default settings ---- (synced from current admin DB 2026-08-28, ad zones kept empty)
const DEFAULTS = {
  enabled: false,
  intervalMinutes: 10,
  dailyImportLimit: 50000,
  aiBatchSize: 5,
  aiEnabled: true,
  aiModel: "deepseek/deepseek-chat",
  aiPrompt: `You are an expert adult SEO copywriter for an embed tube. GOAL: SEO SCORE 95+ for Google + internal search. Write UNIQUE, human, SERP-optimized metadata that ranks for long-tail [performer + act + category] and maximizes CTR. Avoid duplication across batch.

STEP 0 - RAW EVALUATION (silent before writing): Analyze source_url + title + channel: performer count (1/2/3/4+ names), ethnicity (asian/latina/ebony/blonde/brunette/redhead/japanese/indian/bhabhi/korean/chinese/hijab), body (bbw/big tits/big ass/small tits/skinny), acts (hardcore/blowjob/anal/bbc/bigdick/cumshot/deepthroat/hentai/transgender/massage/fetish/public/casting/threesome/gangbang/solo/pov/feet/handjob/squirt/pissing/fisting/rimjob/69/fingering/cowgirl/car/uniform/doggystyle), setting (public/casting/massage/college/office/mature/solo/hentai/stepfamily/car/uniform), family (stepmom/father/sister/brother/grandfather/grandmother/cougar/housewife/teacher/nurse). Decide category/keywords from this, don't hallucinate.

EXAMPLES - COPY THIS STRUCTURE (COUNT chars):
title 60 chars: "Eliza Ibarra Intense BBC Scene - Unforgettable Interracial Hardcore"
desc 470 chars: "Mia Khalifa and Abella Danger team up for an absolutely unforgettable POV hardcore scene that will leave you breathless. Watch as these two legendary stars take turns showing off their massive natural big tits and tight round ass, delivering intense deep-throat action, rough pounding, and a spectacular explosive finish. Every angle is captured in stunning high definition, putting you right in the middle of the action. A steamy, cinematic production with incredible chemistry from start to finish that no fan should miss."
Sample JSON (60 + 470 + 7 tags, copy format):
[{"video_id":"SJOz6bwFXLW","title":"Eliza Ibarra Intense BBC Scene - Unforgettable Interracial Hardcore","description":"Mia Khalifa and Abella Danger team up for an absolutely unforgettable POV hardcore scene that will leave you breathless. Watch as these two legendary stars take turns showing off their massive natural big tits and tight round ass, delivering intense deep-throat action, rough pounding, and a spectacular explosive finish. Every angle is captured in stunning high definition, putting you right in the middle of the action. A steamy, cinematic production with incredible chemistry from start to finish that no fan should miss.","tags":["eliza ibarra","bbc sex","interracial","pov hardcore","petite brunette","passionate","hd porn"],"category":"interracial"}]

SEO CHECKLIST - aim for these, count before output:
- Title 55-70 (ideal 60, keyword first 60, 1 power word, unique)
- Desc 420-520 (3-4 sentences 100-140 each, keyword+LSI first 150, ends "Watch now in HD", ~470 like example)
- Tags exactly 7 (lowercase, 1-2 words, spaces allowed, mix 2 performer/3 act/2 long-tail, no dup)
- Category from STEP 0, never default solo

RULES per video:
1. title (MUST 55-70 COUNT, REJECT 20/29/33/38/44): Format [Performer 1 + Performer 2] + [Primary Act/Category] + [Hook]. PRIMARY KEYWORD first 60. FAIL "Big Ass Pounding with Passion" 29 REJECTED -> add performer+hook to 60.
2. description (MUST 420-520 COUNT, REJECT 237/261/300/373): 3-4 sentences 100-140. Sentence1 keyword+LSI first 150. Density 1-1.5%. CTA. Don't copy title. COUNT - if 300 FAIL add sentences to 450.
3. tags (MUST exactly 7 COUNT, REJECT 5): lowercase, 1-2 words, spaces allowed (e.g. mia khalifa, big tits, pov hardcore). Mix 2/3/2. REJECT single-word-only.
4. category (CRITICAL): MUST be one slug from list. Use STEP 0 priority: 3 names/threesome→threesome NEVER solo; solo/masturbation single→solo; 2+lesbian→lesbian; gangbang/orgy 4+→gangbang/orgy; stepmom/father/sister/brother/family/grandfather/grandmother→stepmom/father/sister/brother/family/grandfather/grandmother; cougar/housewife/teacher/nurse→cougar/housewife/teacher/nurse; bhabhi/indian→bhabhi/indian; korean/chinese→korean/chinese; hijab→hijab; fingering→fingering; cowgirl→cowgirl; doggystyle→doggystyle; uniform→uniform; car→car; handjob→handjob; squirt→squirt; pissing→pissing; fisting→fisting; rimjob→rimjob; smalltits→smalltits; skinny→skinny; 69→69; casting→casting; massage→massage; public→public; fetish→fetish; bbw→bbw; bbc→bbc; bigdick→bigdick; deepthroat→deepthroat; cumshot→cumshot; brunette→brunette; redhead→redhead; japanese→japanese; hentai→hentai; transgender→transgender; asian/latina/ebony/blonde dominant→asian/latina/ebony/blonde; college→college; office→office; feet→feet; mature→mature; hardcore→hardcore. Verify solo ONLY 1 alone.

Output ONLY raw JSON array, no markdown, no explanation:
[{"video_id":"","title":"","description":"","tags":["","","","","","",""],"category":""}]`,
  adminPrefix: "admin",
  thumbnailAutoClean: true,
  aiDailyLimit: 50,
};

// Seed category slugs — mirrors src/data/videos.ts, used as fallback when DB has none
const SEED_CATEGORY_SLUGS = [
  "69",
  "amateur",
  "anal",
  "asian",
  "bbc",
  "bbw",
  "bdsm",
  "bhabhi",
  "bigass",
  "bigdick",
  "bigtits",
  "blonde",
  "blowjob",
  "brunette",
  "car",
  "casting",
  "chinese",
  "college",
  "cougar",
  "cowgirl",
  "creampie",
  "cumshot",
  "deepthroat",
  "doggystyle",
  "ebony",
  "feet",
  "fetish",
  "fingering",
  "fisting",
  "gangbang",
  "grandfather",
  "grandmother",
  "handjob",
  "hardcore",
  "hentai",
  "hijab",
  "housewife",
  "indian",
  "interracial",
  "japanese",
  "korean",
  "latina",
  "lesbian",
  "massage",
  "mature",
  "milf",
  "nurse",
  "office",
  "orgy",
  "pissing",
  "pov",
  "public",
  "redhead",
  "rimjob",
  "skinny",
  "smalltits",
  "solo",
  "squirt",
  "stepbrother",
  "stepfamily",
  "stepfather",
  "stepmom",
  "stepsister",
  "teacher",
  "teen",
  "threesome",
  "transgender",
  "uniform",
];

async function fetchCategorySlugs() {
  const cats = await one("SELECT value FROM settings WHERE key = 'categories'");
  const list = cats
    ? typeof cats.value === "string"
      ? JSON.parse(cats.value)
      : cats.value
    : [];
  const slugs = Array.isArray(list)
    ? list.map((c) => c.slug || c).filter((s) => s && s !== "all")
    : [];
  return slugs.length ? slugs : SEED_CATEGORY_SLUGS;
}
async function logEntry(type, message, details = null) {
  try {
    await q(
      `INSERT INTO import_logs (type, message, details) VALUES ($1, $2, $3::jsonb)`,
      [type, message, details ? JSON.stringify(details) : null],
    );
    await q(
      `DELETE FROM import_logs
        WHERE id NOT IN (
          SELECT id FROM import_logs ORDER BY created_at DESC, id DESC LIMIT $1
        )`,
      [AUTOMATION_LOG_KEEP],
    );
  } catch (e) {
    console.error("[automation] log error:", e.message);
  }
}
// ---- Settings read/write ----
async function getSettings() {
  const row = await one("SELECT value FROM settings WHERE key = 'auto_import'");
  if (!row) return { ...DEFAULTS };
  const v = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
  return { ...DEFAULTS, ...v };
}

async function saveSettings(settings) {
  // Read current settings first, then merge only the incoming fields
  const existing = await getSettings();
  const merged = { ...existing, ...settings };
  await q(
    `INSERT INTO settings (key, value) VALUES ('auto_import', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify(merged)],
  );
}

async function getRuntimeState() {
  const row = await one(
    "SELECT value FROM settings WHERE key = 'automation_runtime'",
  );
  if (!row) return {};
  return typeof row.value === "string"
    ? JSON.parse(row.value)
    : row.value || {};
}

async function saveRuntimeState(patch) {
  const existing = await getRuntimeState();
  const merged = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  await q(
    `INSERT INTO settings (key, value) VALUES ('automation_runtime', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify(merged)],
  );
}

// Videos were changed by this process — bump the shared DB epoch so every API
// worker drops its per-process "videos:all" cache copy. The L1 cache lives in
// memory, so invalidate() only affects the calling process; in worker mode the
// imports happen in the dedicated automation process while API workers serve
// the catalog, and without this signal they keep serving stale lists until
// their own TTL expires.
async function bumpVideosEpoch() {
  await q(
    `INSERT INTO settings (key, value) VALUES ('cache_epoch', jsonb_build_object('videos', extract(epoch from now())::bigint))
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
  ).catch(() => {});
}

async function withAdvisoryLock(lockKey, fn) {
  const client = await pool.connect();
  let locked = false;
  try {
    const lockResult = await client.query(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [lockKey],
    );
    locked = !!lockResult.rows[0]?.locked;
    if (!locked) return { acquired: false };
    return { acquired: true, result: await fn() };
  } finally {
    if (locked) {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [lockKey]);
      } catch {
        /* ignore */
      }
    }
    client.release();
  }
}

async function withRunLock(fn) {
  return withAdvisoryLock(AUTOMATION_RUN_LOCK_KEY, fn);
}

async function runCycleWithLock(force = false) {
  const locked = await withRunLock(async () => runCycle(force));
  if (!locked.acquired) {
    await logEntry(
      "info",
      "Automation cycle skipped: another worker is already running",
    );
    return false;
  }
  return true;
}

// ---- AI counter (persisted in settings with date) ----
async function loadAiCounter() {
  const row = await one("SELECT value FROM settings WHERE key = 'ai_counter'");
  if (!row) {
    aiCounter = 0;
    aiCounterDate = todayStr();
    return;
  }
  const v = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
  const storedDate = v.date || "";
  if (storedDate === todayStr()) {
    aiCounter = v.count || 0;
    aiCounterDate = storedDate;
  } else {
    aiCounter = 0;
    aiCounterDate = todayStr();
    await saveAiCounter();
  }
}

async function saveAiCounter() {
  await q(
    `INSERT INTO settings (key, value) VALUES ('ai_counter', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify({ count: aiCounter, date: aiCounterDate })],
  );
}

async function reserveAiRequestSlot(dailyLimit = null) {
  const limit =
    dailyLimit == null
      ? null
      : Math.max(1, Math.trunc(Number(dailyLimit) || 0));
  const row = await one(
    `INSERT INTO settings (key, value)
     VALUES ('ai_counter', jsonb_build_object('count', 1, 'date', $1::text))
     ON CONFLICT (key) DO UPDATE SET
       value = CASE
         WHEN settings.value->>'date' = $1::text THEN jsonb_build_object('count', COALESCE((settings.value->>'count')::int, 0) + 1, 'date', $1::text)
         ELSE jsonb_build_object('count', 1, 'date', $1::text)
       END,
       updated_at = NOW()
     WHERE $2::int IS NULL
        OR settings.value->>'date' <> $1::text
        OR COALESCE((settings.value->>'count')::int, 0) < $2::int
     RETURNING value`,
    [todayStr(), limit],
  );
  if (!row) return false;
  const value =
    typeof row.value === "string" ? JSON.parse(row.value) : row.value;
  aiCounter = value.count || 0;
  aiCounterDate = value.date || todayStr();
  return true;
}

async function releaseAiRequestSlot() {
  const row = await one(
    `UPDATE settings SET
       value = jsonb_build_object('count', GREATEST(COALESCE((value->>'count')::int, 0) - 1, 0), 'date', $1::text),
       updated_at = NOW()
     WHERE key = 'ai_counter' AND value->>'date' = $1::text
     RETURNING value`,
    [todayStr()],
  );
  if (!row) return;
  const value =
    typeof row.value === "string" ? JSON.parse(row.value) : row.value;
  aiCounter = value.count || 0;
  aiCounterDate = value.date || todayStr();
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function utcDayBounds(date = new Date()) {
  const start = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const end = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1),
  );
  return { start: start.toISOString(), end: end.toISOString() };
}

async function countVideosImportedToday() {
  const { start, end } = utcDayBounds();
  return one(
    `SELECT COUNT(*)::int AS n FROM videos WHERE updated_at >= $1::timestamptz AND updated_at < $2::timestamptz`,
    [start, end],
  );
}

async function resetDailyCountersIfNeeded() {
  if (aiCounterDate !== todayStr()) {
    aiCounter = 0;
    aiCounterDate = todayStr();
    await saveAiCounter();
  }
}

// ---- OpenRouter API Keys ----
async function getApiKeys() {
  const row = await one(
    "SELECT value FROM settings WHERE key = 'openrouter_keys'",
  );
  if (!row) return [];
  const v = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
  return Array.isArray(v) ? v : [];
}

async function saveApiKeys(keys) {
  await q(
    `INSERT INTO settings (key, value) VALUES ('openrouter_keys', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify(keys)],
  );
}

async function getOrderedOpenRouterKeys() {
  const apiKeys = await getApiKeys();
  const envKey = process.env.OPENROUTER_API_KEY || null;
  const allKeys = [];
  if (envKey) allKeys.push({ key: envKey, priority: 0, label: "env" });
  for (const k of apiKeys) {
    if (k.key && k.key !== envKey) {
      allKeys.push({
        key: k.key,
        priority: k.priority || 99,
        label: k.label || k.id || "stored",
      });
    }
  }
  allKeys.sort((a, b) => a.priority - b.priority);
  return allKeys;
}

// ---- OpenRouter API call with key fallback ----
async function callOpenRouter(
  videoBatch,
  model,
  prompt,
  categories = [],
  options = {},
) {
  const allKeys = await getOrderedOpenRouterKeys();

  if (!allKeys.length) throw new Error("No OpenRouter API keys configured");

  await resetDailyCountersIfNeeded();
  const reserved = await reserveAiRequestSlot(options.aiDailyLimit ?? null);
  if (!reserved) throw new Error("AI daily limit reached");

  const catList = categories.length
    ? categories
        .map((c) => c.slug || c)
        .filter((c) => c !== "all")
        .join(", ")
    : "general";
  const fullPrompt = `${prompt}

Available categories (use EXACTLY one of these slugs for "category"): ${catList}
The category MUST be one of the slugs above — no other value is valid.`;

  const messages = [
    { role: "system", content: fullPrompt },
    {
      role: "user",
      content:
        `Available category slugs (pick EXACTLY one per video): ${catList}\n\n` +
        JSON.stringify(
          videoBatch.map((v) => ({
            video_id: v.epornerId || v.id,
            title: v.title,
            source_url: v.sourceUrl,
            channel: v.channel,
            duration: v.duration,
          })),
        ),
    },
  ];

  // Scale max_tokens to batch size (~400 tokens/video for the longer SEO
  // metadata) but cap conservatively: low-credit OpenRouter accounts reject
  // oversized max_tokens with 402 ("fewer max_tokens"), so never ask for more
  // than ~2000 output tokens per request. Callers should split large batches
  // into chunks (see enrichInChunks) so output stays within this cap.
  const maxTokens = Math.max(
    800,
    Math.min(2000, videoBatch.length * 400 + 300),
  );

  let lastError = null;
  for (let i = 0; i < allKeys.length; i++) {
    const ak = allKeys[i];
    try {
      const res = await fetch(`${OPENROUTER_API}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ak.key}`,
          "HTTP-Referer": process.env.SITE_URL || "http://localhost:3001",
          "X-Title": "HDPORNFORYOU",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.7,
          max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(90000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        lastError = new Error(
          `OpenRouter ${res.status} (key …${ak.key.slice(-6)}): ${text.slice(0, 120)}`,
        );
        if (i < allKeys.length - 1) {
          await logEntry(
            "failure",
            `${lastError.message}; trying next API key`,
          );
          continue;
        }
        throw lastError;
      }

      const data = await res.json();
      const choice = data.choices?.[0];
      const content = choice?.message?.content || "";

      if (choice?.finish_reason === "length" && videoBatch.length > 1) {
        console.warn(
          `[OpenRouter] Response truncated (finish_reason=length, got ${content.length} chars) for batch of ${videoBatch.length}`,
        );
        await logEntry(
          "info",
          `AI response truncated for batch of ${videoBatch.length} (finish_reason=length) — will retry missing`,
        );
      }

      return content;
    } catch (e) {
      lastError = e;
      if (e.name === "AbortError" || e.name === "TimeoutError") {
        lastError = new Error(`OpenRouter timeout (key …${ak.key.slice(-6)})`);
      }
      if (i < allKeys.length - 1) {
        await logEntry("failure", `${lastError.message}; trying next API key`);
        continue;
      }
    }
  }

  await releaseAiRequestSlot();
  throw lastError || new Error("All API keys exhausted");
}

// Run AI enrichment for a batch of videos in small chunks so each request
// stays within the capped max_tokens (and a low OpenRouter credit balance).
// Returns the merged parsed results; per-chunk failures are logged and skipped.
async function enrichInChunks(
  videos,
  model,
  prompt,
  categories = [],
  options = {},
  chunkSize = 4,
) {
  const results = [];
  for (let i = 0; i < videos.length; i += chunkSize) {
    const chunk = videos.slice(i, i + chunkSize);
    try {
      const content = await callOpenRouter(
        chunk,
        model,
        prompt,
        categories,
        options,
      );
      if (content) results.push(...parseAiResponse(content));
    } catch (e) {
      await logEntry(
        "failure",
        `AI chunk ${Math.floor(i / chunkSize) + 1} error: ${e.message}`,
      );
    }
  }
  return results;
}

// ---- Fetch available models from OpenRouter ----
export async function fetchOpenRouterModels() {
  const allKeys = await getOrderedOpenRouterKeys();
  if (!allKeys.length) return [];

  for (const ak of allKeys) {
    try {
      const res = await fetch(`${OPENROUTER_API}/models`, {
        headers: { Authorization: `Bearer ${ak.key}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      return (data.data || []).map((m) => m.id).sort();
    } catch {
      continue;
    }
  }
  return [];
}

// ---- Parse AI JSON response ----
function parseAiResponse(content) {
  let json = content.trim();
  const m = json.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (m) json = m[1].trim();
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error("AI response is not an array");
  return parsed;
}

// ---- Keyword management ----
async function getKeywords() {
  return many(
    "SELECT id, keyword, priority, created_at FROM import_keywords ORDER BY CASE priority WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC, created_at DESC",
  );
}

async function addKeyword(keyword, priority = "medium") {
  const k = String(keyword || "")
    .trim()
    .toLowerCase();
  if (!k) throw new Error("Keyword required");
  if (!["high", "medium", "low"].includes(priority)) priority = "medium";
  const existing = await one(
    "SELECT id FROM import_keywords WHERE keyword = $1",
    [k],
  );
  if (existing) throw new Error("Keyword already exists");
  const row = await one(
    `INSERT INTO import_keywords (keyword, priority) VALUES ($1, $2) RETURNING *`,
    [k, priority],
  );
  await logEntry("info", `Keyword added: "${k}" (${priority})`);
  return row;
}

async function deleteKeyword(id) {
  const row = await one(
    "DELETE FROM import_keywords WHERE id = $1 RETURNING keyword",
    [id],
  );
  if (row) await logEntry("info", `Keyword removed: "${row.keyword}"`);
  return !!row;
}

async function updateKeyword(id, fields) {
  const sets = [];
  const vals = [];
  if (fields.keyword != null) {
    sets.push(`keyword = $${sets.length + 1}`);
    vals.push(String(fields.keyword).trim().toLowerCase());
  }
  if (fields.priority != null) {
    sets.push(`priority = $${sets.length + 1}`);
    vals.push(fields.priority);
  }
  if (!sets.length) return null;
  vals.push(id);
  const row = await one(
    `UPDATE import_keywords SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`,
    vals,
  );
  return row;
}

// ---- Eporner API fetch ----
// Retry fetch up to 3 times on network errors with increasing timeouts
async function fetchWithRetry(url, opts, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        ...opts,
        signal: AbortSignal.timeout(20000 + i * 10000),
      });
      return res;
    } catch (e) {
      lastErr = e;
      // All errors (including timeout) retry up to attempts — each has its own timeout.
    }
  }
  throw lastErr;
}

async function fetchEpornerVideos(keyword, page = 1, perPage = 50) {
  const url = `${EPORNER_API}/video/search/?query=${encodeURIComponent(keyword)}&per_page=${perPage}&page=${page}&thumbsize=big&order=latest&gay=0&lq=0&format=json`;
  const res = await fetchWithRetry(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; HDPORNFORYOU/2.0)" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Eporner API error: ${res.status}`);
  return res.json();
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---- Core cycle: scan pages -> filter dupes -> check thumbnails -> AI -> store ----
async function runCycle(force = false) {
  // Flip isRunning SYNCHRONOUSLY before any await so getStatus() (and the
  // self-heal scheduler inside it) sees RUNNING immediately after Start —
  // this is what makes the admin System Status card show RUNNING instantly
  // and prevents a premature countdown from being shown while the first
  // cycle is still importing. The outer try/finally guarantees the flag is
  // always cleared even if the cycle early-returns.
  isRunning = true;
  await saveRuntimeState({
    status: "RUNNING",
    nextCycleAt: null,
    isRunning: true,
    isPaused: false,
  });
  const cycleSummary = { imported: 0, skipped: 0, failed: 0 };
  try {
    const settings = await getSettings();
    if ((!settings.enabled && !force) || stopRequested) return;
    if (isPaused) return;

    await loadAiCounter();
    await resetDailyCountersIfNeeded();
    if (aiCounter >= (settings.aiDailyLimit || AI_LIMIT_DAILY_DEFAULT)) {
      await scheduleNextDayResume(
        `AI daily limit reached (${aiCounter}/${settings.aiDailyLimit || AI_LIMIT_DAILY_DEFAULT})`,
      );
      return;
    }

    const batchSize = Math.min(settings.aiBatchSize || 20, 50);
    const dailyLimit = settings.dailyImportLimit || 50000;

    try {
      const importedToday = await countVideosImportedToday();
      const remaining = dailyLimit - (importedToday?.n || 0);
      if (remaining <= 0) {
        await scheduleNextDayResume(
          `Daily import limit reached (${dailyLimit})`,
        );
        return;
      }

      const keywords = await getKeywords();
      if (!keywords.length) {
        await logEntry("skipped", "No keywords configured");
        return;
      }

      const catSlugs = await fetchCategorySlugs();
      // Pass as objects so callOpenRouter can build catList
      const categories = catSlugs.map((s) => ({ slug: s }));

      const needCount = Math.min(remaining, batchSize);
      const collected = []; // unique, non-duplicate, live-thumbnail videos
      const collectedIds = new Set();

      for (const kw of keywords) {
        if (collected.length >= needCount) break;
        if (stopRequested) break;

        let page = 1;
        const MAX_PAGES = 20; // scan up to 20 pages per keyword to find unimported videos

        while (collected.length < needCount && page <= MAX_PAGES) {
          if (stopRequested) break;
          let pageData;
          try {
            pageData = await fetchEpornerVideos(kw.keyword, page);
          } catch (e) {
            await logEntry(
              "failure",
              `Eporner fetch failed for "${kw.keyword}" page ${page}: ${e.message}`,
            );
            break;
          }

          if (!pageData.videos?.length) break;

          const totalPages = pageData.total_pages || 1;

          // Build candidate list for this page
          const candidates = pageData.videos.map((v) => {
            // Convert Eporner length_min (MM:SS or M:SS) to HH:MM:SS
            const rawDur = v.length_min || "0:00";
            const parts = rawDur.split(":").map(Number);
            let dur;
            if (parts.length === 3) {
              dur = `${String(parts[0]).padStart(2, "0")}:${String(parts[1]).padStart(2, "0")}:${String(parts[2]).padStart(2, "0")}`;
            } else {
              const m = parts[0] || 0,
                s = parts[1] || 0;
              const h = Math.floor(m / 60),
                rm = m % 60;
              dur = `${String(h).padStart(2, "0")}:${String(rm).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
            }
            return {
              id: v.id,
              epornerId: v.id,
              title: v.title,
              embedUrl: v.embed,
              sourceUrl: `https://www.eporner.com/video-${v.id}/${slugify(v.title) || "video"}`,
              thumbnail: v.default_thumb?.src || "",
              duration: dur,
              views: Number(v.views) || 0,
              rating: v.rate || "0",
              keyword: kw.keyword,
              keywordPriority: kw.priority,
              tags: [],
              category:
                catSlugs[Math.floor(Math.random() * catSlugs.length)] ||
                "general",
              channel: "EPORNER",
            };
          });

          // Filter already-in-DB
          const candidateIds = candidates.map((v) => v.id);
          const existingRows = await many(
            "SELECT id FROM videos WHERE id = ANY($1::text[])",
            [candidateIds],
          );
          const existingSet = new Set(existingRows.map((r) => r.id));
          const newCandidates = candidates.filter(
            (v) => !existingSet.has(v.id),
          );
          cycleSummary.skipped += existingRows.length;

          if (!newCandidates.length) {
            // All on this page already imported — move to next page
            await logEntry(
              "info",
              `Page ${page} of "${kw.keyword}": all ${candidates.length} already imported, scanning next page`,
            );
            page++;
            if (page > totalPages) break;
            continue;
          }

          // Check thumbnails for new candidates
          for (const v of newCandidates) {
            if (collected.length >= needCount) break;
            if (!v.thumbnail) continue;
            if (collectedIds.has(v.id)) continue;
            collectedIds.add(v.id);
            collected.push(v);
          }

          page++;
          if (page > totalPages) break;
        }
      }

      if (!collected.length) {
        await logEntry(
          "skipped",
          "No new videos with valid thumbnails found after scanning all pages",
        );
        return;
      }

      // Sort by keyword priority then views
      const priorityRank = { high: 3, medium: 2, low: 1 };
      collected.sort((a, b) => {
        const pa = priorityRank[a.keywordPriority] || 1;
        const pb = priorityRank[b.keywordPriority] || 1;
        if (pa !== pb) return pb - pa;
        return b.views - a.views;
      });

      const selected = collected.slice(0, needCount);

      const batches = [];
      for (let i = 0; i < selected.length; i += batchSize) {
        batches.push(selected.slice(i, i + batchSize));
      }

      let imported = 0;

      for (let bi = 0; bi < batches.length; bi++) {
        if (stopRequested) break;
        if (aiCounter >= (settings.aiDailyLimit || AI_LIMIT_DAILY_DEFAULT)) {
          await scheduleNextDayResume(
            `AI daily limit reached mid-batch (${aiCounter}/${settings.aiDailyLimit || AI_LIMIT_DAILY_DEFAULT})`,
          );
          break;
        }

        const batch = batches[bi];
        currentBatch = bi + 1;
        // Persist so any API worker's /api/import/status shows the batch
        // progress (currentBatch is per-process memory otherwise, and in
        // worker mode the cycle runs in the dedicated automation process).
        await saveRuntimeState({ currentBatch }).catch(() => {});

        try {
          let seoResults = [];

          if (settings.aiEnabled) {
            const aiOptions = {
              aiDailyLimit: settings.aiDailyLimit || AI_LIMIT_DAILY_DEFAULT,
            };

            // First attempt — split the batch into small chunks so each request
            // fits the capped max_tokens (works even on a low OpenRouter balance).
            seoResults = await enrichInChunks(
              batch,
              settings.aiModel,
              settings.aiPrompt,
              categories,
              aiOptions,
            );

            // Retry for missing videos (up to 2 retries)
            for (let retry = 0; retry < 2; retry++) {
              if (
                aiCounter >= (settings.aiDailyLimit || AI_LIMIT_DAILY_DEFAULT)
              ) {
                await logEntry(
                  "info",
                  "AI daily limit reached during retry — stopping retries",
                );
                break;
              }
              const matchedIds = new Set(
                seoResults
                  .filter((r) => r.video_id)
                  .map((r) => String(r.video_id)),
              );
              const missing = batch.filter(
                (v) => !matchedIds.has(String(v.epornerId)),
              );
              if (!missing.length) break;

              await logEntry(
                "info",
                `Retry ${retry + 1}: ${missing.length} videos missing AI metadata, re-requesting`,
              );
              const retryResults = await enrichInChunks(
                missing,
                settings.aiModel,
                settings.aiPrompt,
                categories,
                aiOptions,
              );
              seoResults = seoResults.concat(retryResults);
            }
          }

          const seoMap = new Map();
          for (const r of seoResults) {
            if (r.video_id) seoMap.set(String(r.video_id), r);
          }

          const matchedCount = batch.filter((v) =>
            seoMap.has(String(v.epornerId)),
          ).length;
          if (seoResults.length && matchedCount < batch.length) {
            const missingIds = batch
              .filter((v) => !seoMap.has(String(v.epornerId)))
              .map((v) => v.epornerId);
            await logEntry(
              "info",
              `Final: AI matched ${matchedCount}/${batch.length}. Still missing: ${missingIds.join(", ")}`,
            );
          }

          const toInsert = [];
          for (const v of batch) {
            const seo = seoMap.get(String(v.epornerId));

            // Skip videos with no AI metadata when AI is enabled
            if (settings.aiEnabled && !seo) {
              await logEntry(
                "skipped",
                `Skipped ${v.id} (epornerId=${v.epornerId}): no AI metadata after retries`,
              );
              continue;
            }
            // Defined max lengths: 120 chars title, 600 chars description.
            // The prompt targets 90-120 / 350-600; this hard cap guarantees
            // clean data even if the model overshoots.
            const seoTitle = (seo?.title || v.title || "").trim().slice(0, 120);
            const seoDesc = (seo?.description || "").trim().slice(0, 600);
            const seoTags = (
              seo?.tags?.length ? seo.tags : generateTags(v.title, 7)
            )
              .map(normalizeAiTag)
              .filter(Boolean);

            // Use AI-suggested category if valid; fallback to random
            const aiCat = seo?.category || "";
            const category = catSlugs.includes(aiCat)
              ? aiCat
              : v.category && catSlugs.includes(v.category)
                ? v.category
                : catSlugs[Math.floor(Math.random() * catSlugs.length)] ||
                  "general";

            // Use title as slug
            const slug = slugify(seoTitle || v.title);

            // Random views 10M–50M, likes = 30% of views
            const randomViews = Math.floor(
              Math.random() * (50000000 - 10000000 + 1) + 10000000,
            );
            const randomLikes = Math.floor(randomViews * 0.3);

            // Random uploadedAt between 2020-01-01 and today
            const start = new Date("2020-01-01").getTime();
            const end = Date.now();
            const uploadedAt = new Date(start + Math.random() * (end - start))
              .toISOString()
              .slice(0, 10);

            // featured/trending: use algorithmic logic (top 15% by views for featured, top 10% by trending score)
            // We don't set these manually — the withAlgorithmicFlags function handles it at read time.
            // Just store false so the algorithm can do its job.
            const data = {
              title: seoTitle,
              description: seoDesc,
              embedUrl: v.embedUrl,
              sourceUrl: v.sourceUrl,
              thumbnail: v.thumbnail,
              duration: v.duration,
              category,
              tags: seoTags,
              channel: v.channel || "EPORNER",
              hd: true,
              featured: false,
              trending: false,
              uploadedAt,
            };

            toInsert.push([
              v.id,
              slug,
              JSON.stringify(data),
              randomViews,
              randomLikes,
            ]);
          }

          if (toInsert.length) {
            const ids = toInsert.map((r) => r[0]);
            const slugs = toInsert.map((r) => r[1]);
            const datas = toInsert.map((r) => r[2]);
            const viewsArr = toInsert.map((r) => r[3]);
            const likesArr = toInsert.map((r) => r[4]);

            await tx(async (c) => {
              await c.query(
                `INSERT INTO videos (id, slug, data, views, likes_base, views_boost, likes_boost)
               SELECT * FROM UNNEST($1::text[], $2::text[], $3::jsonb[], $4::bigint[], $5::bigint[], $6::bigint[], $7::bigint[])
               ON CONFLICT (id) DO UPDATE SET
                 slug = EXCLUDED.slug,
                 data = EXCLUDED.data,
                 updated_at = NOW()`,
                [
                  ids,
                  slugs,
                  datas,
                  viewsArr,
                  likesArr,
                  new Array(ids.length).fill(0),
                  new Array(ids.length).fill(0),
                ],
              );
            });

            imported += toInsert.length;
            await logEntry(
              "success",
              `Imported ${toInsert.length} videos (batch ${bi + 1}/${batches.length})`,
            );
          }
        } catch (e) {
          cycleSummary.failed += 1;
          await logEntry("failure", `Batch ${bi + 1} error: ${e.message}`);
        }
      }

      cycleSummary.imported = imported;
      await logEntry("info", `Cycle complete: ${imported} videos imported`);
      if (imported > 0) {
        invalidate("videos:all");
        await bumpVideosEpoch();
      }
    } catch (e) {
      await logEntry("failure", `Cycle error: ${e.message}`);
      console.error("[automation] cycle error:", e);
    } finally {
      currentBatch = 0;
      await saveRuntimeState({
        currentBatch: 0,
        lastImport: {
          imported: cycleSummary.imported,
          skipped: cycleSummary.skipped,
          failed: cycleSummary.failed,
          at: new Date().toISOString(),
          manual: !!force,
        },
      }).catch(() => {});
    }
  } finally {
    isRunning = false;
  }
}

function generateTags(title, maxCount = 7) {
  const words = title
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);
  const unique = Array.from(new Set(words));
  return unique.slice(0, maxCount);
}

// Normalize an AI tag: lowercase, spaces allowed (1-2 words), strip leading "#".
// e.g. "Mia Khalifa" -> "mia khalifa", "BIG TITS" -> "big tits"
function normalizeAiTag(tag) {
  return String(tag || "")
    .trim()
    .replace(/^#/, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// ---- Thumbnail health scanner ----
let thumbnailScanRunning = false;

async function runThumbnailScan() {
  if (thumbnailScanRunning) return;
  thumbnailScanRunning = true;
  try {
    // Own advisory lock: even if two processes somehow both trigger a scan
    // (manual button + timer), only one scans at a time.
    const locked = await withAdvisoryLock(THUMBNAIL_SCAN_LOCK_KEY, async () => {
      const BATCH_SIZE = 200;
      let lastId = 0;
      let removedCount = 0;
      let keptCount = 0;

      while (true) {
        const videos = await many(
          "SELECT id, data FROM videos WHERE data->>'thumbnail' IS NOT NULL AND id > $1 ORDER BY id LIMIT $2",
          [lastId, BATCH_SIZE],
        );
        if (!videos.length) break;
        lastId = videos[videos.length - 1].id;

        const CONCURRENT_CHECKS = 21;
        let idx = 0;
        const checkWorker = async () => {
          while (idx < videos.length) {
            const v = videos[idx++];
            let thumbUrl = "";
            try {
              const data =
                typeof v.data === "string" ? JSON.parse(v.data) : v.data;
              thumbUrl = data.thumbnail || "";
            } catch {
              continue;
            }
            if (!thumbUrl) {
              await q("DELETE FROM videos WHERE id = $1", [v.id]);
              removedCount++;
              continue;
            }

            let alive = false;
            try {
              const res = await fetch(thumbUrl, {
                method: "GET",
                headers: {
                  "User-Agent": "Mozilla/5.0 (compatible; HDPORNFORYOU/2.0)",
                },
                signal: AbortSignal.timeout(8000),
              });
              alive = res.ok;
            } catch {
              alive = false;
            }

            if (alive) {
              keptCount++;
            } else {
              await q("DELETE FROM videos WHERE id = $1", [v.id]);
              removedCount++;
            }
          }
        };
        await Promise.all(
          Array.from(
            { length: Math.min(CONCURRENT_CHECKS, videos.length) },
            () => checkWorker(),
          ),
        );
      }

      if (removedCount > 0 || keptCount > 0) {
        await logEntry(
          "info",
          `Thumbnail scan: ${keptCount} kept, ${removedCount} removed (dead thumbnails)`,
        );
        if (removedCount > 0) {
          invalidate("videos:all");
          await bumpVideosEpoch();
        }
      }
    });
    if (!locked.acquired) {
      await logEntry(
        "skipped",
        "Thumbnail scan skipped: another worker is already scanning",
      );
    }
  } finally {
    thumbnailScanRunning = false;
  }
}

// ---- Scheduler ----
function automationStatusFromState(settings) {
  if (!settings.enabled) return "STOPPED";
  if (isPaused) return "PAUSED";
  if (isRunning) return "RUNNING";
  // v35 kept automation enabled as the source of truth. When enabled, the
  // engine must never be reported as STOPPED just because the in-memory timer
  // has not been created yet or was lost during a restart/hot reload.
  return "WAITING";
}

function msUntilNextMidnightUTC() {
  const now = new Date();
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      30,
      0, // 30s past midnight UTC to guarantee date rollover
    ),
  );
  return Math.max(1000, next.getTime() - now.getTime());
}

// Nepal is UTC+5:45 with no DST. Returns ms until the next given Nepal
// wall-clock time (e.g. 01:30:30 NPT = 19:45:30 UTC the previous day).
const NEPAL_UTC_OFFSET_MS = (5 * 60 + 45) * 60 * 1000;

function msUntilNextNepalClock(hour, minute, second = 0) {
  const now = Date.now();
  const n = new Date(now + NEPAL_UTC_OFFSET_MS);
  let next =
    Date.UTC(
      n.getUTCFullYear(),
      n.getUTCMonth(),
      n.getUTCDate(),
      hour,
      minute,
      second,
    ) - NEPAL_UTC_OFFSET_MS;
  if (next <= now) next += 24 * 60 * 60 * 1000;
  return Math.max(1000, next - now);
}

// Called when the daily import limit or AI daily limit is hit mid-cycle.
// Per workflow: stop automation immediately and auto-restart the next day
// with counters reset. Timer state lives on the server, not the browser.
async function scheduleNextDayResume(reason) {
  if (engineTimer) {
    clearTimeout(engineTimer);
    engineTimer = null;
  }
  if (resumeTimer) {
    clearTimeout(resumeTimer);
    resumeTimer = null;
  }
  isPaused = true;
  const ms = msUntilNextMidnightUTC();
  nextCycleAt = new Date(Date.now() + ms).toISOString();
  await saveRuntimeState({
    status: "PAUSED",
    nextCycleAt,
    isRunning: false,
    isPaused: true,
  });
  await logEntry(
    "stopped",
    `Automation stopped for the day: ${reason}; auto-restart scheduled at ${nextCycleAt} (next UTC day)`,
  );
  resumeTimer = setTimeout(async () => {
    resumeTimer = null;
    try {
      // Reset counters for the new day.
      aiCounter = 0;
      aiCounterDate = todayStr();
      await saveAiCounter();
      isPaused = false;
      await saveRuntimeState({
        status: "RUNNING",
        nextCycleAt: null,
        isRunning: true,
        isPaused: false,
      });
      const s = await getSettings();
      if (!s.enabled) {
        nextCycleAt = null;
        await saveRuntimeState({
          status: "STOPPED",
          nextCycleAt: null,
          isRunning: false,
          isPaused: false,
        });
        return;
      }
      await logEntry(
        "info",
        `Auto-resumed for new day (previous pause reason: ${reason}); counters reset; ` +
          `first import in ${s.intervalMinutes || 10} min`,
      );
      // Follow the configured interval: no immediate cycle at midnight — arm
      // the normal countdown (intervalMinutes) and wait, exactly like a fresh
      // Start. The armed tick then runs the cycle and keeps counting.
      await scheduleNext();
    } catch (e) {
      console.error("[automation] resume error:", e);
    }
  }, ms);
  resumeTimer.unref?.();
}

async function scheduleNext() {
  // A cycle is executing: NEVER publish a WAITING countdown (or arm a timer)
  // mid-import. The watchdog calls scheduleNext() every few seconds while the
  // engine is busy, and engineTimer is null during a cycle — without this
  // guard the status would flip to WAITING with a "Next cycle" countdown while
  // the import was still running, and the cycle's own scheduleNext() would
  // then override that timer. The running cycle's finally block schedules the
  // real countdown when it finishes.
  if (isRunning) return;
  const myScheduleSeq = ++scheduleSeq;
  // Always kill any previously scheduled tick before arming a new one so
  // there is exactly ONE engineTimer alive at any moment.
  if (engineTimer) {
    clearTimeout(engineTimer);
    engineTimer = null;
  }

  const settings = await getSettings();
  if (myScheduleSeq !== scheduleSeq) return;

  if (!settings.enabled) {
    nextCycleAt = null;
    await saveRuntimeState({
      status: "STOPPED",
      nextCycleAt: null,
      isRunning: false,
      isPaused: false,
      scheduleOwnerId: null,
      cycleToken,
    });
    return;
  }

  if (isPaused) {
    return;
  }

  // Capture the current cycle-generation token — if Start (or Stop) is
  // pressed before this timer fires, the token will change and this
  // callback becomes a no-op.
  const myToken = cycleToken;
  const myOwnerId = WORKER_ID;
  const intervalMs = (settings.intervalMinutes || 10) * 60 * 1000;
  nextCycleAt = new Date(Date.now() + intervalMs).toISOString();
  await saveRuntimeState({
    status: "WAITING",
    nextCycleAt,
    isRunning: false,
    isPaused: false,
    scheduleOwnerId: myOwnerId,
    cycleToken: myToken,
  });
  const runTick = async () => {
    engineTimer = null;
    if (myScheduleSeq !== scheduleSeq) return;
    if (myToken !== cycleToken) return; // superseded by a newer Start
    const runtime = await getRuntimeState();
    if (
      runtime.status !== "WAITING" ||
      runtime.scheduleOwnerId !== myOwnerId ||
      runtime.nextCycleAt !== nextCycleAt
    ) {
      return;
    }
    if (isRunning) {
      // A cycle is still running (e.g. long import from an immediate start).
      // NEVER rewrite the shared status to WAITING here — that published a
      // "Next cycle" countdown while the import was still executing. Just
      // re-check shortly; the running cycle's finally block arms the real
      // countdown when it finishes (and clears this recheck timer).
      engineTimer = setTimeout(runTick, CYCLE_RECHECK_MS);
      engineTimer.unref?.();
      return;
    }
    try {
      nextCycleAt = null;
      await saveRuntimeState({
        status: "RUNNING",
        nextCycleAt: null,
        isRunning: true,
        isPaused: false,
        scheduleOwnerId: myOwnerId,
        cycleToken: myToken,
      });
      await runCycleWithLock();
    } catch (e) {
      console.error("[automation] cycle error:", e);
    } finally {
      // Only the current generation is allowed to schedule the next tick.
      if (myToken === cycleToken) await scheduleNext();
    }
  };
  engineTimer = setTimeout(runTick, intervalMs);
  engineTimer.unref?.();
}

// ---- Thumbnail cleanup scheduler (daily 00:00 UTC) - pauses automation ----
let thumbnailSchedulerTimer = null;

async function scheduleThumbnailCleanup() {
  if (thumbnailSchedulerTimer) {
    clearTimeout(thumbnailSchedulerTimer);
    thumbnailSchedulerTimer = null;
  }
  // In worker mode the engine lives ONLY in the dedicated automation process —
  // API workers must never arm engine timers.
  if (AUTOMATION_WORKER_MODE) return;

  const settings = await getSettings();
  if (!settings.thumbnailAutoClean) return;

  thumbnailSchedulerTimer = setTimeout(async () => {
    thumbnailSchedulerTimer = null;
    let wasEnabled = false;
    try {
      const cur = await getSettings();
      wasEnabled = !!cur.enabled;
    } catch {}
    // --- Pause automation completely (even if RUNNING or WAITING) at midnight UTC ---
    if (wasEnabled) {
      await logEntry(
        "info",
        "Auto thumbnail cleanup: pausing automation at 00:00 UTC for thumbnail scan",
      );
      // Invalidate any pending engine tick and stop timers
      scheduleSeq++;
      cycleToken++;
      if (engineTimer) {
        clearTimeout(engineTimer);
        engineTimer = null;
      }
      if (resumeTimer) {
        clearTimeout(resumeTimer);
        resumeTimer = null;
      }
      // Signal in-flight cycle to exit at next checkpoint (keyword/page/batch)
      stopRequested = true;
      restartRequested = false;
      isPaused = true;
      nextCycleAt = null;
      await saveRuntimeState({
        status: "PAUSED",
        nextCycleAt: null,
        isRunning: false,
        isPaused: true,
        scheduleOwnerId: null,
        cycleToken,
      });
      // Wait for any running cycle to observe stopRequested and exit (max 30s)
      for (let i = 0; i < 30 && isRunning; i++) {
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (isRunning) {
        await logEntry(
          "info",
          "Auto thumbnail cleanup: cycle still running after 30s wait, scan will proceed anyway",
        );
      }
    } else {
      await logEntry(
        "info",
        "Auto thumbnail cleanup: scan started (daily 00:00 UTC) — automation already stopped",
      );
    }
    // --- Run scan ---
    try {
      await logEntry(
        "info",
        "Auto thumbnail cleanup: scan started (daily 00:00 UTC)",
      );
      await runThumbnailScan();
    } catch (e) {
      await logEntry("failure", `Auto thumbnail cleanup error: ${e.message}`);
    }
    // --- Resume automation (if it was running before) ---
    if (wasEnabled) {
      try {
        const cur2 = await getSettings();
        if (cur2.enabled) {
          stopRequested = false;
          isPaused = false;
          await logEntry(
            "info",
            "Auto thumbnail cleanup: scan finished — resuming automation",
          );
          // Fresh generation so old paused timers are invalid
          cycleToken++;
          scheduleSeq++;
          isRunning = false;
          await saveRuntimeState({
            status: "RUNNING",
            nextCycleAt: null,
            isRunning: true,
            isPaused: false,
            scheduleOwnerId: WORKER_ID,
            cycleToken,
          });
          // Kick off next cycle via normal scheduler (respects intervalMinutes)
          await scheduleNext();
        } else {
          // Admin disabled automation during scan window — stay stopped
          stopRequested = false;
          isPaused = false;
          await logEntry(
            "info",
            "Auto thumbnail cleanup: automation was disabled during scan, staying stopped",
          );
        }
      } catch (e) {
        console.error("[automation] thumbnail resume error:", e);
        await logEntry(
          "failure",
          `Auto thumbnail cleanup resume error: ${e.message}`,
        );
        stopRequested = false;
        isPaused = false;
      }
    }
    scheduleThumbnailCleanup();
  }, msUntilNextMidnightUTC());
  thumbnailSchedulerTimer.unref?.();
}

function scheduleDailyCounterReset() {
  if (dailyResetTimer) {
    clearTimeout(dailyResetTimer);
    dailyResetTimer = null;
  }
  dailyResetTimer = setTimeout(async () => {
    dailyResetTimer = null;
    try {
      aiCounter = 0;
      aiCounterDate = todayStr();
      await saveAiCounter();
      await logEntry("info", "UTC daily counters reset");
      if (isPaused) {
        const settings = await getSettings();
        if (settings.enabled) {
          isPaused = false;
          if (resumeTimer) {
            clearTimeout(resumeTimer);
            resumeTimer = null;
          }
          await saveRuntimeState({
            status: "RUNNING",
            nextCycleAt: null,
            isRunning: true,
            isPaused: false,
          });
          runCycleWithLock()
            .catch((e) =>
              console.error("[automation] daily reset cycle error:", e),
            )
            .finally(() => void scheduleNext());
        }
      }
    } catch (e) {
      console.error("[automation] daily reset error:", e);
    } finally {
      scheduleDailyCounterReset();
    }
  }, msUntilNextMidnightUTC());
  dailyResetTimer.unref?.();
}

// ---- Admin command relay (API workers -> dedicated automation worker) ----
// API cluster workers INSERT into automation_commands; the single dedicated
// automation worker polls the table and executes the action IN ITS OWN
// process, so every engine timer/flag stays in exactly one process while the
// admin UI can still drive Start/Stop/Manual from any API replica.

const COMMAND_TYPES = new Set([
  "start",
  "stop",
  "manual",
  "scan-thumbnails",
  "set-ai-counter",
]);

export async function enqueueAutomationCommand(cmd, payload = null) {
  if (!COMMAND_TYPES.has(cmd))
    throw new Error(`Unknown automation command: ${cmd}`);
  await q(
    `INSERT INTO automation_commands (cmd, payload) VALUES ($1, $2::jsonb)`,
    [cmd, payload ? JSON.stringify(payload) : null],
  );
  return { ok: true };
}

// Atomically claim the oldest pending command. Stale claims (worker crashed
// mid-execution) become re-claimable after 5 minutes. A single consumer
// makes races impossible — the claim is a belt-and-suspenders guard for the
// "restart while a command was in flight" window.
async function claimNextAutomationCommand() {
  return one(
    `UPDATE automation_commands
        SET claimed_at = NOW(), claimed_by = $1
      WHERE id = (
        SELECT id FROM automation_commands
         WHERE claimed_at IS NULL OR claimed_at < NOW() - INTERVAL '5 minutes'
         ORDER BY id LIMIT 1
      )
      RETURNING *`,
    [WORKER_ID],
  );
}

async function drainAutomationCommands() {
  for (let i = 0; i < COMMANDS_PER_TICK; i++) {
    const cmd = await claimNextAutomationCommand();
    if (!cmd) return;
    try {
      switch (cmd.cmd) {
        case "start": {
          const result = await startAutomation();
          if (result.restartQueued) {
            await logEntry(
              "info",
              "Start command applied — restart queued (cycle in progress)",
            );
          }
          break;
        }
        case "stop":
          await stopAutomation();
          break;
        case "manual": {
          const result = await triggerManualImport();
          if (!result.ok)
            await logEntry("skipped", `Manual import skipped: ${result.error}`);
          break;
        }
        case "scan-thumbnails": {
          const result = await triggerThumbnailScan();
          if (!result.ok)
            await logEntry(
              "skipped",
              `Thumbnail scan skipped: ${result.error}`,
            );
          break;
        }
        case "set-ai-counter":
          await setAiCounterValue(Number(cmd.payload?.count ?? 0));
          break;
        default:
          await logEntry("failure", `Unknown automation command: ${cmd.cmd}`);
      }
    } catch (e) {
      console.error(`[automation] command "${cmd.cmd}" failed:`, e);
      await logEntry("failure", `Command "${cmd.cmd}" failed: ${e.message}`);
    } finally {
      await q("DELETE FROM automation_commands WHERE id = $1", [cmd.id]);
    }
  }
}

// Started by the dedicated automation worker only. Keeps the process alive.
export function runAutomationCommandConsumer() {
  if (commandConsumerTimer) return;
  commandConsumerTimer = setInterval(() => {
    drainAutomationCommands().catch((e) =>
      console.error("[automation] command consumer error:", e),
    );
  }, COMMAND_POLL_MS);
  console.log("[automation] command consumer running (poll every 1s)");
}

// ---- Engine watchdog (self-heal across restarts) ----
// Every cycle's runCycle() already reads admin settings fresh. This watchdog
// additionally guarantees the ENGINE stays alive in the worker process even
// if the process crashed and PM2 restarted it: if automation is enabled but
// no timer is armed, re-arm the countdown. It also picks up admin changes to
// thumbnailAutoClean made on any API replica (in worker mode this is the ONLY
// thing the watchdog does — the engine timers live solely in the dedicated
// automation process).
async function syncEngineState() {
  const settings = await getSettings();

  const clean = !!settings.thumbnailAutoClean;
  if (clean !== lastThumbnailAutoClean) {
    lastThumbnailAutoClean = clean;
    await scheduleThumbnailCleanup();
    await logEntry(
      "info",
      clean
        ? "Auto thumbnail cleanup: enabled (daily 00:00 UTC)"
        : "Auto thumbnail cleanup: disabled",
    );
  }

  if (AUTOMATION_WORKER_MODE) return;

  if (!settings.enabled) return;
  const limit = settings.aiDailyLimit || AI_LIMIT_DAILY_DEFAULT;

  if (aiCounter >= limit) {
    // AI budget exhausted (e.g. spent by the manual importer) — ensure the
    // next-day auto-resume is armed so 24/7 import restarts at UTC midnight.
    if (!resumeTimer && !engineTimer) {
      isPaused = true;
      await scheduleNextDayResume(
        `AI daily limit reached (${aiCounter}/${limit})`,
      );
    }
    return;
  }
  if (isPaused) return;
  // Note: runCycle()/scheduleNextDayResume() also handle the daily IMPORT
  // limit mid-cycle, so no early exit needed here — a running cycle will
  // pause itself and arm the resume timer.
  if (!engineTimer && !resumeTimer) {
    await scheduleNext();
  }
}

export function runAutomationWatchdog() {
  if (watchdogTimer) return;
  // Chained setTimeout (not setInterval): the next tick is only armed after
  // the previous one finishes, so two ticks can never overlap even if a tick
  // is delayed by a slow DB — single-flight by construction.
  const tick = async () => {
    await syncEngineState().catch((e) =>
      console.error("[automation] watchdog error:", e),
    );
    watchdogTimer = setTimeout(tick, WATCHDOG_MS);
    watchdogTimer.unref?.();
  };
  watchdogTimer = setTimeout(tick, WATCHDOG_MS);
  watchdogTimer.unref?.();
}

// ---- Public API ----
export async function startAutomation() {
  const settings = await getSettings();
  await loadAiCounter();

  // Every Start click invalidates any previously scheduled timer callback
  // by bumping the cycle-generation token. Combined with the token check
  // inside scheduleNext(), this guarantees at most ONE active timer loop
  // no matter how many times the admin mashes Start.
  cycleToken += 1;
  scheduleSeq += 1;
  if (engineTimer) {
    clearTimeout(engineTimer);
    engineTimer = null;
  }
  if (resumeTimer) {
    clearTimeout(resumeTimer);
    resumeTimer = null;
  }
  nextCycleAt = null;

  if (aiCounter >= (settings.aiDailyLimit || AI_LIMIT_DAILY_DEFAULT)) {
    isPaused = true;
    await logEntry(
      "stopped",
      `AI limit reached (${settings.aiDailyLimit || AI_LIMIT_DAILY_DEFAULT}/${settings.aiDailyLimit || AI_LIMIT_DAILY_DEFAULT}) — cannot start`,
    );
    return { ok: false, error: "AI daily limit reached" };
  }

  if (
    isPaused &&
    aiCounter < (settings.aiDailyLimit || AI_LIMIT_DAILY_DEFAULT)
  ) {
    isPaused = false;
  }

  stopRequested = false;
  settings.enabled = true;
  await saveSettings(settings);
  await saveRuntimeState({
    status: "RUNNING",
    nextCycleAt: null,
    isRunning: true,
    isPaused: false,
    scheduleOwnerId: WORKER_ID,
    cycleToken,
  });

  // If a cycle is currently executing, we must NOT launch a parallel one.
  // Instead flag a restart request — the in-flight cycle's finally handler
  // will run a fresh cycle immediately (bypassing the interval wait) so the
  // admin's Start click still produces the promised "run now, then fresh
  // countdown" behavior. Status stays RUNNING throughout.
  if (isRunning) {
    restartRequested = true;
    await logEntry("info", "Automation restart requested (cycle in progress)");
    return { ok: true, restartQueued: true };
  }

  await logEntry("info", "Automation started");

  // Run the first cycle INSTANTLY, then schedule the next one on the full
  // interval countdown. Errors don't break the loop.
  const myToken = cycleToken;
  (async () => {
    try {
      await runCycleWithLock();
    } catch (e) {
      console.error("[automation] start cycle error:", e);
    }
    // Drain any restart requests queued while runCycle() was executing so
    // Start clicks made mid-cycle still take effect exactly once each.
    while (restartRequested && myToken === cycleToken) {
      restartRequested = false;
      try {
        await runCycleWithLock();
      } catch (e) {
        console.error("[automation] restart cycle error:", e);
      }
    }
    // Only the current generation is allowed to arm the countdown.
    if (myToken === cycleToken) {
      restartRequested = false;
      await scheduleNext();
    }
  })();
  return { ok: true };
}

export async function stopAutomation() {
  // Invalidate any pending scheduled callback so it exits as a no-op.
  cycleToken += 1;
  scheduleSeq += 1;
  if (engineTimer) {
    clearTimeout(engineTimer);
    engineTimer = null;
  }
  if (resumeTimer) {
    clearTimeout(resumeTimer);
    resumeTimer = null;
  }
  stopRequested = true;
  restartRequested = false;
  const settings = await getSettings();
  settings.enabled = false;
  await saveSettings(settings);
  isPaused = false;
  nextCycleAt = null;
  await saveRuntimeState({
    status: "STOPPED",
    nextCycleAt: null,
    isRunning: false,
    isPaused: false,
    scheduleOwnerId: null,
    cycleToken,
  });
  await logEntry("stopped", "Automation stopped");
  return { ok: true };
}

export async function getStatus() {
  await loadAiCounter();
  const settings = await getSettings();
  const runtime = await getRuntimeState();
  const runtimeUpdatedAt = runtime.updatedAt
    ? new Date(runtime.updatedAt).getTime()
    : 0;
  const staleRuntime =
    runtimeUpdatedAt > 0 && Date.now() - runtimeUpdatedAt > 2 * 60 * 60 * 1000;

  await resetDailyCountersIfNeeded();
  const importedToday = await countVideosImportedToday();
  const queueSize = await one(
    "SELECT COUNT(*)::int AS n FROM thumbnail_queue WHERE status = 'failed'",
  );

  let status = automationStatusFromState(settings);
  let sharedNextCycleAt = nextCycleAt;
  let sharedIsRunning = isRunning;
  let sharedIsPaused = isPaused;
  if (settings.enabled && runtime.status && !staleRuntime) {
    status = isRunning ? "RUNNING" : runtime.status;
    sharedNextCycleAt =
      status === "WAITING" || status === "PAUSED"
        ? runtime.nextCycleAt || null
        : null;
    sharedIsRunning = status === "RUNNING";
    sharedIsPaused = status === "PAUSED";
  }

  // Always show remaining capacity for the day regardless of whether the
  // engine is running — admins need to see today's headroom even when the
  // automation is stopped/paused.
  const remainingImports = Math.max(
    0,
    (settings.dailyImportLimit || 50000) - (importedToday?.n || 0),
  );

  return {
    status,
    aiRequestsUsed: aiCounter,
    aiRequestsLimit: settings.aiDailyLimit || AI_LIMIT_DAILY_DEFAULT,
    nextCycleAt: sharedNextCycleAt,
    // DB-persisted so the admin tab shows live batch progress even though
    // the cycle runs in the dedicated automation process.
    currentBatch: runtime.currentBatch ?? 0,
    lastImport: runtime.lastImport ?? null,
    isRunning: sharedIsRunning,
    isPaused: sharedIsPaused,
    videosImportedToday: importedToday?.n || 0,
    dailyImportLimit: settings.dailyImportLimit || 50000,
    remainingImports,
    queueSize: queueSize?.n || 0,
    intervalMinutes: settings.intervalMinutes || 10,
    aiEnabled: settings.aiEnabled,
    aiModel: settings.aiModel,
  };
}

export async function triggerManualImport() {
  if (isRunning) return { ok: false, error: "Already running" };
  runCycleWithLock(true).catch((e) =>
    console.error("[automation] manual cycle error:", e),
  );
  return { ok: true };
}

export async function triggerThumbnailScan() {
  if (thumbnailScanRunning)
    return { ok: false, error: "Scan already in progress" };
  runThumbnailScan().catch((e) =>
    console.error("[automation] thumbnail scan error:", e),
  );
  return { ok: true };
}

export async function getLogs(limit = 50, offset = 0, filterType = null) {
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 50));
  let sql = "SELECT id, type, message, details, created_at FROM import_logs";
  const params = [];
  if (filterType) {
    sql += " WHERE type = $1";
    params.push(filterType);
  }
  sql +=
    " ORDER BY created_at DESC, id DESC LIMIT $" +
    (params.length + 1) +
    " OFFSET $" +
    (params.length + 2);
  params.push(safeLimit, offset);
  return many(sql, params);
}

export async function clearLogs() {
  await q("DELETE FROM import_logs");
  return { ok: true };
}

export {
  getSettings,
  saveSettings,
  getKeywords,
  addKeyword,
  deleteKeyword,
  updateKeyword,
  DEFAULTS,
};
export { getApiKeys, saveApiKeys };
export { callOpenRouter, parseAiResponse, fetchCategorySlugs, enrichInChunks };
export { scheduleThumbnailCleanup };
export { bumpVideosEpoch };

export async function setAiCounterValue(count) {
  aiCounter = Math.max(0, Math.trunc(Number(count) || 0));
  aiCounterDate = todayStr();
  await saveAiCounter();
}

export async function initAutomation() {
  await loadAiCounter();
  await resetDailyCountersIfNeeded();
  const settings = await getSettings();
  const dailyLimit = settings.aiDailyLimit || AI_LIMIT_DAILY_DEFAULT;
  if (settings.enabled && aiCounter >= dailyLimit) {
    isPaused = true;
    await logEntry(
      "stopped",
      `AI limit reached on startup (${dailyLimit}/${dailyLimit}) — PAUSED`,
    );
  }
  if (AUTOMATION_WORKER_MODE) return;
  lastThumbnailAutoClean = !!settings.thumbnailAutoClean;
  scheduleThumbnailCleanup();
  runAutomationWatchdog();
  scheduleDailyCounterReset();
}
