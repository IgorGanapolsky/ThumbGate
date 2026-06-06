---
"thumbgate": patch
---

Fix statusline display showing inflated thumbs counts (e.g. 1152↑/747↓ when the true cross-store total was 727↑/600↓). `scripts/statusline-cache-read.js` was summing `thumbs_up`/`thumbs_down` across every per-folder `statusline_cache.json`, but the canonical global aggregate at `~/.thumbgate/statusline_cache.json` is itself written as the cross-store sum (by `feedback-aggregate.js`). Summing the aggregate plus the per-folder caches counted every event twice. The helper now resolves the highest-priority existing cache and returns its content unchanged.
