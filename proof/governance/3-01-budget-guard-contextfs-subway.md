# Proof: GOV-01 / GOV-03 — budget-guard.js + contextfs.js in Subway

**Plan:** 03-governance-into-subway / 3-01
**Date:** 2026-03-04
**Requirements:** GOV-01, GOV-03, GOV-05

---

## Verification Evidence

### 1. budget-guard.js — exports check

```
node -e "const bg = require('/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/budget-guard.js'); console.log(typeof bg.addSpend, typeof bg.getBudgetStatus);"
# Output: function function
```

### 2. contextfs.js — exports check

```
node -e "const c = require('/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/contextfs.js'); console.log(typeof c.constructContextPack);"
# Output: function
```

### 3. Path surgery verified

```
grep "path.join(__dirname" .claude/scripts/feedback/budget-guard.js
# Output: const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');

grep "timeoutMs" .claude/scripts/feedback/budget-guard.js
# Output: function acquireLock({ timeoutMs = 30000, staleMs = 60000 } = {}) {
```

### 4. Jest tests — all pass

```
cd /Users/ganapolsky_i/workspace/git/Subway_RN_Demo
npx jest --config jest.scripts.config.js scripts/__tests__/budget-guard.test.js scripts/__tests__/contextfs.test.js --no-coverage --verbose

PASS scripts/__tests__/contextfs.test.js
  contextfs
    ✓ stores and retrieves context entry via constructContextPack (6 ms)
    ✓ returns cache hit for Jaccard-similar query (>=0.7) (4 ms)
    ✓ respects TTL by skipping expired cache entries (6 ms)
  normalizeNamespaces
    ✓ returns default namespaces for empty input (2 ms)
    ✓ accepts all valid namespace aliases (1 ms)
    ✓ throws INVALID_NAMESPACE for unknown namespace (3 ms)
  querySimilarity
    ✓ returns 1.0 for identical token sets (1 ms)
    ✓ returns 0 for completely different token sets
    ✓ returns > 0.7 for high-overlap token sets (1 ms)

PASS scripts/__tests__/budget-guard.test.js
  budget-guard
    ✓ adds spend and reports correct status (2 ms)
    ✓ blocks overspend (2 ms)
    ✓ initializes ledger on first call
    ✓ concurrency stress: 3 parallel addSpend calls all succeed (2 ms)
  parseMonthlyBudget
    ✓ rejects invalid budget value (1 ms)
    ✓ rejects zero budget
    ✓ rejects negative budget (1 ms)
    ✓ accepts valid budget

Test Suites: 2 passed, 2 total
Tests:       17 passed, 17 total
```

### 5. Budget guard smoke test

```
THUMBGATE_FEEDBACK_DIR=/tmp/subway-gov-smoke node -e "
  const { addSpend, getBudgetStatus } = require('.claude/scripts/feedback/budget-guard');
  addSpend({ amountUsd: 0.25, source: 'smoke-test', note: 'plan 01 verify' });
  const s = getBudgetStatus();
  console.log('status:', JSON.stringify(s));
"
# Output: status: {"month":"2026-03","totalUsd":0.5,"budgetUsd":10,"remainingUsd":9.5}
```

### 6. ThumbGate baseline — not regressed

```
cd /Users/ganapolsky_i/workspace/git/igor/thumbgate
npm run test:api  → 89 pass, 0 fail
npm test          → 2 proof tests pass, 0 fail
Total: 91 tests (baseline was 60 when Phase 3 started; grew due to Phase 2 ML plans)
```

---

## Files Verified

| File | Status | Notes |
|------|--------|-------|
| `.claude/scripts/feedback/budget-guard.js` | PASS | PROJECT_ROOT 3 levels up, timeoutMs=30000 |
| `.claude/scripts/feedback/contextfs.js` | PASS | PROJECT_ROOT 3 levels up, threshold=0.7 |
| `scripts/__tests__/budget-guard.test.js` | PASS | 8 tests (4 core + 4 parsing) |
| `scripts/__tests__/contextfs.test.js` | PASS | 9 tests (3 core + 3 namespace + 3 Jaccard) |
