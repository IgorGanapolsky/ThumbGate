# Social Media & Analytics Pipeline — Research Synthesis (March 2026)

## Executive Summary

We have **zero working social analytics** and a **broken publishing pipeline**. This document synthesizes deep research across 5 domains to define the cheapest, fastest path to a fully wired marketing stack.

**Current state:**
- 6 paid orders (GitHub Marketplace), $0 booked revenue
- 0 web traffic/CTA tracking
- 9 failed Instagram publish attempts (Playwright broken)
- 0 engagement data from any social platform
- No API credentials for Instagram, TikTok, or X

---

## 1. PUBLISHING: Replace Broken Playwright Pipeline

### Problem
Our `social-pipeline.js` uses Playwright browser automation to post. Every attempt fails (missing `playwright-core`, Chrome timeouts, DOM selector changes). Meta actively bans accounts using browser automation.

### Recommendation: Instagram Graph API (free) + TikTok Content Posting API (free)

**Instagram Carousel Publishing Flow:**
1. Upload rendered PNGs to publicly accessible URLs (Cloudflare R2 or S3)
2. Create child containers: `POST /{ig-user-id}/media` with `is_carousel_item=true`
3. Poll each container until `status=FINISHED`
4. Create parent: `POST /{ig-user-id}/media` with `media_type=CAROUSEL` and `children={id1,id2,...}`
5. Publish: `POST /{ig-user-id}/media_publish` with `creation_id={parent_id}`

**Requirements:**
- Instagram Business/Creator account linked to a Facebook Page
- Meta App at developers.facebook.com with `instagram_content_publish` permission
- Long-lived Page Access Token (never expires if sourced from long-lived user token)

**TikTok Publishing:**
- Register app at developers.tiktok.com, Content Posting API
- OAuth2 with `video.publish` scope
- Caveat: Unaudited apps post as private-only. Audit takes weeks.

**Fallback (fastest migration):** Publer API ($12/mo) — single API covers both Instagram carousels and TikTok videos. No separate developer app approvals needed.

### What to keep from current pipeline
- HTML carousel rendering and slide extraction
- Slide image validation
- Caption resolution
- JSONL history/queue tracking

### What to delete
- All Playwright/CDP code
- AppleScript browser sessions
- Chrome profile copying
- DOM polling / file input manipulation

---

## 2. ANALYTICS: Instagram Engagement Tracking

### API: Instagram Graph API (free, 200 calls/hour)

**Per-post metrics available:**
| Metric | Endpoint |
|--------|----------|
| Impressions | `GET /{media-id}/insights?metric=impressions` |
| Reach | `GET /{media-id}/insights?metric=reach` |
| Saves | `GET /{media-id}/insights?metric=saved` |
| Shares | `GET /{media-id}/insights?metric=shares` |
| Likes | `GET /{media-id}?fields=like_count` |
| Comments | `GET /{media-id}?fields=comments_count` |

**Carousel-specific:** Insights are on the parent carousel object only. Individual slides do NOT have separate insights endpoints.

**Account-level:** `GET /{ig-user-id}/insights?metric=reach,impressions,follower_count&period=day`

**Authentication:** Facebook Login OAuth -> short-lived token -> exchange for long-lived (60d) -> Page Token (never expires). Store in `.env` as `INSTAGRAM_ACCESS_TOKEN`.

**New in late 2025/early 2026:**
- Reels skip rate metric
- Media-level and account-level repost counts
- Basic Display API is dead (Dec 2024)
- `video_views` deprecated for non-Reels

**Node.js:** Direct `fetch` calls are simplest. Optional: `instagram-graph-api` npm package for typed SDK.

---

## 3. ANALYTICS: TikTok Engagement Tracking

### API: TikTok Content Posting API v2 (free, 600 req/day/user)

**Per-video metrics via `GET /v2/video/list/`:**
| Metric | Field |
|--------|-------|
| Views | `view_count` |
| Likes | `like_count` |
| Comments | `comment_count` |
| Shares | `share_count` |
| Duration | `duration` |

