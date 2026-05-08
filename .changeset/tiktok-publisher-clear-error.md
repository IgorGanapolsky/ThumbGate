---
"thumbgate": patch
---

`scripts/post-everywhere.js` now surfaces a clear error when TikTok routing is requested, instead of crashing with `TypeError: tiktok.publishPost is not a function`. TikTok has no text-only Direct Post endpoint; the working paths are `scripts/social-pipeline.js` with a recorded MP4 or direct `publishTikTokVideo({ videoUrl, title })` invocation.
