# Phase 3: Governance into Subway - Research

**Researched:** 2026-03-04
**Domain:** Node.js governance scripts — file-system port from rlhf-feedback-loop to Subway_RN_Demo
**Confidence:** HIGH

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| GOV-01 | Budget guard enforces $10/month cap with atomic ledger in Subway | budget-guard.js is zero-dependency; ports verbatim with RLHF_FEEDBACK_DIR → Subway path; ledger at `.claude/memory/feedback/budget-ledger.json` |
| GOV-02 | Intent router with policy bundles provides risk-stratified action planning in Subway | intent-router.js requires mcp-policy.js; full dependency set confirmed; policy bundles + allowlists + subagent-profiles all port as JSON config files |
| GOV-03 | ContextFS with semantic cache (Jaccard, threshold=0.7, TTL=86400s) operates in Subway | contextfs.js is zero-dependency; Jaccard and TTL confirmed in source; env vars RLHF_SEMANTIC_CACHE_THRESHOLD and RLHF_SEMANTIC_CACHE_TTL_SECONDS configurable |
| GOV-04 | Self-healing monitor detects CI failures and runs fix scripts in Subway | self-heal.js + self-healing-check.js confirmed; KNOWN_FIX_SCRIPTS must be redefined for Subway's package.json; lint:fix (not lint:check) and format are available; Subway ESLint confirmed NO auto-import-sort |
| GOV-05 | All governance features have unit tests proving correct behavior | rlhf has 298 lines across 5 test files (node:test runner); Subway uses Jest (jest-expo preset); port tests to Jest/describe syntax; use scripts/__tests__/ directory pattern confirmed in Subway |
| GOV-06 | Proof report generated in proof/ directory for governance features | proof/ pattern confirmed: automation/report.md + automation/report.json; generate at end of phase in rlhf repo (commits happen in rlhf only) |
</phase_requirements>

---

## Summary

Phase 3 ports four governance scripts from rlhf-feedback-loop into Subway_RN_Demo: budget-guard.js, intent-router.js (+ mcp-policy.js + config files), contextfs.js, and self-heal.js / self-healing-check.js. Every script is zero-dependency CommonJS. No npm packages are installed. All five scripts use only Node.js built-ins (`fs`, `path`, `child_process`). The port is path-variable surgery plus config adaptation — not a rewrite.

The most complex part of this phase is not the code; it is the test infrastructure gap. rlhf's tests use `node:test` runner. Subway's `scripts/__tests__/` directory uses Jest (confirmed by `autonomy-cli.test.js`, `feedback-loop.test.js`). The ported tests must be rewritten from `node:test` syntax into Jest syntax. This is mechanical but must not be skipped — GOV-05 requires tests proving behavior.

The second concrete risk is the self-healing check configuration. `self-healing-check.js` hardcodes rlhf-specific npm scripts as its `DEFAULT_CHECKS` (`budget:status`, `tests`, `prove:adapters`, `prove:automation`). These do not exist in Subway's `package.json`. Subway's self-heal check must define Subway-appropriate checks (e.g., `test:ci`, `lint:check`, `format:check`). The Subway lint config (ESLint) does NOT include auto-import-sort — the prior concern from STATE.md is resolved: `import/order` is present but set to `'warn'`, not auto-fix-on-save, so `lint:fix` is safe to include in the fix plan.

