# Production P0 — request envelope, budgets, degraded retrieval

**2026-07-31.** Closes the highest-ROI production weak points without adopting heavy frameworks.

## Request envelope (`scripts/request-envelope.js`)

Every `answerDataQuestion` return includes `envelope`:

| Field | Meaning |
|-------|---------|
| `traceId` | Correlate logs |
| `latencyMs` | End-to-end |
| `model` / `tier` / `provider` | Routing outcome |
| `inputTokens` / `outputTokens` / `estimatedCostCents` | Cost estimate |
| `retrieval.top[]` | Ids + scores (no bodies) |
| `qualityTier` | production \| degraded \| unavailable |
| `structured.ok` / `grounded` | Structured output status |
| `budget` | Hard budget decision |

## Hard budgets (`scripts/tier-budget-guard.js`)

- Per-request cost cap (default 25¢, env `THUMBGATE_MAX_COST_CENTS_PER_REQUEST`)
- Frontier daily cap (default 50, env `THUMBGATE_MAX_FRONTIER_PER_DAY`)
- Session `FrontierBudget` integration
- Actions: `allow` | `degrade` | `deny`

## Retrieval quality tier (`scripts/retrieval-quality-tier.js`)

- Feature-hash / stub embedders → `degraded`, `semanticClaimsAllowed: false`
- Stale index age → `index_stale` (default 7d, env `THUMBGATE_MAX_INDEX_AGE_MS`)

## Commands

```bash
node --test tests/request-envelope.test.js
```
