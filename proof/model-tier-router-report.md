# GPT-5.4 Tier Router — Proof Artifact

## Feature Description

The Model Tier Router automatically routes tasks to the appropriate GPT-5.4 model tier (nano/mini/frontier) based on task characteristics including type, context size, risk level, retry count, and tags. Includes frontier budget control to prevent runaway costs.

## Routing Decision Matrix

| Condition | Tier | Escalated |
|---|---|---|
| classification, extraction, ranking, labeling, summarization | nano | No |
| code-edit, test-generation, review, tool-use, debugging | mini | No |
| architecture, cross-file, complex-debugging, large-context | frontier | No |
| contextTokens > 200,000 | frontier | Yes |
| riskLevel=high + retryCount ≥ 2 | frontier | Yes |
| tags include architecture/cross-file/multi-module/system-design | frontier | Yes |
| Two consecutive mini failures (history) | frontier | Yes (via shouldEscalate) |
| Unknown task type | mini | No |

## Budget Control Behavior

| Operation | Behavior |
|---|---|
| `canSpend(tokens, reason)` | Returns `{ allowed, remaining, reason }` — checks cap without deducting |
| `spend(tokens, reason)` | Deducts from budget, logs invocation with timestamp, returns receipt |
| `status()` | Returns `{ spent, remaining, cap, invocations }` |
| `reset()` | Clears spent and invocation log for new session |
| Default cap | 500,000 tokens per session |
| Reason required | Yes (configurable via `requireReason`) |

## Test Evidence

```
TAP version 13
ok 1 - classifyTask routes classification → nano
ok 2 - classifyTask routes extraction → nano
ok 3 - classifyTask routes labeling → nano
ok 4 - classifyTask routes summarization → nano
ok 5 - classifyTask routes ranking → nano
ok 6 - classifyTask routes code-edit → mini
ok 7 - classifyTask routes test-generation → mini
ok 8 - classifyTask routes review → mini
ok 9 - classifyTask routes architecture → frontier
ok 10 - classifyTask routes cross-file → frontier
ok 11 - classifyTask escalates to frontier when context > 200k
ok 12 - classifyTask escalates high risk + 2 retries to frontier
ok 13 - classifyTask escalates architecture tag to frontier
ok 14 - classifyTask does NOT escalate high risk with only 1 retry
ok 15 - classifyTask defaults unknown type to mini
ok 16 - FrontierBudget.canSpend returns true when under cap
ok 17 - FrontierBudget.canSpend returns false when over cap
ok 18 - FrontierBudget.canSpend rejects missing reason when requireReason=true
ok 19 - FrontierBudget.spend deducts correctly and logs reason
ok 20 - FrontierBudget.spend refuses when over budget
ok 21 - FrontierBudget.spend tracks multiple invocations
ok 22 - FrontierBudget.status returns correct remaining
ok 23 - FrontierBudget.reset clears spent
ok 24 - shouldEscalate returns escalation for two consecutive mini failures
ok 25 - shouldEscalate returns no escalation for single failure
ok 26 - shouldEscalate returns no escalation when last attempt succeeded
ok 27 - shouldEscalate detects context-based escalation
ok 28 - TIERS constants match config/model-tiers.json
ok 29 - config version is 1
ok 30 - config escalation threshold matches TIERS.mini.maxContext
# tests 30 | pass 30 | fail 0
```

## Integration Points with partner-routing.json

The tier router complements the existing partner routing system:

- **partner-routing.json** routes based on *who* the partner is (balanced, strict_reviewer, fast_executor, etc.) and adjusts token budgets via `tokenBudgetMultiplier`
- **model-tier-router** routes based on *what* the task is (complexity, context size, risk) and selects the appropriate model tier
- Combined: partner profile's `tokenBudgetMultiplier.total` can scale the `FrontierBudget.tokenCap` for per-partner frontier limits
- The `profile-router.js` privacy routing (`routePrivacy`) determines local vs frontier; the tier router then selects *which* frontier tier

## Files

| File | Purpose |
|---|---|
| `scripts/model-tier-router.js` | Core routing logic + FrontierBudget class |
| `config/model-tiers.json` | Tier definitions, task type mappings, escalation rules |
| `tests/model-tier-router.test.js` | 30 tests covering all routing paths |
| `proof/model-tier-router-report.md` | This report |
