-- ============================================================
-- HDPORNFORYOU PostgreSQL schema (self-hosted)
-- Idempotent: safe to run repeatedly. Used by src/migrate.js
-- and auto-applied at server boot.
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_color  TEXT NOT NULL DEFAULT '#3b82f6',
  full_name     TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower    ON users (LOWER(email));
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username));

CREATE TABLE IF NOT EXISTS admins (
  username      TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS videos (
  id           TEXT PRIMARY KEY,
  slug         TEXT,
  data         JSONB NOT NULL,
  views        BIGINT NOT NULL DEFAULT 0,
  views_boost  BIGINT NOT NULL DEFAULT 0,
  likes_boost  BIGINT NOT NULL DEFAULT 0,
  likes_base   BIGINT NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Drop legacy UNIQUE constraint on slug (uniqueness is now enforced by
-- embed id at the application layer; two videos may share a slug).
ALTER TABLE videos DROP CONSTRAINT IF EXISTS videos_slug_key;
CREATE INDEX IF NOT EXISTS idx_videos_slug       ON videos (slug);
CREATE INDEX IF NOT EXISTS idx_videos_updated_at ON videos (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_views      ON videos (views DESC);
-- JSONB indexes for category / search filtering at scale.
CREATE INDEX IF NOT EXISTS idx_videos_category   ON videos ((data->>'category'));
CREATE INDEX IF NOT EXISTS idx_videos_uploaded   ON videos (((data->>'uploadedAt')));
CREATE INDEX IF NOT EXISTS idx_videos_data_gin   ON videos USING gin (data);

CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  video_id   TEXT NOT NULL,
  author     TEXT NOT NULL,
  email      TEXT,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'approved',
  user_id    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_comments_video   ON comments (video_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_created ON comments (created_at DESC);

CREATE TABLE IF NOT EXISTS reactions (
  user_id    TEXT NOT NULL,
  video_id   TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('like','dislike')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, video_id)
);
CREATE INDEX IF NOT EXISTS idx_reactions_video ON reactions (video_id, kind);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ad_events (
  id     BIGSERIAL PRIMARY KEY,
  zone   TEXT NOT NULL,
  format TEXT,
  event  TEXT NOT NULL,
  ts     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ad_events_zone ON ad_events (zone);
CREATE INDEX IF NOT EXISTS idx_ad_events_ts   ON ad_events (ts DESC);

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id    TEXT NOT NULL,
  channel    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, channel)
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions (user_id);

CREATE TABLE IF NOT EXISTS saved_videos (
  user_id    TEXT NOT NULL,
  video_id   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, video_id)
);
CREATE INDEX IF NOT EXISTS idx_saved_user ON saved_videos (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS page_events (
  id         BIGSERIAL PRIMARY KEY,
  path       TEXT,
  session_id TEXT,
  ts         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_page_events_ts      ON page_events (ts DESC);
CREATE INDEX IF NOT EXISTS idx_page_events_session ON page_events (session_id);

-- Import keywords for auto-import system
CREATE TABLE IF NOT EXISTS import_keywords (
  id          SERIAL PRIMARY KEY,
  keyword     TEXT NOT NULL,
  priority    TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Automation logs
CREATE TABLE IF NOT EXISTS import_logs (
  id          BIGSERIAL PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('success', 'failure', 'skipped', 'stopped', 'info')),
  message     TEXT NOT NULL,
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_import_logs_type      ON import_logs (type);
CREATE INDEX IF NOT EXISTS idx_import_logs_created   ON import_logs (created_at DESC);

-- Thumbnail health check queue
CREATE TABLE IF NOT EXISTS thumbnail_queue (
  id            BIGSERIAL PRIMARY KEY,
  video_id      TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'checked', 'failed')),
  checked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_thumbnail_queue_status ON thumbnail_queue (status);

-- Admin action relay: API cluster workers INSERT here, the single dedicated
-- automation worker polls and executes. Keeps every timer/importer in ONE
-- process while every worker can still start/stop/trigger imports.
CREATE TABLE IF NOT EXISTS automation_commands (
  id          BIGSERIAL PRIMARY KEY,
  cmd         TEXT NOT NULL,
  payload     JSONB,
  claimed_at  TIMESTAMPTZ,
  claimed_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_automation_commands_pending ON automation_commands (id)
  WHERE claimed_at IS NULL;

-- express-session store table (connect-pg-simple).
CREATE TABLE IF NOT EXISTS "session" (
  "sid"    varchar      NOT NULL COLLATE "default",
  "sess"   json         NOT NULL,
  "expire" timestamp(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
