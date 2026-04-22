---
'thumbgate': patch
---

Route LinkedIn and Threads publishing through Zernio when `ZERNIO_API_KEY` is
set, collapsing three token rotations (LinkedIn, Threads, Bluesky) to a single
Zernio OAuth bundle. Direct-API publishers remain the fallback when the key is
absent and can be forced back on with `THUMBGATE_USE_DIRECT_PUBLISHERS=1`
(emergency escape parallel to `THUMBGATE_USE_DIRECT_POLLERS=1` for analytics).
Reddit, Instagram, YouTube, Dev.to, and TikTok stay on direct-API because
Zernio cannot match their content shapes (subreddit+title, media, video,
articles).
