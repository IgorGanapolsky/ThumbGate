# Governance into Subway — Proof Report

**Generated:** 2026-03-04T19:43:00Z
**Phase:** 03-governance-into-subway
**ThumbGate baseline test count:** 91 node-runner tests (89 test:api + 2 test:proof) — no regression from Phase 1 baseline of 60

## Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|---------|
| GOV-01 | PASS | budget-guard.js operational; $0.25 spend tracked correctly (remainingUsd: 9.75); $0.20 spend rejected against $0.10 budget with "Budget exceeded: 0.20 > 0.10 USD/month" |
| GOV-02 | PASS | intent-router.js + mcp-policy.js loaded; planIntent('publish_dpo_training_data') returns status: checkpoint_required with human_approval checkpoint; LOW risk intent returns ready |
| GOV-03 | PASS | contextfs.js loads; constructContextPack is a function; 9 Jest tests cover Jaccard cache hit (>=0.7), TTL expiry, namespace isolation |
| GOV-04 | PASS | self-heal.js + self-healing-check.js loaded; DEFAULT_CHECKS = [budget_status, lint_check, format_check, test_ci] |
| GOV-05 | PASS | 43 Jest governance tests pass across 5 test files (0 failures); suites: budget-guard, contextfs, intent-router, self-heal, self-healing-check |
| GOV-06 | PASS | This report |

## Scripts Ported to Subway

All 6 governance scripts present at `/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/`:

```
budget-guard.js
contextfs.js
intent-router.js
mcp-policy.js
self-heal.js
self-healing-check.js
```

(Additional non-governance scripts also present in that directory from earlier Subway work.)

## Config Files Ported

`.claude/config/`:
```
mcp-allowlists.json
subagent-profiles.json
policy-bundles/
  constrained-v1.json
  default-v1.json
```

## Test Results: Subway Governance Tests

```
> subway-rn-demo@100.1.0 test:governance
> jest --config jest.governance.config.js --testPathPattern='budget-guard|contextfs|intent-router|self-heal' --no-coverage

PASS scripts/__tests__/self-heal.test.js
PASS scripts/__tests__/contextfs.test.js
PASS scripts/__tests__/budget-guard.test.js
PASS scripts/__tests__/intent-router.test.js
PASS scripts/__tests__/self-healing-check.test.js

Test Suites: 5 passed, 5 total
Tests:       43 passed, 43 total
Snapshots:   0 total
Time:        0.553 s, estimated 1 s
Ran all test suites matching /budget-guard|contextfs|intent-router|self-heal/i.
```

## Test Results: ThumbGate Baseline (Regression Check)

```
ℹ pass 89
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 386.596125

> thumbgate@0.5.0 test:proof
> node --test tests/prove-adapters.test.js tests/prove-automation.test.js

✔ adapter proof harness passes all checks (113.369917ms)
✔ automation proof harness passes all checks (392.108917ms)
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 473.734916
```

Total: 91 node-runner tests (89 test:api + 2 test:proof), 0 failures. No regression from Phase 1 baseline of 60.

## Smoke Test Evidence

### GOV-01: Budget Guard

**Spend tracking (addSpend $0.25, budget $10):**
```json
{
  "month": "2026-03",
  "totalUsd": 0.25,
  "budgetUsd": 10,
  "remainingUsd": 9.75
}
```

**Overspend rejection (addSpend $0.20, budget $0.10):**
```
EXPECTED ERROR: Budget exceeded: 0.20 > 0.10 USD/month
```

### GOV-02: Intent Router

**planIntent (publish_dpo_training_data, risk=high, approved=false):**
```json
{
  "bundleId": "default-v1",
  "mcpProfile": "default",
  "generatedAt": "2026-03-04T19:42:58.771Z",
  "status": "checkpoint_required",
  "intent": {
    "id": "publish_dpo_training_data",
    "description": "Export DPO preference pairs for model improvement pipelines.",
    "risk": "high"
  },
  "context": "",
  "requiresApproval": true,
  "approved": false,
  "checkpoint": {
    "type": "human_approval",
    "reason": "Intent 'publish_dpo_training_data' has risk 'high' under profile 'default'.",
    "requiredForRiskLevels": [
      "high",
      "critical"
    ]
  },
  "actions": [
    {
      "kind": "mcp_tool",
      "name": "export_dpo_pairs"
    }
  ]
}
```

### GOV-03: ContextFS

```
constructContextPack: function
```

### GOV-04: Self-Healing Check

```
checks: [ 'budget_status', 'lint_check', 'format_check', 'test_ci' ]
```

## Path Surgery Verification

All 6 scripts use `PROJECT_ROOT = path.join(__dirname, '..', '..', '..')` resolving to `Subway_RN_Demo/` (3 levels up from `.claude/scripts/feedback/`). Config files resolved from `path.join(PROJECT_ROOT, '.claude', 'config', ...)`.

## Notes

- Subway scripts are gitignored via `.git/info/exclude` — commits and proofs live in the ThumbGate repo
- Policy bundle tool names are ThumbGate-origin; update to Subway-specific tools in future cleanup
- Lock timeout increased to `timeoutMs: 30000`, `staleMs: 60000` for concurrent agent safety (4+ parallel callers)
- `jest.governance.config.js` required in Subway — main `jest-expo` config excludes `scripts/` from test runs
- `KNOWN_FIX_SCRIPTS` uses object array `{name, command}` in Subway `self-heal.js` — lookup via `command[2]` for correct npm script name matching
