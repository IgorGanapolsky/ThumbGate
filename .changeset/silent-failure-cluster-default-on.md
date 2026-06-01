---
"thumbgate": minor
---

feat(ul): silent-failure clustering is now ON by default (was opt-in)

The silent-failure clustering candidate source shipped behind
`THUMBGATE_SILENT_FAILURE_CLUSTERING=1` in PR #2285. The whole point of
that work was to cover the case where users don't manually give
thumbs-down on failed tool calls — but leaving it opt-in meant the
users who needed it most (the ones who never set environment variables)
never got the benefit.

Flipped to default-ON. Opt out via:
- `THUMBGATE_SILENT_FAILURE_CLUSTERING=0` (or `false` / `off` / `no`)
- `NODE_ENV=test` (auto-opted-out so test runs stay deterministic)

Back-compat: users who already set `THUMBGATE_SILENT_FAILURE_CLUSTERING=1`
remain enabled (no-op for them).

Bounded-risk rationale: silent-failure candidates flow through the
existing `meta-agent-loop.js` fp-rate eval — they cannot auto-promote
to real gates without passing the same precision/recall thresholds as
LLM-generated candidates. Turning the candidate funnel on by default
expands what the eval considers; it does not bypass any guardrail.

6 new tests in `tests/silent-failure-cluster.test.js` cover default-on,
explicit opt-out, explicit opt-in back-compat, and NODE_ENV=test
precedence. All 37 tests pass locally.
