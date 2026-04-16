---
thumbgate: patch
---

Enforce per-platform character limits in the Zernio publisher before posting or scheduling. The previous path blasted identical content to every connected platform — a 315-char post silently failed at Bluesky's 300-char ceiling (CEO-reported post `69d939ba88955f0579e44fa7`, 2026-04-16). New `platform-limits.js` module maps canonical limits (Bluesky 300, X/Twitter 280, LinkedIn 3000, etc.) and rejects over-limit targets with actionable `{ reason, platform, limit, length, overBy }` detail rather than letting the provider eat the failure.
