# MLOps Audit — 2026-05-12

Read-only audit of ThumbGate's ML / data-pipeline surfaces. Findings are graded by severity. No code changes in this PR — this is the diagnostic doc.

## Scope

| Subsystem | Files audited |
|---|---|
| Lesson DB | `scripts/lesson-db.js`, `scripts/lesson-canonical.js`, `scripts/lesson-search.js`, `scripts/lesson-rotation.js`, `scripts/lesson-reranker.js` |
| Feedback ingest | `scripts/feedback-loop.js`, `scripts/feedback-schema.js`, `scripts/feedback-to-rules.js`, `scripts/feedback-quality.js`, `scripts/semantic-dedup.js` |
| Ranking | `scripts/thompson-sampling.js`, `scripts/bayes-optimal-gate.js`, `scripts/judge-reward-function.js` |
| Training-data export | `scripts/export-dpo-pairs.js`, `scripts/export-hf-dataset.js`, `scripts/export-databricks-bundle.js` |
| Guardrails | `scripts/hallucination-detector.js`, `scripts/reward-hacking-guardrails.js`, `scripts/auto-promote-gates.js` |
| Vector store | LanceDB references in `scripts/feedback-loop.js` |
| Eval | `scripts/eval-harness.js`, `bench/*.json` |

## Verified clean

These are explicit positive findings.

- **Hallucination detector exists** (`scripts/hallucination-detector.js`) — decomposes claims into verifiable sub-claims.
- **Reward-hacking guardrails exist** (`scripts/reward-hacking-guardrails.js`) — flags patterns where proxy metrics get gamed.
- **Eval harness exists** (`scripts/eval-harness.js`) + three bench suites in `bench/`: `thumbgate-bench.json`, `prompt-eval-suite.json`, `programbench-smoke.json`.
- **HF dataset export redacts** path-shaped strings + entry-level PII (`scripts/export-hf-dataset.js:57-65` — `redactPaths`, `redactEntry`).
- **Semantic dedup** runs on negative feedback before gate-promotion (`scripts/semantic-dedup.js` → `deduplicateFeedback`).
- **Lesson canonical-hash** matching tolerates punctuation/wording drift in lesson-text comparison (`scripts/lesson-db.js:193`) — meaningful when the agent paraphrases the same failure across sessions.

## Findings

### Finding 1 — Lesson DB has no schema version (MEDIUM)

**File:** `scripts/lesson-db.js`

The schema creates `lessons`, `lessons_fts`, `sessions`, `sessions_fts` tables and indexes — but no `PRAGMA user_version` set, no `schema_version` column, no migration table. When a future ThumbGate version changes the schema, SQLite has no signal to detect or migrate older databases.

**Failure mode:** A user upgrades from `thumbgate@1.17` → `thumbgate@1.20`. New version adds a column. `CREATE TABLE IF NOT EXISTS` silently keeps the old table (without the column), all subsequent INSERTs reference the missing column, every CLI invocation throws and the user sees the agent silently stop blocking failures.

**Fix sketch:** Set `PRAGMA user_version = N` at startup; add a `runMigrations(currentVersion, targetVersion)` step that applies forward migrations. Same pattern Anthropic, Stripe, every mature SQLite-backed app uses.

