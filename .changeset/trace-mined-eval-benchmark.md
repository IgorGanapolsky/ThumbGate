---
"thumbgate": patch
---

Mine a regression benchmark from real production gate traces

`evals/` did not exist. Enforcement quality was not comparable between runs, so a behaviour
change could only be noticed by someone remembering what used to happen — which is how 62
evasion holes survived months of green CI.

Following the eval-engineering argument that production traces, not invented examples, are the
source of good evals:

- **`npm run eval:mine`** distills `audit-trail.jsonl` into
  `evals/gate-decisions.golden.jsonl` — 60 distinct real commands across 12 gates, redacted.
- **`npm run eval:baseline`** records the current engine's verdict for each.
- **`tests/gate-golden-set.test.js`** fails when a real command's verdict moves.

Two things this deliberately is NOT:

*Not mined from `gate-events-log.jsonl`.* That log records the verdict but drops `toolInput`,
so nothing in it can be replayed — mining it yielded 7 cases with empty commands, a benchmark
that passes trivially while looking like coverage. `audit-trail.jsonl` keeps
`sanitizeToolInput(toolInput)`, which is what makes a case runnable.

*Not asserted against production's own verdict.* The first version did, and immediately
reported 14 "regressions" that were nothing of the sort: almost every gate in this trace
window is state-conditional (`pr-thread-resolution` needs a prior commit, `memory-high-risk`
needs the learned corpus, `self-protect-kill` needs a running process), and the trace does not
record the state that produced the verdict. Isolated replay therefore cannot reproduce it. The
benchmark asserts DRIFT from a recorded baseline instead — which is the property that actually
went unwatched.

Guards: replayability check, ≥5 gates, ≥20 cases compared, and redaction asserted as a
correctness property (a dash-encoded home path `-Users-<name>` slipped past the slash-based
regex and was caught by a leak scan).

Proven to detect: flipping one recorded verdict fails the test with the exact command named.
