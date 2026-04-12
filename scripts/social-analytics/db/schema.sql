CREATE TABLE IF NOT EXISTS engagement_metrics (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  platform      TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  post_id       TEXT NOT NULL,
  post_url      TEXT,
  published_at  TEXT,
  metric_date   TEXT NOT NULL,
  impressions   INTEGER DEFAULT 0,
  reach         INTEGER DEFAULT 0,
  likes         INTEGER DEFAULT 0,
  comments      INTEGER DEFAULT 0,
  shares        INTEGER DEFAULT 0,
  saves         INTEGER DEFAULT 0,
  clicks        INTEGER DEFAULT 0,
  video_views   INTEGER DEFAULT 0,
  followers_delta INTEGER DEFAULT 0,
  extra_json    TEXT,
  fetched_at    TEXT NOT NULL,
  UNIQUE(platform, post_id, metric_date)
);

CREATE TABLE IF NOT EXISTS follower_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  platform      TEXT NOT NULL,
  follower_count INTEGER NOT NULL,
  snapshot_date TEXT NOT NULL,
  UNIQUE(platform, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_metrics_platform_date ON engagement_metrics(platform, metric_date);
CREATE INDEX IF NOT EXISTS idx_metrics_published ON engagement_metrics(published_at);

-- Marketing posts: tracks every post, video, and article published to any platform.
-- Used to prevent double-posting and to measure marketing effort over time.
CREATE TABLE IF NOT EXISTS marketing_posts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  type          TEXT NOT NULL CHECK(type IN ('post','video','article','reply','thread')),
  platform      TEXT NOT NULL,
  account_id    TEXT,
  post_id       TEXT,
  post_url      TEXT,
  title         TEXT,
  content_hash  TEXT NOT NULL,
  published_at  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','failed','skipped','draft')),
  tags          TEXT,            -- JSON array
  campaign      TEXT,            -- e.g. 'v1.4.0-launch', 'weekly-stats'
  extra_json    TEXT,            -- arbitrary metadata
  UNIQUE(platform, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_mktg_platform_published ON marketing_posts(platform, published_at);
CREATE INDEX IF NOT EXISTS idx_mktg_campaign ON marketing_posts(campaign);
CREATE INDEX IF NOT EXISTS idx_mktg_type ON marketing_posts(type);
