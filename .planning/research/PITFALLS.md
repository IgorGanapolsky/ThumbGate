# Pitfalls Research

**Domain:** RLHF Bidirectional Feature Sync (Node.js repos with shared-but-diverged patterns)
**Researched:** 2026-03-04
**Confidence:** HIGH (based on direct code inspection of both repos + verified external sources)

---

## Critical Pitfalls

### Pitfall 1: API Name Collision — Same Concept, Different Function Names

**What goes wrong:**
The two repos use different names for the same conceptual operation. Subway's `feedback-loop.js` exports `recordFeedback()`, but thumbgate exports `captureFeedback()`. Subway has `selfScore()` (RLAIF); rlhf has no equivalent yet. When syncing, tests importing from one module by name will silently pass in their own repo and immediately break in the other. The failure mode is not a crash at import time — it's a `TypeError: undefined is not a function` at call time, inside a test that looks correct.

**Why it happens:**
Both repos were developed independently after the initial extraction. Subway added `recordFeedback` + `selfScore` as new primitives. thumbgate added `captureFeedback` as a renamed, extended version that also accepts rubric payloads. Neither was intended to break the other, but the names diverged silently.

**How to avoid:**
Before porting any function, run: `grep -n "module.exports" scripts/feedback-loop.js` in both repos and diff the exports. Write an integration adapter that aliases the function names during the sync phase rather than renaming the canonical implementation. Tests for ported code must `require()` the local path directly — never assume name parity.

**Warning signs:**
- `undefined is not a function` errors only in the target repo's test run
- Tests pass 100% in the source repo but fail immediately after copy
- `recordFeedback` / `captureFeedback` used interchangeably in comments or docs

**Phase to address:**
Phase 1 (Setup / Contract Mapping) — establish a function-name audit before any code movement. Every feature port must start with an explicit "source exports X, target exports Y, bridged via Z" mapping.

---

### Pitfall 2: Schema Divergence on `resolveFeedbackAction` — Rubric Field Added in rlhf, Missing in Subway

**What goes wrong:**
The `resolveFeedbackAction()` function in both repos accepts a `params` object, but their signatures diverged: rlhf's version accepts `rubricEvaluation` as a top-level param and uses it to gate positive feedback via `promotionEligible`. Subway's version has no `rubricEvaluation` param. If you sync the feedback-loop from rlhf → Subway without also syncing the rubric engine and schema changes, the positive feedback path silently skips the rubric gate — meaning Subway will accept feedback that rlhf would block.

**Why it happens:**
Rubric-based scoring was added to thumbgate as a governance feature after the original extraction. The addition was backward-compatible within rlhf (rubricEvaluation is optional), but no corresponding update was made to Subway's copy.

**How to avoid:**
Treat `resolveFeedbackAction` as an atomic unit: never sync it without also syncing the rubric-engine dependency and updating the tests to assert rubric gate behavior. Run `diff scripts/feedback-schema.js` across both repos before any sync and resolve all signature differences explicitly.

**Warning signs:**
- Subway tests pass for positive feedback without rubric scores
- rlhf tests block positive feedback when `testsPassed: false`; Subway tests do not
- `rubricEvaluation` param present in rlhf schema but absent in Subway's function signature

**Phase to address:**
Phase 1 (Contract Mapping) and Phase 2 (Sync feedback-schema). The rubric engine must arrive before or alongside any feedback-loop sync.

---

### Pitfall 3: Thompson Posterior Format Is Python-Native — Not Directly Wrappable in Node.js

**What goes wrong:**
Subway's Thompson Sampling model lives in Python (`train_from_feedback.py`). The model state persists to `feedback_model.json` using Python's `datetime.now().isoformat()` for timestamps (no trailing `Z`, format varies: sometimes `"2026-02-11T14:01:27.883297"`, sometimes `"2026-02-24T15:51:18Z"`). A Node.js consumer of the same JSON will fail `Date.parse()` on the non-Z variant in strict environments, or silently produce `NaN`. The decay calculation in `time_decay_weight()` depends on this parsing being correct — wrong parse = wrong weight = corrupted posterior updates.

