---
phase: 03-governance-into-subway
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/budget-guard.js
  - /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/contextfs.js
  - /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/__tests__/budget-guard.test.js
  - /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/__tests__/contextfs.test.js
autonomous: true
requirements: [GOV-01, GOV-03, GOV-05]

must_haves:
  truths:
    - "Calling addSpend() with $10.01 total spend in Subway throws 'Budget exceeded' and leaves ledger intact"
    - "Calling addSpend() with $0.25 returns status with remainingUsd=0.75 (when budget=$1 in test)"
    - "constructContextPack() stores and retrieves context across 5 namespaces"
    - "A second lookup with Jaccard-similar query (>=0.7 similarity) returns cache hit without re-computation"
    - "budget-guard.test.js runs via Jest (jest-expo) and all tests pass"
    - "contextfs.test.js runs via Jest (jest-expo) and all tests pass"
    - "ThumbGate baseline test count of 60 node-runner tests is not regressed (Subway tests run in Subway only)"
  artifacts:
    - path: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/budget-guard.js"
      provides: "Atomic file-lock ledger enforcing $10/month cap"
      contains: "acquireLock"
    - path: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/contextfs.js"
      provides: "Namespaced FS context store with Jaccard semantic cache (threshold=0.7, TTL=86400s)"
      contains: "constructContextPack"
    - path: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/__tests__/budget-guard.test.js"
      provides: "Jest test suite for GOV-01 budget guard"
      exports: ["budget_status test", "blocks overspend test", "concurrency stress test"]
    - path: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/__tests__/contextfs.test.js"
      provides: "Jest test suite for GOV-03 contextfs"
      exports: ["store and retrieve test", "Jaccard cache hit test", "TTL expiry test"]
  key_links:
    - from: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/budget-guard.js"
      to: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/memory/feedback/budget-ledger.json"
      via: "loadLedger() using THUMBGATE_FEEDBACK_DIR env var"
      pattern: "THUMBGATE_FEEDBACK_DIR.*budget-ledger"
    - from: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/__tests__/budget-guard.test.js"
      to: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/budget-guard.js"
      via: "jest.resetModules() then require() inside beforeEach"
      pattern: "jest\\.resetModules"
    - from: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/contextfs.js"
      to: "/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/memory/feedback/contextfs/"
      via: "PROJECT_ROOT = path.join(__dirname, '..', '..', '..')"
      pattern: "path\\.join\\(__dirname.*\\.\\."
---

<objective>
Port budget-guard.js and contextfs.js from thumbgate into Subway_RN_Demo, with path-variable surgery, lock timeout adjustment, and Jest test suites.

Purpose: GOV-01 and GOV-03 are zero-dependency scripts — they port independently and can run in parallel with Plan 02 (intent-router). Completing these first unblocks the self-healing check in Plan 03 which needs the budget-guard script available.

Output:
- .claude/scripts/feedback/budget-guard.js (Subway copy, path-surgery applied)
- .claude/scripts/feedback/contextfs.js (Subway copy, path-surgery applied)
- scripts/__tests__/budget-guard.test.js (Jest, GOV-05)
- scripts/__tests__/contextfs.test.js (Jest, GOV-05)
</objective>

<execution_context>
@/Users/ganapolsky_i/.claude/get-shit-done/workflows/execute-plan.md
@/Users/ganapolsky_i/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@docs/planning/PROJECT.md
@docs/planning/ROADMAP.md
@docs/planning/STATE.md
@docs/planning/phases/03-governance-into-subway/3-RESEARCH.md

Source files to read before porting:
@/Users/ganapolsky_i/workspace/git/igor/ThumbGate/scripts/budget-guard.js
@/Users/ganapolsky_i/workspace/git/igor/ThumbGate/scripts/contextfs.js
@/Users/ganapolsky_i/workspace/git/igor/ThumbGate/tests/budget-guard.test.js

Subway test pattern reference (confirm Jest syntax in use):
@/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/__tests__/feedback-loop.test.js
</context>

<tasks>

