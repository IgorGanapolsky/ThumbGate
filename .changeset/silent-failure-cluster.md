---
"thumbgate": patch
---

feat(ul): silent-failure clustering as a candidate source for meta-agent-loop (experimental, off by default)

New module `scripts/silent-failure-cluster.js` mines failed tool calls (exit_code != 0 or matching the existing `ERROR_PATTERNS`) from the JSONL conversation logs, excludes any failure within ±5 min of a feedback-log entry (already in the HITL loop), normalizes paths and redacts secrets in args, then clusters by `(tool, normalized-arg-signature)` with a min cluster size of 3. Each cluster is emitted as a candidate prevention rule tagged `origin: 'silent-failure-cluster'` and flows through the EXISTING `meta-agent-loop.js` hit-rate / fp-rate scoring — no guardrail is bypassed.

**Experimental — off by default.** Enable with `THUMBGATE_SILENT_FAILURE_CLUSTERING=1`. Pre-existing behavior is unchanged when the flag is unset. Only useful on workspaces generating ≥ 50 tool calls/day; below that threshold the module skips cleanly with `skippedReason: 'insufficient-data'`. No new npm dependencies.