**Why it happens:**
Python's `datetime.fromisoformat()` handles the mixed formats because it is permissive. JavaScript's `new Date()` is also permissive but strips microseconds differently. The real risk is when rlhf's Node.js side reads the model JSON and does arithmetic on timestamps.

**How to avoid:**
Normalize all timestamps to RFC 3339 (`YYYY-MM-DDTHH:mm:ssZ`) at the boundary — either in the Python writer or in a Node.js reader shim. Never do `new Date(timestamp)` directly on this field; use a `parseTimestamp()` helper that strips microseconds, adds `Z` if absent, and validates before arithmetic.

**Warning signs:**
- `NaN` appearing in decay weight calculations during Node.js reads of `feedback_model.json`
- Thompson alpha/beta values drifting toward prior (1.0) after Node.js sync
- `last_updated` timestamps using both `"Z"` and microsecond formats in the same JSON

**Phase to address:**
Phase 3 (Port Thompson Sampling to thumbgate). Write a timestamp normalizer before writing any posterior read/write code.

---

### Pitfall 4: LanceDB Node.js Package Has Platform-Specific Native Binaries — Will Silently Fail on Some Environments

**What goes wrong:**
The `@lancedb/lancedb` npm package ships native Rust binaries for each platform. If the environment uses Alpine Linux (common in CI) or a non-standard libc, the package install succeeds but `require('@lancedb/lancedb')` throws at runtime. The error is not a missing module error — it's a native binding load failure that looks like a corrupt installation. The Python LanceDB (v0.27.1 confirmed installed) uses a different storage format version than older Node.js LanceDB clients — cross-language table access requires matching Lance file format versions.

**Why it happens:**
LanceDB's Node.js bindings are compiled Rust. Alpine uses musl libc; the default binaries target glibc. Additionally, the Lance file format (v2.1+) introduced breaking schema changes that cause "Append with different schema" errors when a table created in Python is accessed from an older Node.js client. (Source: [LanceDB GitHub Issue #669](https://github.com/lancedb/lancedb/issues/669), [Issue #2134](https://github.com/lancedb/lancedb/issues/2134))

**How to avoid:**
- Pin both Python and Node.js LanceDB versions to the same Lance file format version. Python 0.27.1 → check the Node.js changelog for the matching version.
- In CI, use `node:bookworm-slim` or equivalent (not Alpine) for any step that loads LanceDB Node.js bindings.
- Write a smoke test that creates a table in Python and reads it from Node.js (or vice versa) as part of the integration test suite.
- Never call `table.add()` from Node.js on a table created from Python without verifying schema compatibility first.

**Warning signs:**
- `Error: LanceDBError: Append with different schema` after platform change
- Node.js `require('@lancedb/lancedb')` throws on CI but passes locally
- Python and Node.js read different row counts from the same Lance directory

**Phase to address:**
Phase 3 (Port LanceDB to thumbgate). The first task in that phase must be a platform compatibility check and version pinning.

---

### Pitfall 5: Budget Guard File Lock Is Synchronous Busy-Wait — Breaks Under Parallel Agent Execution

**What goes wrong:**
`budget-guard.js` uses `fs.openSync(LOCK_PATH, 'wx')` with a synchronous busy-wait loop (`blockMs(20)`) to acquire a file lock. Under GSD's parallel agent execution model (multiple agents running simultaneously), multiple agents can pile up on this lock. The 5-second timeout (`timeoutMs = 5000`) is generous for serial execution but extremely tight when 4-6 parallel subagents all try to record spend simultaneously. Any agent that times out throws `Could not acquire budget ledger lock` and the spend is not recorded — meaning the budget guard undercounts actual spend and can allow budget overruns.

**Why it happens:**
The budget guard was designed for sequential CLI usage. Parallel agent execution was not in scope when it was written. The stale lock detection (15 second threshold) assumes a lock older than 15s is dead — but a long-running parallel agent legitimately holds the lock for 15s+.

