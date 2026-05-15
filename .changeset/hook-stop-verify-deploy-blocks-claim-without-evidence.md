---
"thumbgate": patch
---

`scripts/hook-stop-verify-deploy.sh` now hard-blocks the agent's turn when the response contains a deploy claim ("deployed", "shipped", "live in production", "in prod", "production-ready", etc.) without evidence in the same message — a curl to the production host, a `buildSha` string, a `/health` JSON-style version field, an HTTP 200 from the production host, or the verify-deploy-comment workflow's "Deploy verified" sentinel. Previously the hook only printed a warning, which was repeatedly ignored. The block contract matches `hook-stop-pr-thread-check.sh`: a JSON `decision: block` is emitted on stdout. Adds `tests/hook-stop-verify-deploy.test.js` (14 cases) to pin the regex + evidence patterns.