**Primary recommendation:** Port scripts in dependency order — budget-guard first (no deps), then contextfs (no deps), then mcp-policy + intent-router (depend on each other and on config files), then self-heal + self-healing-check last (self-heal deps Subway's package.json scripts which must be confirmed before building the check list). Write Jest tests alongside each script before moving to the next.

---

## Standard Stack

### Core

| Script | Source File | Purpose | Dependency Chain |
|--------|-------------|---------|-----------------|
| budget-guard.js | rlhf/scripts/budget-guard.js | Atomic file-lock ledger enforcing $10/month cap | `fs`, `path` only — zero external deps |
| contextfs.js | rlhf/scripts/contextfs.js | Namespaced file-system context store with Jaccard semantic cache | `fs`, `path` only — zero external deps |
| mcp-policy.js | rlhf/scripts/mcp-policy.js | MCP profile-to-tool allowlist lookup | `fs`, `path` + reads `config/mcp-allowlists.json` + `config/subagent-profiles.json` |
| intent-router.js | rlhf/scripts/intent-router.js | Risk-stratified intent planning with approval checkpoints | requires `./mcp-policy` + reads `config/policy-bundles/*.json` |
| self-heal.js | rlhf/scripts/self-heal.js | Runs npm fix scripts after detecting CI failure | `fs`, `path`, `child_process` only; reads Subway `package.json` scripts |
| self-healing-check.js | rlhf/scripts/self-healing-check.js | Runs health checks and reports pass/fail | `child_process` only; hardcodes check commands — must be adapted for Subway |

### Config Files to Port

| File | Source | Destination in Subway | Purpose |
|------|--------|----------------------|---------|
| config/mcp-allowlists.json | rlhf/config/mcp-allowlists.json | .claude/config/mcp-allowlists.json | Profile → tool allowlist |
| config/subagent-profiles.json | rlhf/config/subagent-profiles.json | .claude/config/subagent-profiles.json | Subagent profile → MCP profile mapping |
| config/policy-bundles/default-v1.json | rlhf/config/policy-bundles/ | .claude/config/policy-bundles/default-v1.json | Balanced intent bundle |
| config/policy-bundles/constrained-v1.json | rlhf/config/policy-bundles/ | .claude/config/policy-bundles/constrained-v1.json | Conservative intent bundle |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| File-lock (budget-guard) | SQLite WAL mode | SQLite requires npm; file-lock is zero-dep and adequate for single-machine use |
| Jaccard similarity (contextfs) | Vector similarity | Vector requires LanceDB (Phase 4); Jaccard is pure JS and sufficient for token-based cache |
| node:test (rlhf tests) | Jest | Subway already uses Jest; porting to Jest is mandatory for consistency — no choice |

**Installation:** None. Zero new npm packages. This is the explicit constraint.

---

## Architecture Patterns

### Recommended Project Structure (Subway target)

```
Subway_RN_Demo/
├── .claude/
│   ├── scripts/
│   │   └── feedback/
│   │       ├── budget-guard.js          # ported from rlhf/scripts/
│   │       ├── contextfs.js             # ported from rlhf/scripts/
│   │       ├── mcp-policy.js            # ported from rlhf/scripts/
│   │       ├── intent-router.js         # ported from rlhf/scripts/
│   │       ├── self-heal.js             # ported from rlhf/scripts/
│   │       └── self-healing-check.js    # ported from rlhf/scripts/ (adapted)
│   ├── config/
│   │   ├── mcp-allowlists.json          # ported from rlhf/config/
│   │   ├── subagent-profiles.json       # ported from rlhf/config/
│   │   └── policy-bundles/
│   │       ├── default-v1.json          # ported from rlhf/config/policy-bundles/
│   │       └── constrained-v1.json      # ported from rlhf/config/policy-bundles/
│   └── memory/
│       └── feedback/
│           ├── budget-ledger.json       # created at runtime by budget-guard
│           └── contextfs/               # created at runtime by contextfs
│               ├── raw_history/
│               ├── memory/
│               │   ├── error/
│               │   └── learning/
│               ├── rules/
│               ├── tools/
│               └── provenance/
├── scripts/
│   └── __tests__/
│       ├── budget-guard.test.js         # new: Jest tests for GOV-01
│       ├── contextfs.test.js            # new: Jest tests for GOV-03
│       ├── intent-router.test.js        # new: Jest tests for GOV-02
│       ├── self-heal.test.js            # new: Jest tests for GOV-04
│       └── self-healing-check.test.js   # new: Jest tests for GOV-04
└── proof/                               # NOTE: proof reports committed in rlhf repo, not Subway
```

### Pattern 1: Path Variable Surgery

**What:** Every rlhf script uses `PROJECT_ROOT = path.join(__dirname, '..')` to locate `config/` and `.claude/memory/feedback/`. In Subway the scripts live at `.claude/scripts/feedback/`, so `PROJECT_ROOT` must resolve two levels up to reach the repo root.

**When to use:** Every ported script.

**Example:**
```javascript
// rlhf original (scripts/ is one level below PROJECT_ROOT)
const PROJECT_ROOT = path.join(__dirname, '..');
const FEEDBACK_DIR = process.env.RLHF_FEEDBACK_DIR
  || path.join(PROJECT_ROOT, '.claude', 'memory', 'feedback');

// Subway port (.claude/scripts/feedback/ is three levels below PROJECT_ROOT)
const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');
const FEEDBACK_DIR = process.env.RLHF_FEEDBACK_DIR
  || path.join(PROJECT_ROOT, '.claude', 'memory', 'feedback');
```

**Critical:** `DEFAULT_BUNDLE_DIR` in intent-router.js also uses `PROJECT_ROOT` to find `config/policy-bundles/`. This resolves to `.claude/config/policy-bundles/` in Subway — verify the path resolves correctly before any test run.

### Pattern 2: Self-Healing Check Adaptation

**What:** `self-healing-check.js` exports a `DEFAULT_CHECKS` array with rlhf-specific npm scripts. These are not valid in Subway.

**rlhf DEFAULT_CHECKS (must NOT copy verbatim):**
```javascript
const DEFAULT_CHECKS = [
  { name: 'budget_status', command: ['npm', 'run', 'budget:status'], timeoutMs: 60_000 },
  { name: 'tests', command: ['npm', 'test'], timeoutMs: 15 * 60_000 },
  { name: 'prove_adapters', command: ['npm', 'run', 'prove:adapters'], timeoutMs: 10 * 60_000 },
  { name: 'prove_automation', command: ['npm', 'run', 'prove:automation'], timeoutMs: 10 * 60_000 },
];
```

**Subway DEFAULT_CHECKS (adapted — these scripts confirmed in Subway package.json):**
```javascript
const DEFAULT_CHECKS = [
  { name: 'budget_status', command: ['node', '.claude/scripts/feedback/budget-guard.js', '--status'], timeoutMs: 10_000 },
  { name: 'lint_check', command: ['npm', 'run', 'lint:check'], timeoutMs: 5 * 60_000 },
  { name: 'format_check', command: ['npm', 'run', 'format:check'], timeoutMs: 5 * 60_000 },
  { name: 'test_ci', command: ['npm', 'run', 'test:ci'], timeoutMs: 15 * 60_000 },
];
```

**budget:status is not an npm script in Subway** — run the script directly as shown above.

### Pattern 3: Test Runner Translation (node:test → Jest)

**What:** rlhf tests use `node:test` API. Subway tests use Jest (`jest-expo` preset). The Jest API is `describe/test/beforeEach/afterEach/expect`. The `node:test` API is `test/after`.

**Example translation:**

```javascript
// rlhf node:test pattern
const test = require('node:test');
const assert = require('node:assert/strict');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-test-'));
process.env.RLHF_FEEDBACK_DIR = tmpDir;

test('adds spend', () => {
  const result = addSpend({ amountUsd: 0.25, source: 'test', note: 'unit' });
  assert.equal(result.totalUsd, 0.25);
});

// Subway Jest equivalent
const os = require('os');
const fs = require('fs');
const path = require('path');

let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subway-gov-test-'));
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  process.env.RLHF_MONTHLY_BUDGET_USD = '1';
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.RLHF_FEEDBACK_DIR;
  delete process.env.RLHF_MONTHLY_BUDGET_USD;
});

test('adds spend', () => {
  const { addSpend } = require('.claude/scripts/feedback/budget-guard');
  const result = addSpend({ amountUsd: 0.25, source: 'test', note: 'unit' });
  expect(result.totalUsd).toBe(0.25);
});
```

**Critical:** Jest caches `require()` between tests. Set env vars BEFORE requiring the module, or use `jest.resetModules()` in `beforeEach`. The rlhf `node:test` tests set env vars at module level because each test file is a fresh process — Jest does not work this way.

### Pattern 4: Budget Guard Lock under Parallel Agents

**What:** `acquireLock()` in budget-guard.js uses `timeoutMs=5000, staleMs=15000`. Under 4+ parallel GSD agents, 5s timeout fails.

**Recommendation for Subway:** Increase to `timeoutMs=30000, staleMs=60000`. If Subway's agent execution pattern regularly spawns 4+ concurrent API callers, add a concurrency stress test to the Jest suite.

### Anti-Patterns to Avoid

- **Copying DEFAULT_CHECKS verbatim from self-healing-check.js:** The rlhf-specific npm scripts (`budget:status`, `prove:adapters`, `prove:automation`) do not exist in Subway. The check will fail immediately on the first run.
- **Setting env vars at module scope in Jest tests:** Jest re-uses the same process; module-level env vars persist across tests in unexpected ways. Use `beforeEach`/`afterEach` with `jest.resetModules()`.
- **Using `require()` for budget-guard at test-file top level:** The module reads `RLHF_FEEDBACK_DIR` at require time via the closure in `loadLedger()`. Require AFTER setting the env var, or refactor to accept path as argument (simpler: require in beforeEach after setting env).
- **Putting config files at repo root:** Policy bundles and mcp-allowlists belong in `.claude/config/`, not at repo root. `mcp-policy.js` looks for them relative to `PROJECT_ROOT/config/` — with the correct `PROJECT_ROOT` depth, this resolves to `.claude/config/` automatically.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Atomic spend tracking | Custom JSONL appender | budget-guard.js file-lock pattern (already built) | File-lock with stale detection handles concurrent writers; a naive JSONL append has TOCTOU race condition |
| Context retrieval | Custom search | contextfs.js constructContextPack() (already built) | Implements bounded context, Jaccard cache, provenance logging, and TTL expiry — 514 lines; do not reimplement |
| Intent approval gates | Custom role check | intent-router.js planIntent() (already built) | Handles profile-specific risk overrides, checkpoint enforcement, and bundle validation |
| Fix-script executor | Custom shell runner | self-heal.js runSelfHeal() (already built) | Tracks pre/post git diff, handles plan construction from package.json introspection |

**Key insight:** All four governance components are already production-quality in rlhf. The work is a path-surgery port, not a feature build. Any attempt to re-architect these from scratch will reintroduce bugs that rlhf already fixed (e.g., stale lock detection, Jaccard edge cases with empty token sets).

---

## Common Pitfalls

### Pitfall 1: Wrong PROJECT_ROOT depth

**What goes wrong:** Scripts resolve config and ledger paths incorrectly, failing with ENOENT on first run.
**Why it happens:** rlhf scripts are at `scripts/` (one level below root). Subway scripts will be at `.claude/scripts/feedback/` (three levels below root).
**How to avoid:** Change every script's first line to `const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');` and verify that `path.join(PROJECT_ROOT, 'config', 'policy-bundles', 'default-v1.json')` resolves to the actual file path before running any tests.
**Warning signs:** `Error: ENOENT: no such file or directory, open '.../config/policy-bundles/default-v1.json'` on first test run.

### Pitfall 2: Jest module cache trapping wrong env vars

**What goes wrong:** Tests use different `RLHF_FEEDBACK_DIR` values but the cached require() returns the module from the first test's env.
**Why it happens:** Jest caches modules between tests. `budget-guard.js` closes over `LEDGER_PATH` at module load time.
**How to avoid:** In each test that needs an isolated tmpDir: (1) set env var, (2) call `jest.resetModules()`, (3) require module inside the test or `beforeEach`. Alternatively, patch `RLHF_FEEDBACK_DIR` before any require in the file, as the rlhf tests do — but scope it correctly with `beforeEach`/`afterEach` in Jest.
**Warning signs:** Two tests sharing the same ledger file when they should have separate tmp dirs.

### Pitfall 3: Self-healing-check DEFAULT_CHECKS with invalid npm scripts

**What goes wrong:** `self-healing-check.js` runs `npm run budget:status` which does not exist in Subway, exits non-zero, and reports the whole system as unhealthy from day one.
**Why it happens:** DEFAULT_CHECKS hardcodes rlhf-specific npm script names.
**How to avoid:** Redefine DEFAULT_CHECKS in the Subway copy. Use `npm run lint:check`, `npm run format:check`, `npm run test:ci`, and the budget-guard script invoked directly (not via an npm script).
**Warning signs:** First `self-heal:check` run reports `unhealthy` immediately before any governance failures actually exist.

### Pitfall 4: import/order lint rule causes lint:fix to fail in self-heal

**What goes wrong:** Running `npm run lint:fix` via self-heal rewrites import order in Subway TypeScript files, creating a git diff and confusing `runSelfHeal`'s change detection logic.
**Why it happens:** Subway has `import/order: 'warn'` which means ESLint --fix WILL reorder imports. This is not auto-import-sort (which would be worse), but it still makes changes.
**How to avoid:** `import/order: 'warn'` — ESLint --fix does reorder imports when it can, even at warn level. Include `lint:fix` in `KNOWN_FIX_SCRIPTS` but expect it to produce `changedFiles` on the first run after sync. Verify `changed: true` is not treated as a failure signal — `runSelfHeal` only returns `healthy: false` when `execution.failed > 0`, not when files change.
**Warning signs:** `changedFiles` array is non-empty after self-heal — this is expected on first run; do not treat as a bug.

### Pitfall 5: Proof report committed in wrong repo

**What goes wrong:** Proof report is committed to Subway_RN_Demo, which is gitignored via `.git/info/exclude` for `.claude/scripts/feedback/`. The commit disappears and is not visible in the rlhf repo.
**Why it happens:** The constraint is that Subway files are gitignored; all commits and proof reports go into the rlhf repo.
**How to avoid:** Write proof report to `rlhf/proof/governance-into-subway/` and commit it there. The proof reports scripts that run in Subway but are evidenced via the rlhf commit trail.
**Warning signs:** `git status` in rlhf shows no new files in proof/ after claiming GOV-06 complete.

---

## Code Examples

Verified patterns from direct source inspection:

### Budget Guard: addSpend (zero-dep atomic ledger)

```javascript
// Source: /Users/ganapolsky_i/workspace/git/igor/rlhf/scripts/budget-guard.js
// Subway copy: .claude/scripts/feedback/budget-guard.js
// Path surgery: change PROJECT_ROOT to path.join(__dirname, '..', '..', '..')