**How to avoid:**
When porting budget-guard to Subway (or using it from parallel agents), either: (a) increase `timeoutMs` to 30s and `staleMs` to 60s, or (b) batch spend recordings through a single agent coordinator rather than letting each parallel agent call `addSpend()` directly. Add a test that runs 5 concurrent `addSpend()` calls and verifies all 5 recorded correctly.

**Warning signs:**
- `Could not acquire budget ledger lock` errors in CI logs during parallel test runs
- Budget ledger shows fewer entries than expected when multiple agents ran
- `budget-ledger.json` entries missing for known operations

**Phase to address:**
Phase 4 (Port budget-guard to Subway). The porting phase must include a concurrency stress test, not just the existing sequential unit test.

---

### Pitfall 6: Self-Healing Can Run Lint:fix and Silently Overwrite Intentional Code

**What goes wrong:**
`self-heal.js` builds its fix plan from the set of npm scripts matching `['lint:fix', 'format', 'fix', 'feedback:rules']`. It runs them unconditionally when invoked. If `lint:fix` has auto-import-sort or auto-reorder behavior, it can silently reorder the exports of a file you just synced, breaking the intent of the sync. Worse: the self-healer reports `healthy: true` if the scripts exit 0 — it cannot distinguish "fixed a real lint error" from "reformatted intentional code structure."

**Why it happens:**
Self-heal is designed for recovery from known bad states. It has no concept of "protected changes" — changes made by the sync process look the same as lint errors to it.

**How to avoid:**
Do not invoke self-heal immediately after a manual feature sync. Always run `git diff` to review auto-fixes before committing. Add `--dry-run` as the first step if the lint tool supports it. When porting self-heal to Subway, check that Subway's `lint:fix` script does not include import sorting or code restructuring that would conflict with the ported code's intended structure.

**Warning signs:**
- `git diff` after a self-heal run shows reordered imports or restructured code blocks
- A sync that passed all tests before self-heal fails after it
- `self-heal.js` reports `changed: true` on files you did not intend to modify

**Phase to address:**
Phase 5 (Port self-healing monitor to Subway). The test for self-heal must verify that it does NOT modify intentionally structured code.

---

### Pitfall 7: Subway's `selfScore` Is Heuristic-Only — Porting It as "RLAIF" Overstates Its Capabilities

**What goes wrong:**
Subway's `selfScore()` function scores based on boolean flags: `evidenceProvided`, `testsRun`, `filesModified.length > 5`. The docstring explicitly says "This is NOT real RLHF — it's a heuristic scorer." If this function is ported to thumbgate and labeled as RLAIF self-scoring in API docs or test descriptions, downstream consumers (or future developers) will treat it as a model-backed scorer and build logic that depends on score precision. The score has only 4 effective values (1.0, 0.9, 0.8, 0.7... via 0.2 and 0.1 deductions), not a continuous distribution.

**Why it happens:**
The "RLAIF" label in comments creates a false impression of ML-backed scoring. When the feature is re-documented during the port, the nuance is easily lost.

**How to avoid:**
Rename the function to `selfAudit()` or `constitutionalCheck()` in thumbgate to make clear it is rule-based, not model-based. Add JSDoc explicitly stating the score is heuristic. Write tests that assert specific score values given known inputs — this makes the discrete, non-continuous nature of the scorer visible and tested.

**Warning signs:**
- PR descriptions or tests referring to "RLAIF score" without a "heuristic" qualifier
- Code that treats the score as a continuous probability (e.g., using it as a weight in averaging)
- Test assertions like `expect(score).toBeGreaterThan(0.7)` rather than `expect(score).toBe(0.8)`