<task type="auto">
  <name>Task 1: Port budget-guard.js to Subway with path surgery and lock timeout adjustment</name>
  <files>
    /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/budget-guard.js
  </files>
  <action>
    Read the full source of /Users/ganapolsky_i/workspace/git/igor/ThumbGate/scripts/budget-guard.js.

    Create /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/budget-guard.js by applying these changes to the ThumbGate source:

    1. PATH SURGERY (critical — do not skip):
       Change the PROJECT_ROOT line from:
         const PROJECT_ROOT = path.join(__dirname, '..');
       To:
         const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');
       Reason: scripts live at .claude/scripts/feedback/ which is 3 levels below Subway repo root,
       not 1 level as in ThumbGate. Without this change, FEEDBACK_DIR will point to
       .claude/scripts/memory/feedback instead of .claude/memory/feedback.

    2. LOCK TIMEOUT ADJUSTMENT:
       Find acquireLock() calls with timeoutMs=5000, staleMs=15000 and change to:
         timeoutMs: 30000, staleMs: 60000
       Reason: Subway parallel GSD agents can spawn 4+ concurrent API callers.
       The default 5s timeout fails under load.

    3. VERIFY FEEDBACK_DIR path:
       After path surgery, confirm that:
         path.join(PROJECT_ROOT, '.claude', 'memory', 'feedback')
       resolves to the correct Subway memory path. Add a comment:
         // Subway: PROJECT_ROOT = Subway_RN_Demo/ (3 levels up from .claude/scripts/feedback/)

    4. No other logic changes. The file-lock mechanism, addSpend(), getBudgetStatus(),
       getMonthlyBudget(), and module.exports are copied verbatim.

    5. Create the target directory if it does not exist:
       mkdir -p /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/

    Verify the port by running:
      node -e "
        const path = require('path');
        const d = '/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/budget-guard.js';
        const bg = require(d);
        console.log('exports:', Object.keys(bg));
      "
    Expected output: exports: ['addSpend', 'getBudgetStatus', 'getMonthlyBudget'] (or similar — must include addSpend and getBudgetStatus).
  </action>
  <verify>
    node -e "const bg = require('/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/budget-guard.js'); console.log(typeof bg.addSpend, typeof bg.getBudgetStatus);"
    Expected: "function function"

    grep "path.join(__dirname.*\.\." /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/budget-guard.js | head -3
    Expected: line containing path.join(__dirname, '..', '..', '..')

    grep "timeoutMs" /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/budget-guard.js
    Expected: timeoutMs: 30000 (not 5000)
  </verify>
  <done>
    budget-guard.js exists in Subway at .claude/scripts/feedback/ with:
    - PROJECT_ROOT resolves 3 levels up (not 1)
    - Lock timeout is 30000/60000
    - addSpend and getBudgetStatus exported as functions
    - Node require succeeds with no errors
  </done>
</task>

<task type="auto">
  <name>Task 2: Port contextfs.js to Subway with path surgery and write Jest test suites for both scripts</name>
  <files>
    /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/contextfs.js
    /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/__tests__/budget-guard.test.js
    /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/__tests__/contextfs.test.js
  </files>
  <action>
    PART A — Port contextfs.js:

    Read the full source of /Users/ganapolsky_i/workspace/git/igor/ThumbGate/scripts/contextfs.js.

    Create /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/contextfs.js by applying:

    1. PATH SURGERY (same as budget-guard):
       Change PROJECT_ROOT from path.join(__dirname, '..') to path.join(__dirname, '..', '..', '..')
       Add comment: // Subway: PROJECT_ROOT = Subway_RN_Demo/ (3 levels up from .claude/scripts/feedback/)

    2. The contextfs runtime directories (raw_history, memory/error, memory/learning, rules, tools, provenance)
       are created at runtime by the script itself when first called. Do NOT pre-create them.

    3. No other logic changes. Jaccard threshold=0.7 (THUMBGATE_SEMANTIC_CACHE_THRESHOLD),
       TTL=86400 (THUMBGATE_SEMANTIC_CACHE_TTL_SECONDS), and all exports are copied verbatim.

    Verify:
      node -e "const c = require('/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/contextfs.js'); console.log(typeof c.constructContextPack);"
    Expected: "function"

    PART B — Write Jest test suite for budget-guard (GOV-05):

    Create /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/__tests__/budget-guard.test.js

    Use Jest syntax (not node:test). Reference the ThumbGate source test at:
    /Users/ganapolsky_i/workspace/git/igor/ThumbGate/tests/budget-guard.test.js for coverage ideas.

    CRITICAL patterns (from research — must follow exactly):
    - Set env vars BEFORE jest.resetModules() and require()
    - Call jest.resetModules() in beforeEach so each test gets a fresh module with the correct tmpDir
    - Delete env vars and rmSync tmpDir in afterEach

    Test file structure:
    ```javascript
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    let tmpDir;
    let budgetGuard;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subway-budget-test-'));
      process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
      process.env.THUMBGATE_MONTHLY_BUDGET_USD = '1';
      jest.resetModules();
      budgetGuard = require('../../.claude/scripts/feedback/budget-guard');
    });

    afterEach(() => {
      delete process.env.THUMBGATE_FEEDBACK_DIR;
      delete process.env.THUMBGATE_MONTHLY_BUDGET_USD;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
    ```

    Required test cases (minimum — match the ThumbGate test coverage):
    1. "adds spend and reports correct status" — addSpend({amountUsd:0.25, source:'test', note:'unit'}); expect getBudgetStatus().remainingUsd to be 0.75
    2. "blocks overspend" — addSpend($0.9), then addSpend($0.9) should throw /Budget exceeded/
    3. "initializes ledger on first call" — getBudgetStatus() without prior addSpend() should succeed and return remainingUsd=1
    4. "concurrency stress: 3 parallel addSpend calls all succeed" — use Promise.all with 3 concurrent addSpend({amountUsd:0.1}) calls, then getBudgetStatus().totalUsd should be 0.3 (lock timeout=30000 must handle this)

    PART C — Write Jest test suite for contextfs (GOV-05):

    Create /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/__tests__/contextfs.test.js

    CRITICAL: contextfs.js reads THUMBGATE_FEEDBACK_DIR at module load to determine its storage paths.
    Use jest.resetModules() in beforeEach with isolated tmpDir, same pattern as budget-guard tests.

    Required test cases (minimum):
    1. "stores and retrieves context entry" — call storeContext or equivalent export with {namespace:'rules', content:'test rule', query:'test'}, then constructContextPack({query:'test', namespaces:['rules']}) returns item with that content
    2. "returns cache hit for Jaccard-similar query (>=0.7)" — store entry with query 'ESLint import fix failed'; second call with query 'ESLint import order fix' (high token overlap) should return cache.hit=true
    3. "respects TTL by returning stale=true for expired entries" — set THUMBGATE_SEMANTIC_CACHE_TTL_SECONDS='1' (1 second), store entry, wait 1100ms (jest.useFakeTimers or real await), second lookup returns cache.hit=false OR expired entry not included

    Note: Read contextfs.js exports carefully before writing tests — use the actual exported function names from the source, not assumed names.
  </action>
  <verify>
    # Verify contextfs.js port
    node -e "const c = require('/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/contextfs.js'); console.log(typeof c.constructContextPack);"
    Expected: "function"

    grep "path.join(__dirname.*\.\." /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/contextfs.js | head -1
    Expected: path.join(__dirname, '..', '..', '..')

    # Verify test files exist and have describe/test/beforeEach structure
    grep -l "beforeEach\|afterEach" /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/__tests__/budget-guard.test.js /Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/__tests__/contextfs.test.js
    Expected: both files listed

    # Run governance tests in Subway (from Subway_RN_Demo directory)
    cd /Users/ganapolsky_i/workspace/git/Subway_RN_Demo && npx jest scripts/__tests__/budget-guard.test.js scripts/__tests__/contextfs.test.js --no-coverage 2>&1 | tail -20
    Expected: Tests: N passed, 0 failed (no failures)

    # Confirm ThumbGate baseline not regressed (run from ThumbGate directory)
    cd /Users/ganapolsky_i/workspace/git/igor/ThumbGate && npm test 2>&1 | tail -5
    Expected: exits 0, 60 node-runner tests passing
  </verify>
  <done>
    - contextfs.js in Subway with correct PROJECT_ROOT depth (3 levels up)
    - budget-guard.test.js: minimum 4 Jest tests all passing (including concurrency stress)
    - contextfs.test.js: minimum 3 Jest tests all passing (store, Jaccard cache, TTL)
    - npx jest on both test files exits 0 with no failures
    - ThumbGate npm test still exits 0 with 60 node-runner tests
  </done>