**Severity:** Medium — fires on first schema change after this audit. Not currently triggered (schema hasn't changed yet) but inevitable.

---

### Finding 2 — Thompson Sampling is non-deterministic (MEDIUM)

**File:** `scripts/thompson-sampling.js:382, 399, 421-422`

Multiple unseeded `Math.random()` calls in the gamma / beta / normal samplers that drive bandit rankings. Same input → different output across runs.

**Consequences:**
- Tests cannot pin exact ranking order.
- A/B comparisons across releases lose statistical rigor — different "before" and "after" runs of the same data produce different samples.
- The lesson DB's "rank by importance" surface is observed at small N (we have hundreds of lessons, not millions), so sampling variance can flip the top-3 between runs.

**Fix sketch:** Accept a `rng` parameter in the public sampler functions. Default to `Math.random` for production, accept a seeded PRNG (e.g. `seedrandom` package or a tiny xorshift impl) in tests / eval runs. The eval harness in particular needs this — without it, regressions hide in the noise.

**Severity:** Medium — silently weakens every claim about ranking behavior. Worse when the eval harness reports "no regression" because the noise dwarfs the signal.

---

### Finding 3 — No data-drift / quality monitoring (MEDIUM)

**Files:** None — gap. No `kl_divergence`, no PSI (Population Stability Index), no train/eval split tracking. The "drift" hits in grep are about *natural-language wording drift in matching*, not ML data-drift.

**Consequences:** When the agent's failure shape changes (e.g. new tool added to Claude Code, model behavior shifts after Anthropic releases Sonnet 5), there's no signal until either:
- A gate misfires loudly (a buyer complains)
- The lesson DB grows but block-rate stays flat (a silent observability failure that nobody investigates)

**Fix sketch:** Add a weekly cron that computes a "feedback signature" snapshot — counts by tag, by tool_name, by severity, by source — and stores it as `reports/feedback-signatures/YYYY-Wnn.json`. Alert when the signature changes by > 2σ vs the trailing 4-week mean. This is 50 lines of script + a cron entry.

**Severity:** Medium — the gap is invisible until it bites; when it bites, the diagnosis is a multi-hour pull-the-thread session.

---

### Finding 4 — DPO export has weaker PII controls than HF export (MEDIUM)

**File:** `scripts/export-dpo-pairs.js` vs `scripts/export-hf-dataset.js`

The HF export pipeline runs both `redactPaths` and `redactEntry` (`export-hf-dataset.js:57-65`). The DPO pipeline doesn't appear to apply either — `grep -nE "PII|redact|scrub" scripts/export-dpo-pairs.js` returns zero matches in the redaction sense.

**Risk:** Users can `npm run feedback:export:dpo` and get a JSONL file containing customer emails, file paths, API key patterns, or other PII embedded in `context` / `whatWentWrong` strings. If they upload that to HuggingFace or fine-tune a model on it, the data leaks downstream.

**Fix sketch:** Move the redaction helpers into a shared `scripts/training-data-redaction.js` module. Call from both exporters. Add a `tests/training-data-pii.test.js` that injects known PII patterns into a fixture feedback log and asserts redacted in both outputs.

**Severity:** Medium — Pro buyers will eventually use this; first leak destroys trust.

---

### Finding 5 — No A/B infrastructure for gate-behavior changes (MEDIUM)

**Files:** N/A — gap. Today's `WARN_THRESHOLD 2→1` change (PR #1881) shipped to 100% of installs at once. No control cohort, no canary, no rollback signal.

**Consequences:** Every gate-behavior change is a uncontrolled deploy. If the new behavior degrades activation (e.g. spurious gates make users uninstall), we discover it via churn, not via a per-cohort metric.

**Fix sketch:** Add a `scripts/cohort-router.js` that hashes the `installId` into N buckets and returns a feature-flag boolean. Use it once for the next gate-behavior change (e.g. WARN_THRESHOLD tunable per cohort) and compare 7-day block-rate + 7-day churn between cohorts. Don't build a full Optimizely — just an installId-hash-to-bucket function and a `reports/cohort-experiments/<name>.json` ledger.

**Severity:** Medium — every blind ship is a coin-flip on whether the rollback signal arrives before damage spreads.

---

### Finding 6 — JSONL feedback/memory logs have no schema version (LOW-MEDIUM)

**Files:** `scripts/feedback-loop.js` writes entries to feedback-log.jsonl and memory-log.jsonl. No `schemaVersion: N` field in the JSONL row.

**Consequences:** When the entry shape changes (it already has, multiple times this year — `_clusterCount`, `_mergedTags`, `diagnosis.rootCauseCategory` all added without a version bump), older readers silently mis-parse.

**Fix sketch:** Add `_v: 1` to every emitted feedback/memory entry. Readers can check `_v` and apply migration logic. Cheap and additive.

**Severity:** Low-medium — fires only when old + new shapes co-exist (e.g. a user upgrades ThumbGate mid-session and the new code reads the old session's entries).

---

### Finding 7 — Feedback IDs use timestamp + Math.random() (LOW)

**Files:** `scripts/feedback-loop.js:394, 1016, 1180` — IDs like `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`.

The 6-char base36 suffix gives ~2^31 possibilities — collision probability is low but non-zero. If dedup logic ever relies on ID-equality across machines (e.g. a Team-tier shared lesson DB), collisions become real.

**Fix sketch:** Use `crypto.randomUUID()` for unique IDs. Keep the timestamp prefix only if needed for human inspection. ~10-character change.

**Severity:** Low — currently single-machine. Becomes Medium when the Team-tier shared lesson DB ships.

---

### Finding 8 — No model-version compatibility ledger for downstream DPO consumers (MEDIUM)

**Files:** None — gap.

A user who ran `feedback:export:dpo` on ThumbGate v1.10 gets a JSONL with shape A. The same command on v1.17 produces shape B (added `failureType`, `decisionEvidence`, etc.). Their HuggingFace fine-tune trained on the v1.10 export now mis-aligns when they retrain on the v1.17 export.

**Fix sketch:** Add a `schema_version` and `thumbgate_version` field to the top of every exported JSONL bundle (DPO + HF + Databricks). Document the migration matrix in `docs/training-data-versioning.md`. Even three lines of metadata at export time + a one-page doc unblocks downstream re-training without ambiguity.

**Severity:** Medium — affects every paying Pro customer who uses the DPO export feature.

## Decision recommendations

| Finding | Effort | Ship now / next month / next quarter |
|---|---|---|
| 1 — Lesson DB schema version | 1 PR, ~50 lines | **Next month** (before any schema change) |
| 2 — Thompson Sampling determinism | 1 PR, ~80 lines | **Next month** (unblocks eval-harness signal) |
| 3 — Data-drift monitoring | 1 PR, ~150 lines + cron | **Next quarter** (won't bite until volume grows) |
| 4 — DPO PII redaction | 1 PR, ~100 lines | **Next month** (Pro customers actively use this surface) |
| 5 — A/B cohort router | 1 PR, ~200 lines + ledger format | **Next quarter** (need a real change to A/B first) |
| 6 — JSONL `_v` field | 1 PR, ~30 lines (additive only) | **Next month** |
| 7 — UUID feedback IDs | 1 PR, ~20 lines | **When Team tier ships shared DB** |
| 8 — DPO/HF/Databricks schema ledger | 1 PR, ~50 lines + doc | **Next month** (alongside finding 1 + 4) |

Total backlog: ~8 PRs, none individually large. Cluster 1+2+4+6+8 into a "MLOps Q3" batch.

## Out of scope for this audit

These weren't audited and are explicitly NOT claimed clean:

- LanceDB write durability / corruption recovery
- ContextFS performance + memory ceiling at large lesson counts
- Bayes-optimal gate's posterior-update math (correctness of formulas — needs a stats reviewer, not a code grep)
- Whether DPO pair quality (the actual chosen/rejected pairs) produces a model that's measurably better on held-out evals
- Privacy posture when Team-tier shared lesson DB ships (different threat model)