**NOT available via API:** Watch time, average view duration, traffic source breakdown, follower growth per video (in-app only).

**Follower tracking:** `GET /v2/user/info/?fields=follower_count,likes_count,video_count`

**Authentication:** OAuth 2.0 with PKCE (mandatory since Nov 2025). Tokens expire in 24h, refresh tokens last 365 days.

**New in 2026:**
- `share_count` added to video list (Jan 2026)
- Rate limits bumped to 5,000 req/day (March 2026)
- Webhook support for view milestones (closed beta)
- Commercial Research API license now available

**Node.js:** No official SDK. Direct `fetch` is the recommended approach.

---

## 4. ANALYTICS: Web Traffic & Attribution

### Recommendation: Plausible Cloud ($9/mo)

**Why Plausible:**
- Cleanest REST API for programmatic read-back (fits our `funnel-analytics.js` pattern)
- Cookie-free = no consent banners = better conversion
- UTM tracking automatic
- Zero ops burden
- < 1 KB script tag

**Alternatives considered:**
| Solution | Cost | Verdict |
|----------|------|---------|
| Plausible Cloud | $9/mo | **Best fit** — clean API, zero ops |
| Umami (self-hosted on Railway) | ~$5/mo | Good budget option, weaker API auth |
| PostHog Cloud | $0 (1M events free) | Best funnels, but 30KB script, needs cookie consent |
| GA4 | $0 | Privacy-hostile, complex, consent banners kill conversion |
| Cloudflare/Vercel | $0 | No custom events, no API — skip |

**Key API patterns:**
```js
// Read funnel metrics
GET /api/v1/stats/aggregate?site_id=X&metrics=visitors&period=30d
GET /api/v1/stats/aggregate?site_id=X&filters=event:name==CTA Click&metrics=events
GET /api/v1/stats/breakdown?site_id=X&property=visit:source&metrics=visitors

// Track server-side events (e.g. after Stripe webhook)
POST /api/event { domain, name, url, props }
```

**UTM tracking:** Automatic. Plausible parses `utm_source`, `utm_medium`, `utm_campaign` from URLs.

---

## 5. ANALYTICS: GitHub Repo Traffic

### API: GitHub REST API (free, 5,000 req/hour)

**Critical:** GitHub only retains traffic data for **14 days**. Must poll at minimum every 13 days.

**Endpoints:**
```
GET /repos/{owner}/{repo}/traffic/views       — pageviews (14-day window)
GET /repos/{owner}/{repo}/traffic/clones      — clones (14-day window)
GET /repos/{owner}/{repo}/traffic/popular/referrers
GET /repos/{owner}/{repo}                     — stars, forks, watchers
```

**Node.js:** Use `@octokit/rest` (already have `GITHUB_TOKEN`).

---

## 6. ANALYTICS: X/Twitter

### API: X API v2 — Basic tier ($100/mo)

**Metrics on Basic:** `retweet_count`, `reply_count`, `like_count`, `quote_count`, `impression_count`, `bookmark_count`

**Recommendation:** Skip for now. $100/mo is not justified until X is a proven traffic driver. Log X metrics manually or use a cheap unofficial API ($20/mo) if needed.

---

## 7. UNIFIED PIPELINE: Architecture

### Data Model (SQLite via `better-sqlite3`)
```sql
CREATE TABLE engagement_metrics (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  platform      TEXT NOT NULL,        -- 'instagram' | 'tiktok' | 'x' | 'github'
  content_type  TEXT NOT NULL,        -- 'carousel' | 'reel' | 'video' | 'repo'
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

CREATE TABLE follower_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  platform      TEXT NOT NULL,
  follower_count INTEGER NOT NULL,
  snapshot_date TEXT NOT NULL,
  UNIQUE(platform, snapshot_date)
);
```

