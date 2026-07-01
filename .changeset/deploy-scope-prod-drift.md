---
"thumbgate": patch
---

Fix deploy-scope silently skipping deploys when production has drifted behind main. A push with no runtime-serving file changes now still triggers a catch-up deploy when the live `/health` build SHA is positively confirmed behind HEAD; unknown/unreachable preserves the historical skip (fail-safe). Prevents production freezing many commits behind main (root cause of the `/diagnostic` 404 — prod was sitting 86 commits behind).