function addSpend({ amountUsd, source, note }) {
  const budgetUsd = getMonthlyBudget(); // reads RLHF_MONTHLY_BUDGET_USD env var
  const lockFd = acquireLock({ timeoutMs: 30000, staleMs: 60000 }); // increase from 5000/15000
  try {
    const ledger = loadLedger(); // reads FEEDBACK_DIR/budget-ledger.json
    const month = currentMonthKey(); // YYYY-MM UTC
    const nextTotal = ledger.months[month].totalUsd + amountUsd;
    if (nextTotal > budgetUsd) throw new Error(`Budget exceeded: ...`);
    // ... save ledger
    return { month, totalUsd, budgetUsd };
  } finally {
    releaseLock(lockFd);
  }
}
```

### ContextFS: constructContextPack with Jaccard cache

```javascript
// Source: /Users/ganapolsky_i/workspace/git/igor/rlhf/scripts/contextfs.js
// Jaccard threshold=0.7, TTL=86400s are ENV-configurable defaults:
// RLHF_SEMANTIC_CACHE_THRESHOLD=0.7
// RLHF_SEMANTIC_CACHE_TTL_SECONDS=86400
// RLHF_SEMANTIC_CACHE_ENABLED=true (set to 'false' to disable)

const pack = constructContextPack({
  query: 'ESLint import order fix failed',
  maxItems: 8,
  maxChars: 6000,
  namespaces: ['memoryError', 'memoryLearning', 'rules'],
});
// Returns { packId, items: [...], cache: { hit: bool, similarity: 0.XX } }
```

### Intent Router: planIntent with approval gate

```javascript
// Source: /Users/ganapolsky_i/workspace/git/igor/rlhf/scripts/intent-router.js
// Requires: mcp-policy.js + config/mcp-allowlists.json + config/policy-bundles/*.json

