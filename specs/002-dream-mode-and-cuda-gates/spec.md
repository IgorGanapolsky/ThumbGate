# Spec 002: Dream Mode Memory Consolidation, CUDA SIMT Gate Batching & Feedback-to-Spec Promotion

## 1. Constitution Reference
- `AGENTS.md#Local-Memory-Only`
- `AGENTS.md#Performance-Budgets`

## 2. EARS Acceptance Criteria
- **WHEN** 24 hours and 5 active sessions have elapsed (or `/dream` is invoked), **WHILE** operating inside the read-only source-code sandbox with a single-instance lock, **THE SYSTEM SHALL** deduplicate memory entries, resolve contradictions, normalize relative dates to ISO `YYYY-MM-DD`, and write to a cloned staging file at `$0` token cost (`scripts/thumbgate-dream.js`).
- **WHEN** a user ends a conversation after $\ge 2$ consecutive trailing `👎` signals without a verified fix, **WHILE** recording session telemetry, **THE SYSTEM SHALL** classify the exit as `FRUSTRATION_ABANDONMENT_CONTINUOUS_THUMBS_DOWN` and promote the failure into a 6-block EARS SDD specification (`promoteFeedbackToSddSpec`).
- **WHEN** evaluating batch tool calls across gate categories, **WHILE** using SIMT-aligned 32-lane warp batching and Gold semantic-layer pushdown, **THE SYSTEM SHALL** evaluate all categories without raw table scans (`scripts/cuda-gate-batch.js`, `scripts/gate-semantic-layer.js`).

## 3. Explicit Out-of-Scope Boundaries (Non-Goals)
- Do NOT allow Dream Mode to mutate source code, config files, or tests (`readOnlySourceCodeSandbox === true`).
- Do NOT fire background paid LLM API calls during Dream consolidation (`backgroundTokenSpendUsd === 0`).
- Do NOT allow data agents to run `SELECT *` into in-memory Pandas or lock LLM judges before $\ge 20$ manual row-by-row inspections.

## 4. Locked Architectural Decisions
- Non-destructive cloned staging output (`.thumbgate/dreams/` / `.thumbgate/dream-consolidated-memory.jsonl`).
- Deterministic Gold semantic layer (`scripts/gate-semantic-layer.js`) + SIMT batch evaluator (`scripts/cuda-gate-batch.js`).

## 5. Worktree-Isolated Atomic Tasks
- `Task 1 (worktrees/tg-dream)`: `scripts/thumbgate-dream.js` & `tests/thumbgate-dream.test.js`
- `Task 2 (worktrees/tg-cuda-gold)`: `scripts/cuda-gate-batch.js`, `scripts/gate-semantic-layer.js`, `scripts/rrsi-doctor.js`

## 6. Adversarial Verification & PCP Contract
- **Mutated State Variables Constrained:** `consolidatedEntryCount`, `backgroundTokenSpendUsd`, `promotedToSpec`, `earsAcceptanceCriteria`, `explicitOutOfScopeBoundaries`.
- **Verification Suite:** `node --test tests/thumbgate-dream.test.js tests/cuda-gate-batch.test.js tests/rrsi-regularizer.test.js`.
