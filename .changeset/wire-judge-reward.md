---
"thumbgate": patch
---

Give captured feedback a graded quality score.

`judge-reward-function.js` was 408 lines with zero non-test callers: `buildCompositeReward` ran only from its own test file, and nothing injected a judge function, so it could never produce a number in production. Well-built, fully tested, wired to nothing.

`scoreFeedbackReward()` in `feedback-quality.js` now adapts a captured feedback entry into the reward sample shape and returns a graded score. `assessFeedbackActionability` already answered the binary question — is this promotable at all. This answers the graded one: how good is the correction the operator actually wrote.

Verified discrimination:

| feedback | score | verdict |
|---|---|---|
| `be better next time` | 0.76 | fails required rubric |
| `run npm test and verify the sha before claiming green, see commit abc123` | 1.0 | passes |
| `deployed the fix` | 0.364 | `deterministic_block` |

The third case is the rubric's safety dimension refusing a completion claim with no verification attached — the same contract CLAUDE.md enforces on the agent, now applied to captured lessons.

Deterministic by construction: no judge function is injected, so scoring is `deterministic_only` with no network call and no `ANTHROPIC_API_KEY` dependency. That is deliberate — six runtime scripts already gate on that key, and a scorer that silently degrades to nothing when it is absent is worse than one that never claimed the LLM path.

Reporting only. Nothing here gates promotion; wiring a new quality signal into enforcement would change which lessons become blocking rules, and that belongs in its own change with its own evidence.
