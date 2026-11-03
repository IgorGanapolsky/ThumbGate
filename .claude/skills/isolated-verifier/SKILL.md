# Isolated Verifier

## Context

Per Anthropic's October 2026 findings and the MAST taxonomy, single-agent
architectures with a dedicated "Verifier" step that "only runs the tests and
reports results" outperform multi-agent swarms at a fraction of the cost.

23.5% of multi-agent failures are task-verification gaps (incorrect verification
9.1%, no/incomplete verification 8.2%, premature termination 6.2%). The
Isolated Verifier closes this gap by running as a **separate process** with
**isolated temp directory** and **independent scoring criteria** that the
primary agent never reads during task execution.

```
┌──────────────┐     ┌──────────────────────┐
│  Primary     │────▶│  Isolated Verifier   │
│  Agent       │     │  (separate process,  │
│  (does work) │     │   isolated temp dir) │
└──────────────┘     └──────────┬───────────┘
                                │
                                ▼
                      ┌───────────────────┐
                      │  config/          │
                      │ verifier-criteria │
                      │  .json            │
                      │  (PRIMARY NEVER    │
                      │   READS IN RUN)    │
                      └───────────────────┘
```

## Design Principles

1. **Process Isolation** — The Verifier runs in a child process via
   `spawnSync`, never sharing in-memory state with the primary agent.
2. **Temp Dir Isolation** — Proof artifacts are written to a unique temp
   directory (`mkdtempSync` with prefix `thumbgate-verifier-`)`), cleaned up
   after the report is built.
3. **Independent Criteria** — Scoring rubric lives in
   `config/verifier-criteria.json`, loaded fresh by the Verifier process. The
   primary agent does **not** read this file during task execution.
4. **Verifier Only Runs and Reports** — It never writes code, makes decisions,
   or approves PRs. It outputs a structured report and records a
   `verifier_passed` session action on PASS.

## Integration Points

### require-proof.js
Additive gate — fails closed (exit 1) if `verifier_passed` session action is
missing when source files have changed:

```js
// scripts/require-proof.js
if (sourceChanged && !hasSessionAction('verifier_passed')) {
  console.error('✗ THUMBGATE ERROR: Isolated Verifier evidence missing.');
  process.exit(1);
}
```

### pr-manager.js
`resolveBlockers()` checks for `verifier_passed` before allowing trunk merge
submission. This is **additive** — never bypasses branch protection.

### package.json
```json
"verify:isolated": "node scripts/isolated-verifier.js --goal \"$(cat .claude/session-goal.txt 2>/dev/null || echo 'no goal')\" --plan quick"
```

## Usage

```bash
# Full verification (runs all mechanical + semantic checks)
node scripts/isolated-verifier.js --goal "implement X" --plan full

# Quick verification (unit tests + proof pack integrity only)
node scripts/isolated-verifier.js --goal "implement X" --plan quick

# JSON output
node scripts/isolated-verifier.js --goal "implement X" --plan quick --json

# Via npm script
npm run verify:isolated
```

## Report Structure

```json
{
  "reportId": "verify_<timestamp>_<random>",
  "verifier": "isolated-verifier",
  "criteriaVersion": "1.0",
  "timestamp": 1234567890,
  "goal": "the stated objective",
  "plan": "quick",
  "isolation": {
    "tempDir": "/tmp/thumbgate-verifier-XXXX",
    "isolateProofDir": true,
    "isolateEnv": true
  },
  "input": {
    "changedFiles": ["src/foo.js", "tests/foo.test.js"],
    "changedFileCount": 2,
    "gitDiffStats": { "additions": 10, "deletions": 2 }
  },
  "levels": {
    "mechanical": [ { "id": "unit_tests", "status": "pass", "passed": true, ... } ],
    "semantic": [ { "id": "goal_alignment", "score": 0.8, "passed": true, ... } ]
  },
  "overall": {
    "verdict": "PASS",
    "weightedScore": 0.91
  }
}
```

## Level 1 — Mechanical Checks (Deterministic)

| Check ID | Description | Conditional? |
|---|---|---|
| `unit_tests` | `npm test` — all tests pass | No |
| `test_coverage` | `npm run test:coverage` meets threshold | No |
| `perf_budgets` | `node scripts/perf-budget-check.js` (only when hot-path files changed) | Yes |
| `self_heal` | `npm run self-heal:check` | No |
| `proof_pack_integrity` | `node scripts/refresh-proof-pack.js --check` | No |

Quick plan runs only `unit_tests` + `proof_pack_integrity`.

## Level 2 — Semantic Checks (Weighted Rubric)

| Check ID | Weight | Description |
|---|---|---|
| `goal_alignment` | 0.30 | Token overlap between goal and diff |
| `edge_case_coverage` | 0.25 | Test files contain 12 edge-case patterns |
| `regression_check` | 0.25 | Anti-patterns: console.log, TODO, eval, var, debugger |
| `design_compliance` | 0.20 | Code conventions: quotes, indentation, imports |

All checks are `mustPass: true`.

## Related Skills

- `elephant-goldfish-autonomous-loop` — Goldfish subagent stress-tests the
  Elephant's spec; the Verifier is the final "Mean Code & Live Runtime Review."
- `anti-lazy-mandate` — Enforces verifiable evidence before completion claims.
- `thumbgate` — Pre-action feedback capture and prevention rules.
