---
"thumbgate": patch
---

Fix ThumbGate statusline, dashboard, feedback stats, and local chat reads to aggregate known feedback stores instead of showing only the current folder's slice. The statusline now prefers a global aggregate cache, dedupes feedback by id across active, parent, and global project stores, and keeps a local-only opt-out with `THUMBGATE_STATUSLINE_AGGREGATE=0`.