const plan = planIntent({
  bundleId: 'default-v1',
  mcpProfile: 'default',
  intentId: 'publish_dpo_training_data',
  approved: false,
});
// Returns: { status: 'checkpoint_required', checkpoint: { type: 'human_approval', ... } }
// With approved: true → { status: 'ready', checkpoint: null }
```

### Self-Heal: Subway-adapted DEFAULT_CHECKS

```javascript
// Source: adapted from /Users/ganapolsky_i/workspace/git/igor/rlhf/scripts/self-healing-check.js
// Subway version: .claude/scripts/feedback/self-healing-check.js

const SUBWAY_ROOT = path.join(__dirname, '..', '..', '..');

const DEFAULT_CHECKS = [
  {
    name: 'budget_status',
    command: ['node', path.join(SUBWAY_ROOT, '.claude', 'scripts', 'feedback', 'budget-guard.js'), '--status'],
    timeoutMs: 10_000,
  },
  { name: 'lint_check', command: ['npm', 'run', 'lint:check'], timeoutMs: 5 * 60_000 },
  { name: 'format_check', command: ['npm', 'run', 'format:check'], timeoutMs: 5 * 60_000 },
  { name: 'test_ci', command: ['npm', 'run', 'test:ci'], timeoutMs: 15 * 60_000 },
];
```

### Jest Test Pattern for Budget Guard

```javascript
// Source: translated from /Users/ganapolsky_i/workspace/git/igor/rlhf/tests/budget-guard.test.js
// Target: Subway_RN_Demo/scripts/__tests__/budget-guard.test.js