**Phase to address:**
Phase 3 (Bring RLAIF self-scoring into thumbgate). The PR description must explicitly acknowledge the heuristic nature.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Copying feedback-loop.js without diffing exports | Faster port | API name collisions break tests silently | Never |
| Using `require('../feedback-schema')` without version-pinning | Works now | Schema drift between repos goes undetected | Never |
| Not normalizing timestamps before arithmetic | Avoids a shim | `NaN` decay weights corrupt Thompson posteriors | Never |
| Running self-heal immediately after sync | Convenience | Auto-reformats intentionally structured code | Only if `--dry-run` first |
| Porting selfScore without renaming from "RLAIF" | Saves a rename | Future developer assumes ML-backed scoring | Never in public API |
| Installing LanceDB Node.js without version-pinning | Latest features | Schema format mismatch with Python-created tables | Only in isolated dev environment |

---

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| LanceDB Python → Node.js table reads | Assume schema compatibility after version upgrade | Pin both to same Lance file format; add cross-language smoke test |
| Budget ledger under parallel agents | Each agent calls `addSpend()` directly | Serialize through coordinator or increase lock timeout to 30s |
| Thompson Sampling JSON → Node.js | `new Date(timestamp)` on mixed-format timestamps | `parseTimestamp()` helper that normalizes before `Date.parse()` |
| ContextFS + LanceDB | Assuming ContextFS (JS file-based) and LanceDB (binary) are interchangeable stores | They serve different purposes: ContextFS is for structured JSON context packs; LanceDB is for vector similarity search |
| Self-heal in Subway CI | Assuming Subway's `lint:fix` is safe to auto-run | Audit Subway's lint config for auto-import-sort before enabling self-heal |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Reading all JSONL on every `analyzeFeedback()` call | Slow analytics as log grows | Add pagination or incremental index | At ~50k feedback entries (~500MB JSONL) |
| Thompson posterior in JSON file, rewritten on every update | File write contention under high-frequency feedback | Use in-memory buffer + periodic flush | Under burst feedback (>100 entries/minute) |
| ContextFS semantic cache JSONL grows unbounded | Cache hit rate drops as stale entries pile up | Implement TTL eviction on cache read; currently only on write | After 30-day cache TTL * high query volume |
| LanceDB FTS index not rebuilt after bulk inserts | Vector search returns stale results | Explicitly call `optimize()` or rebuild index after bulk sync | After first bulk import of Subway's 264 feedback entries |
| Synchronous busy-wait lock in budget-guard.js | CPU spike during parallel agent runs | Switch to async lock or serialized coordinator | Under 4+ parallel agents |

