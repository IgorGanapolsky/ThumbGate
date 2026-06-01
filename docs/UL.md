# Unsupervised Learning Signals in ThumbGate

ThumbGate's primary learning loop is human-in-the-loop: thumbs-up/down feedback
drives the auto-promotion of prevention gates in `auto-promote-gates.js`. Some
tool failures, however, never receive an explicit thumbs-down — the agent
silently recovers, the user moves on, the signal is lost. The unsupervised
learning surface below mines those silent failures so they can re-enter the
existing gate-promotion pipeline.

## Silent-failure clustering (default-on as of 2026-05-21)

**Status**: ON by default. The opt-in flag from PR #2285 was flipped to
opt-out in PR #2289 — the whole point of the feature is to help users who
don't manually thumbs-down, so leaving it opt-in defeated the purpose.

**Opt out**: set `THUMBGATE_SILENT_FAILURE_CLUSTERING=0` (also accepts
`false`, `off`, `no`) or run with `NODE_ENV=test`. Back-compat: anyone
who had `=1` set before the flip stays enabled — no-op for them.

**Module**: `scripts/silent-failure-cluster.js`

When the flag is set, `meta-agent-loop.js` calls
`generateSilentFailureCandidates()` alongside its existing candidate generator.
The module:

1. Discovers conversation logs the same way `self-distill-agent.js` does
   (`~/.claude/projects/*/conversation-log.jsonl` plus the feedback-dir
   fallback).
2. Extracts tool-call / tool-result pairs and keeps only those whose result has
   `exit_code != 0`, `is_error: true`, or output matching the same
   `ERROR_PATTERNS` regex set used by `self-distill-agent.js`.
3. Drops any failure within ±5 minutes of an entry in `feedback-log.jsonl` —
   those are already covered by the HITL loop and would double-count.
4. Normalizes args (`/Users/<name>/…` → `<HOME>/…`, `/tmp/<random>/…` →
   `/tmp/<X>/…`) and redacts secrets per the canonical regex set in
   `~/.claude/hooks/daily-log-append.sh` (GitHub tokens, Stripe keys, JWTs,
   Slack webhooks, AWS keys, npm tokens, Anthropic keys).
5. Clusters failures by exact tuple `(tool, normalized-arg-signature)` with a
   minimum cluster size of 3, then emits each cluster as a candidate rule
   tagged `origin: 'silent-failure-cluster'`.

Emitted candidates flow through the same hit-rate / false-positive-rate
scoring as LLM-generated candidates in `meta-agent-loop.js`. Nothing about
the existing scoring or promotion thresholds changes when the flag is unset.

**Caveat — ≥ 50 calls/day**: silent-failure clustering is only worthwhile on
workspaces generating at least ~50 tool calls per day. Below that threshold
the module surfaces `skippedReason: 'insufficient-data'` and emits zero
candidates rather than producing noise from a thin dataset. Solo workspaces
that run only a handful of agent sessions per day will not benefit; very
active workspaces (CI, multi-developer teams, long-running agents) are the
intended target.

**Known limitations** (locked in for v1):
- Cluster size ≠ severity. The exit_code / regex filter is the only signal
  distinguishing a "failure cluster" from a "frequently used command" cluster.
  Tightening the filter is the right knob if false-positives appear.
- No drift detection. If your tool inventory changes (new MCP server, new
  framework), clusters built from the old inventory will pollute results
  until they age out of the log window.

**Telemetry**: each meta-agent run manifest now includes
`silentFailureDerivedGates` (count of promoted gates whose `origin ===
'silent-failure-cluster'`) so precision can be measured against the
user-feedback-derived baseline over time.
