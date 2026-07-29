---
thumbgate: patch
---

Bench runs no longer write feedback into the operator's production store: `scripts/thumbgate-bench.js` now defaults all feedback capture (including `--use-runtime-state` runs and agent-session project-scoped environments) to an isolated temp directory, with `--feedback-dir` / `THUMBGATE_BENCH_FEEDBACK_DIR` as the explicit opt-out. `npm run self-heal:check` gains an `embedding_index_drift` check that reports UNHEALTHY when `feedback-log.jsonl` is more than 24h newer than `lesson-embeddings.json` (or the index is missing while lessons exist), naming both paths, the lag in hours, and the remediation `run: node scripts/backfill-lesson-embeddings.js`.