### Polling Schedule
| Platform | Interval | Rate Limit | Data Retention |
|----------|----------|------------|----------------|
| Instagram | Every 6h | 200 calls/hr | 2 years |
| TikTok | Every 12h | 600 req/day/user | 30 days (some) |
| GitHub | Every 12h | 5,000 req/hr | **14 days only** |
| X/Twitter | Skip (MVP) | 10 req/15min (Basic) | Permanent |

### Reporting
- **Weekly JSON digest** committed to repo, queryable by MCP
- **Slack webhook** for weekly summary notification
- **MCP server** exposing `query_metrics` and `top_content` tools for Claude

### File Structure
```
scripts/
  social-analytics/
    pollers/
      github.js
      instagram.js
      tiktok.js
    normalizer.js
    store.js             # better-sqlite3, upsert logic
    digest.js            # weekly JSON report
    notify.js            # Slack webhook
    mcp-server.js        # MCP resource for Claude queries
    db/
      schema.sql
```

---

## 8. IMPLEMENTATION PRIORITY

| Phase | What | Time | Cost |
|-------|------|------|------|
| **P1** | Replace Playwright with Instagram Graph API publishing | 4h | $0 |
| **P2** | Add Instagram engagement poller | 3h | $0 |
| **P3** | Add GitHub traffic poller (14-day data loss risk) | 2h | $0 |
| **P4** | SQLite store + normalizer | 2h | $0 |
| **P5** | TikTok engagement poller | 3h | $0 |
| **P6** | Weekly digest + Slack notification | 2h | $0 |
| **P7** | Plausible Cloud setup + funnel-analytics.js integration | 2h | $9/mo |
| **P8** | MCP analytics server (Claude-queryable) | 3h | $0 |
| **P9** | UTM tracking + social-to-web correlation | 3h | $0 |
| **P10** | TikTok publishing via official API | 3h | $0 |

**Total: ~27 hours, $9/mo recurring**

---

## 9. REQUIRED CREDENTIALS

| Credential | Where to get it | Store as |
|------------|----------------|----------|
| Instagram Page Access Token | developers.facebook.com -> Meta App -> Instagram Graph API | `INSTAGRAM_ACCESS_TOKEN` |
| Instagram User ID | `GET /me/accounts` -> Page ID -> `GET /{page-id}?fields=instagram_business_account` | `INSTAGRAM_USER_ID` |
| TikTok Client Key + Secret | developers.tiktok.com -> Create App | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` |
| TikTok Access Token | OAuth2 flow with PKCE | `TIKTOK_ACCESS_TOKEN` (+ refresh token) |
| Plausible API Key | plausible.io -> Settings -> API Keys | `PLAUSIBLE_API_KEY` |
| Plausible Site ID | Your domain | `PLAUSIBLE_SITE_ID` |
| GitHub Token | Already have | `GITHUB_TOKEN` |
| Slack Webhook URL | Slack -> Apps -> Incoming Webhooks | `SLACK_WEBHOOK_URL` |
| Image hosting (for IG publishing) | Cloudflare R2 or S3 | `R2_ENDPOINT`, `R2_ACCESS_KEY`, `R2_SECRET_KEY` |

---

## 10. NORTH STAR METRICS

Once wired, we can track progress toward first 10 paying customers:

| Metric | Source | Current | Target |
|--------|--------|---------|--------|
| Website visitors/mo | Plausible | 0 | 1,000 |
| CTA clicks/mo | Plausible events | 0 | 50 |
| Checkout starts/mo | Plausible events | 0 | 20 |
| Paid orders | GitHub Marketplace + Stripe | 6 | 10 |
| IG impressions/post | Instagram Graph API | unknown | 500+ |
| IG engagement rate | Instagram Graph API | unknown | 3%+ |
| TikTok views/video | TikTok API | unknown | 1,000+ |
| GitHub stars | GitHub API | current | +50/mo |
| GitHub traffic/wk | GitHub API | unknown | 200+ views |

---

*Research completed 2026-03-21. Sources: Meta Developer Docs, TikTok Developer Portal, Plausible docs, GitHub REST API docs, Ayrshare, Publer, PostHog, Umami, and current npm ecosystem.*