const fs = require('fs');
const path = require('path');
const os = require('os');

let tmpDir;
let budgetGuard;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subway-budget-test-'));
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  process.env.RLHF_MONTHLY_BUDGET_USD = '1';
  jest.resetModules();
  budgetGuard = require('../../.claude/scripts/feedback/budget-guard');
});

afterEach(() => {
  delete process.env.RLHF_FEEDBACK_DIR;
  delete process.env.RLHF_MONTHLY_BUDGET_USD;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('adds spend and reports status', () => {
  const { addSpend, getBudgetStatus } = budgetGuard;
  addSpend({ amountUsd: 0.25, source: 'test', note: 'unit' });
  const status = getBudgetStatus();
  expect(status.remainingUsd).toBe(0.75);
});

test('blocks overspend', () => {
  const { addSpend } = budgetGuard;
  addSpend({ amountUsd: 0.9, source: 'test' });
  expect(() => addSpend({ amountUsd: 0.9, source: 'test' })).toThrow(/Budget exceeded/);
});
```

---

## State of the Art

| Old Approach | Current Approach | Status | Impact |
|--------------|------------------|--------|--------|
| No budget enforcement | File-lock atomic ledger with monthly cap | Live in rlhf since Phase 1 | Prevents API cost blowouts; must land before any RLAIF work in Subway |
| Ad hoc context assembly | ContextFS with Jaccard semantic cache | Live in rlhf since Phase 1 | Bounded, reproducible context with provenance — prevents context bloat |
| No self-healing | Health check runner + fix plan executor | Live in rlhf | Automated CI recovery; Subway-adapted checks needed |

**Confirmed NOT deprecated:**
- `node:fs` file-lock pattern: Valid on Node.js 25.6.1 — `fs.openSync(path, 'wx')` throws EEXIST on contention, which is the correct mechanism.
- `JSON.stringify` + `fs.writeFileSync` for atomic ledger: Adequate for single-machine embedded use; no database required.

---

## Open Questions

1. **Subway npm script for running governance script tests**
   - What we know: Subway's `scripts/__tests__/` tests are run by Jest (`jest-expo`). `npm test` runs the full RN test suite. `npm run test:fast` samples tests.
   - What's unclear: Whether a dedicated `npm run test:governance` script should be added to Subway's `package.json`, or whether the governance tests integrate into the default `npm test` run.
   - Recommendation: Add `test:governance` as a scoped Jest run (`jest scripts/__tests__/ --testPathPattern=governance`) so the planner can run it in isolation. Full `npm test` in Subway takes minutes and runs RN component tests that are irrelevant to governance.

2. **Lock contention under GSD parallel agents in Subway**
   - What we know: Recommended fix is `timeoutMs=30000, staleMs=60000` (from SUMMARY.md Pitfall 5). Default rlhf values are 5000/15000.
   - What's unclear: Whether Subway's agent execution pattern actually spawns 4+ concurrent API callers in practice, or whether 5000ms would have been fine.
   - Recommendation: Apply 30000/60000 values in the Subway copy. Add a concurrency stress test (5 parallel `addSpend()` calls via Promise.all) to the Jest suite to confirm the timeout holds.

3. **Subway-specific policy bundle content**
   - What we know: rlhf's `default-v1.json` references MCP tools specific to the rlhf server (`capture_feedback`, `feedback_summary`, `export_dpo_pairs`, etc.). Subway's MCP server has a different tool surface.
   - What's unclear: Whether to copy the rlhf bundles verbatim (the tool names become aspirational/docs) or create Subway-specific bundles.
   - Recommendation: Copy rlhf bundles verbatim for GOV-02 compliance. The intent-router validates bundle structure (bundleId, intents, risk, actions) but does NOT validate that tool names exist in any MCP server — tool name strings are opaque to the router. Add a comment noting the tool names are rlhf-origin and should be updated in a future cleanup pass.

---

## Sources

### Primary (HIGH confidence)

- `/Users/ganapolsky_i/workspace/git/igor/rlhf/scripts/budget-guard.js` — full source read; lock mechanism, ledger schema, env vars confirmed
- `/Users/ganapolsky_i/workspace/git/igor/rlhf/scripts/intent-router.js` — full source read; mcp-policy dependency, bundle schema confirmed
- `/Users/ganapolsky_i/workspace/git/igor/rlhf/scripts/contextfs.js` — full source read; Jaccard threshold=0.7, TTL=86400 env config confirmed
- `/Users/ganapolsky_i/workspace/git/igor/rlhf/scripts/self-heal.js` — full source read; KNOWN_FIX_SCRIPTS list confirmed
- `/Users/ganapolsky_i/workspace/git/igor/rlhf/scripts/self-healing-check.js` — full source read; DEFAULT_CHECKS confirmed rlhf-specific
- `/Users/ganapolsky_i/workspace/git/igor/rlhf/scripts/mcp-policy.js` — partial read (60 lines); profile/allowlist loading confirmed
- `/Users/ganapolsky_i/workspace/git/igor/rlhf/config/mcp-allowlists.json` — full read; 3 profiles (default, readonly, locked) confirmed
- `/Users/ganapolsky_i/workspace/git/igor/rlhf/config/subagent-profiles.json` — full read; 3 subagent profiles confirmed
- `/Users/ganapolsky_i/workspace/git/igor/rlhf/config/policy-bundles/default-v1.json` — full read; 4 intents confirmed
- `/Users/ganapolsky_i/workspace/git/igor/rlhf/config/policy-bundles/constrained-v1.json` — full read; 3 intents, locked profile defaults confirmed
- `/Users/ganapolsky_i/workspace/git/igor/rlhf/tests/budget-guard.test.js` — full read (40 lines)
- `/Users/ganapolsky_i/workspace/git/igor/rlhf/tests/self-healing-check.test.js` — full read (58 lines)
- `/Users/ganapolsky_i/workspace/git/igor/rlhf/tests/intent-router.test.js` — full read (62 lines)
- `/Users/ganapolsky_i/workspace/git/igor/rlhf/tests/self-heal.test.js` — full read (36 lines)
- `/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.eslintrc.js` — full read; NO auto-import-sort; `import/order` is `'warn'` not `'error'`; `lint:fix` is safe
- `/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/package.json` — scripts confirmed: `lint`, `lint:check`, `format`, `format:check`, `test:ci`, `test:fast`; NO `budget:status`, `prove:adapters`, `prove:automation`
- `/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/__tests__/autonomy-cli.test.js` — Jest pattern confirmed for Subway scripts tests
- `/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/__tests__/feedback-loop.test.js` — Jest `beforeEach`/`afterEach`/`expect` pattern confirmed
- `/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/.git/info/exclude` — `.claude/scripts/feedback/` confirmed gitignored; commits go to rlhf repo only
- `/Users/ganapolsky_i/workspace/git/igor/rlhf/proof/baseline-test-count.md` — 60 node-runner tests baseline confirmed; Phase 3 must not regress
- `/Users/ganapolsky_i/workspace/git/igor/rlhf/proof/automation/report.md` — proof report format confirmed

### Secondary (MEDIUM confidence)

- `.planning/research/SUMMARY.md` — architecture decisions and pitfalls referenced throughout; verified against source code during this research session

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all scripts read directly; zero-dep status confirmed; no external libraries
- Architecture: HIGH — path depths calculated from actual directory structure; test runner confirmed from Subway test files
- Pitfalls: HIGH — DEFAULT_CHECKS mismatch confirmed by reading both rlhf and Subway package.json; Jest module cache issue confirmed from test file patterns; gitignore scope confirmed from .git/info/exclude
- Open questions: MEDIUM — policy bundle tool name mismatch is a known gap; test scoping is a planning decision, not a blocker

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (governance scripts are stable; no fast-moving dependencies)

**Key numbers the planner needs:**
- rlhf baseline test count: 60 node-runner tests (must not regress)
- Governance test lines in rlhf: 298 lines across 5 test files (reference for coverage target)
- Subway scripts live at: `.claude/scripts/feedback/` (3 levels below PROJECT_ROOT)
- Config files land at: `.claude/config/` (resolved automatically if PROJECT_ROOT is correct)
- Lock timeout for Subway: `timeoutMs: 30000, staleMs: 60000` (increased from rlhf defaults)
- Jaccard threshold: `0.7` (env: `RLHF_SEMANTIC_CACHE_THRESHOLD`)
- Cache TTL: `86400` seconds (env: `RLHF_SEMANTIC_CACHE_TTL_SECONDS`)
- Monthly budget cap: `$10` USD (env: `RLHF_MONTHLY_BUDGET_USD`)
