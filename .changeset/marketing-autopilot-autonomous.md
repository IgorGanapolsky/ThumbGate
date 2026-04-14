---
"thumbgate": patch
---

feat(ci): autonomous marketing autopilot every 4 hours — video, text posts, Reddit, Dev.to

- video-autopilot.yml: generates slide-based MP4 (6 rotating templates), posts to TikTok/YouTube/Instagram via Zernio every 4 hours with per-platform cooldowns
- marketing-autopilot.yml: rewritten to fire every 4 hours (was Mon/Wed/Fri), all secrets wired (DEVTO_API_KEY, Reddit password OAuth, full X API), fixed reddit.publishToReddit() call, added Dev.to article step with 7-day dedup
- marketing-db.js: SQLite dedup + analytics tracker prevents double-posting
- post-video.js: full slide→ffmpeg→Zernio pipeline