---

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Exposing `budget-ledger.json` via API endpoint | Leaks spend patterns and source identifiers | Never expose ledger path via HTTP; budget status API should return aggregate only |
| Storing raw feedback context strings in ContextFS without sanitization | Injected control characters corrupt JSONL on re-parse | Run `JSON.stringify` → `JSON.parse` round-trip check on every feedback context field before append |
| Thompson model JSON committed to repo with real feedback data | Leaks usage patterns and category weights | The `feedback_model.json` file has a "LOCAL ONLY — Do not commit" comment; enforce via `.gitignore` |
| Self-heal running `npm run fix` with shell injection via `--reason` arg | Arbitrary code execution if reason string is user-controlled | Validate `--reason` arg to alphanumeric + spaces only before passing to `spawnSync` |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Thompson Sampling port:** Often missing the time-decay half-life config and the `--incremental` update mode — verify both `--train` (full rebuild) and `--incremental` paths work after port
- [ ] **LanceDB integration:** Often missing the FTS index creation step — verify `create_fts_index()` is called after table creation, not just `create_scalar_index()`
- [ ] **Budget guard in Subway:** Often missing the lock timeout stress test — verify `addSpend()` works correctly under 5+ concurrent callers before declaring complete
- [ ] **Self-heal in Subway:** Often missing verification that the fix plan does NOT over-trigger — verify `buildFixPlan()` returns only scripts that exist in Subway's `package.json`
- [ ] **RLAIF self-scoring:** Often missing tests for the discrete score values — verify tests assert exact scores (`0.8`, `1.0`) not ranges, to make the heuristic nature visible
- [ ] **ContextFS semantic cache:** Often missing expiry validation — verify that entries older than `THUMBGATE_SEMANTIC_CACHE_TTL_SECONDS` are actually evicted on read, not just skipped
- [ ] **Diversity tracking:** Often treated as a display feature — verify diversity scores feed back into the Thompson update path (alpha/beta) rather than just being logged
- [ ] **Test count verification:** PROJECT.md says rlhf has 54 tests — verify count does not decrease after each sync phase; add test count assertion to CI

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| API name collision breaks Subway tests | LOW | Add function alias export; rerun tests; no data loss |
| Schema divergence on rubric fields | MEDIUM | Diff both schemas; add missing fields with backward-compatible defaults; regenerate test fixtures |
| Thompson timestamp NaN corrupts posteriors | HIGH | Restore `feedback_model.json` from last known-good snapshot in `model_snapshots/`; rerun `--train` from raw JSONL |
| LanceDB schema mismatch after version upgrade | HIGH | Drop and recreate the Lance table; reindex from source JSONL; verify row counts match |
| Budget guard undercounts due to lock timeout | LOW | Manually reconcile `budget-ledger.json` entries against known operations; increase lock timeout |
| Self-heal overwrites intentional code | MEDIUM | `git checkout -- <file>` to restore; add the file to a self-heal exclusion list |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| API name collision | Phase 1: Contract mapping audit | Diff `module.exports` across both repos before any code movement |
| Schema divergence on rubric fields | Phase 1 + Phase 2 | `diff scripts/feedback-schema.js` passes cleanly; rubric gate test exists in Subway after sync |
| Thompson timestamp NaN | Phase 3: Thompson Sampling port | Unit test: `parseTimestamp()` handles all 3 observed formats correctly |
| LanceDB platform/version mismatch | Phase 3: LanceDB port | Smoke test: Python creates table, Node.js reads it with correct row count |
| Budget guard lock contention | Phase 4: Budget guard port | Concurrency test: 5 parallel `addSpend()` calls all record correctly |
| Self-heal over-triggers | Phase 5: Self-heal port | Test: `buildFixPlan()` in Subway returns only scripts matching Subway's `package.json` |
| RLAIF label overstates capability | Phase 3: RLAIF port | Function is named `selfAudit` or `constitutionalCheck`, not `selfScore` or `rlaifScore`, in rlhf |
| Unbounded JSONL growth | Any phase touching feedback storage | Add JSONL line count assertion to CI: fail if feedback-log.jsonl exceeds reasonable test size |

---

## Sources

- Direct code inspection: `/Users/ganapolsky_i/workspace/git/igor/rlhf/scripts/` and `/Users/ganapolsky_i/workspace/git/Subway_RN_Demo/scripts/` — HIGH confidence
- Direct inspection: `feedback_model.json` timestamp format variability — HIGH confidence (observed in file)
- [LanceDB GitHub Issue #669: Append with different schema](https://github.com/lancedb/lancedb/issues/669) — MEDIUM confidence (confirmed bug in LanceDB Node.js)
- [LanceDB GitHub Issue #2134: FixedSizeList schema causes errors in v0.16](https://github.com/lancedb/lancedb/issues/2134) — MEDIUM confidence
- [LanceDB Node.js Alpine Docker issue](https://www.andrewmiracle.com/2023/09/13/running-lancedb-with-node-js-express-api-in-docker-containers/) — MEDIUM confidence
- [Node.js race condition prevention with distributed locks](https://dev.to/koistya/preventing-race-conditions-in-nodejs-with-distributed-locks-48fp) — MEDIUM confidence
- Self-heal infinite loop prevention patterns — MEDIUM confidence (multiple sources agree on max-attempts pattern)
- Thompson Sampling beta distribution numerical stability — MEDIUM confidence (Stanford TS Tutorial + community sources)

---
*Pitfalls research for: RLHF Bidirectional Feature Sync*
*Researched: 2026-03-04*