</task>

</tasks>

<verification>
From Subway_RN_Demo root:
  npx jest scripts/__tests__/budget-guard.test.js scripts/__tests__/contextfs.test.js --no-coverage --verbose
  Expected: all tests pass, 0 failures

Budget guard smoke test with real ledger:
  THUMBGATE_FEEDBACK_DIR=/tmp/subway-gov-smoke node -e "
    const { addSpend, getBudgetStatus } = require('/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/budget-guard');
    addSpend({ amountUsd: 0.25, source: 'smoke-test', note: 'plan 01 verify' });
    const s = getBudgetStatus();
    console.log('status:', JSON.stringify(s));
  "
  Expected: JSON with month, totalUsd, budgetUsd fields — no errors

ContextFS smoke test:
  THUMBGATE_FEEDBACK_DIR=/tmp/subway-ctx-smoke node -e "
    const { constructContextPack } = require('/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.claude/scripts/feedback/contextfs');
    console.log(typeof constructContextPack);
  "
  Expected: "function"

ThumbGate regression check:
  cd /Users/ganapolsky_i/workspace/git/igor/ThumbGate && npm test 2>&1 | grep -E "pass|fail|tests"
  Expected: 60 passing, 0 failing
</verification>

<success_criteria>
1. budget-guard.js loads in Subway without error; addSpend() and getBudgetStatus() are callable
2. contextfs.js loads in Subway without error; constructContextPack() is callable
3. All Jest tests in budget-guard.test.js pass (minimum 4 cases including concurrency stress)
4. All Jest tests in contextfs.test.js pass (minimum 3 cases including Jaccard cache and TTL)
5. PROJECT_ROOT in both scripts resolves path.join(__dirname, '..', '..', '..') — 3 levels
6. Lock timeout in budget-guard.js is timeoutMs:30000, staleMs:60000
7. ThumbGate npm test exits 0 with 60 node-runner tests (no regression)
</success_criteria>

<output>
After completion, create /Users/ganapolsky_i/workspace/git/igor/ThumbGate/docs/planning/phases/03-governance-into-subway/3-01-SUMMARY.md
</output>
