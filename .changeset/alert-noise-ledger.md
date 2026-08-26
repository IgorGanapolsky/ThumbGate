---
"thumbgate": patch
---

feat(gates): add alert-noise ledger for reminder suppression and correlation

Adds `src/alert-noise-ledger.js`, a presentational suppression layer for the
PreToolUse reminder surface. Not yet wired into `gates-engine.js` — this lands
the engine and its tests first so the behaviour can be reviewed independently of
the call-site change.

Measured from live `gate_stats` and `prevention_rules` on 2026-08-25:

- 706 gate events (87 blocked + 619 warned); 278 first firings vs 428 repeats,
  so **60.6% of all gate events are repeats of a signature already surfaced**.
- `retrieval_entropy_high`: 558 events, **0 blocks in its entire history** — 79%
  of gate traffic from a gate that has never once blocked anything.
- `force-push`: 1 first block, 26 repeats (96% repeat rate).
- Root-cause telemetry: `guardrail_triggered` is the **#1 failure category (90)**,
  ahead of `tool_output_misread` (28).
- `security:generic_assignment` alone accounts for 229 failures.
- Two "High-Priority Contracts" carry placeholder text ("Investigate and prevent
  recurrence") and instruct nothing.

Simulated over 120 tool calls with the real reminder text, reduction lands
between 48% (implausibly churny corpus, 50% novel bullets per call) and 99.8%
(stable corpus); ~89% at a realistic 10% novelty.

Suppression is **presentational only** and never changes a decision. Two
invariants are enforced and tested: the first occurrence of any signature always
renders in full, and a `block` is never fully suppressed — it collapses to a
one-liner at most, because an agent must always be told its action did not
happen. The ledger fails **open** on any internal error.

27 tests in `tests/alert-noise-ledger.test.js`, including a replay of the
measured 706-event distribution. The test target is intentionally not registered
in `package.json` yet: another agent holds that file this session.
