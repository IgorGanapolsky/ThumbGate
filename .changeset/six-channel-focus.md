---
"thumbgate": minor
---

Drop X/Twitter from the active distribution loop and consolidate on six focus channels: Reddit, LinkedIn, Threads, Bluesky, Instagram, YouTube. `scripts/post-everywhere.js` now exports a frozen `DEFAULT_PLATFORMS` list with dispatchers for each channel; Threads and Bluesky route through the Zernio aggregator. Marketing-autopilot, reply-monitor, weekly-social-post, Ralph mode/loop, social-engagement-hourly, GTM autonomous loop, daily revenue loop, and social-analytics workflows no longer reference X/Twitter secrets or fallback posters. `tests/post-everywhere-channels.test.js` pins the new focus list and rejects X/Twitter regressions. Legacy `scripts/post-to-x*.js` modules remain on disk for manual ad-hoc use only.
