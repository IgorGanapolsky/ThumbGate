---
"thumbgate": patch
---

fix(health): report the actually-deployed commit in `/health` `buildSha`. On the Railway GitHub-connected service the baked `config/build-metadata.json` is the committed null placeholder and `RAILWAY_SYNC_VARIABLES` is off, so `THUMBGATE_BUILD_SHA` never updated and `/health` reported a months-old commit while newer code was live — which also made the deploy workflow's build-SHA verification gate fail on every run. `resolveBuildMetadata` now reads Railway's per-deploy `RAILWAY_GIT_COMMIT_SHA` (ground truth for GitHub-connected deploys) ahead of the drift-prone `THUMBGATE_BUILD_SHA`, while a properly baked file SHA still wins when present.
