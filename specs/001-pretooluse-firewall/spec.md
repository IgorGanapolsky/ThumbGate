# Spec 001: Local PreToolUse Infrastructure Firewall & Ed25519 Entitlements

## 1. Constitution Reference
- `AGENTS.md#NEVER-Bypass-Branch-Protection`
- `AGENTS.md#Performance-Budgets` (`pretool_eval_from_state_ms_p95 <= 5ms`)

## 2. EARS Acceptance Criteria
- **WHEN** an autonomous coding agent invokes a mutating tool (`Bash`, `Edit`, `Write`, or MCP tool), **WHILE** `PreToolUse` enforcement is active, **THE SYSTEM SHALL** evaluate compiled local rules and return `ALLOW`, `WARN`, or `DENY` in `<5ms` p95 (`0.038ms` measured).
- **WHEN** an external control plane returns `allow` on a tool call, **WHILE** the local ThumbGate detector evaluates `deny`, **THE SYSTEM SHALL** preserve the local hard `deny` (`localDenyOverridesCentralAllow === true`).
- **WHEN** a caller invokes a Pro-gated model or dataset exporter (`export-dpo`, `export-databricks`, `export-hf-dataset`, `risk-scorer`), **WHILE** `THUMBGATE_ENFORCE_ENTITLEMENTS=1` is set, **THE SYSTEM SHALL** verify an offline Ed25519 signature (`scripts/entitlement.js`) before execution.

## 3. Explicit Out-of-Scope Boundaries (Non-Goals)
- Do NOT route `PreToolUse` hot-path decisions through cloud LLM evaluators or Python 2B model weights (`>100ms` latency).
- Do NOT approve pull requests or bypass branch protection (`--admin`, `--force`).
- Do NOT spend outbound cash (`outboundCashSpendUsd === 0`).

## 4. Locked Architectural Decisions
- Local SQLite + JSONL append-only state with in-memory compiled guard evaluation (`scripts/gates-engine.js`, `scripts/hybrid-feedback-context.js`).
- Offline Ed25519 JWS-like token verification (`scripts/entitlement.js`).

## 5. Worktree-Isolated Atomic Tasks
- `Task 1 (worktrees/tg-slice-1)`: `scripts/gates-engine.js` & `scripts/typed-gate-verdicts.js`
- `Task 2 (worktrees/tg-slice-2)`: `scripts/entitlement.js` & `scripts/license.js`

## 6. Adversarial Verification & PCP Contract
- **Mutated State Variables Constrained:** `effectiveDecision`, `localDenyOverridesCentralAllow`, `entitled`, `outboundCashSpendUsd`.
- **Verification Suite:** `node --test tests/gates-engine.test.js tests/entitlement.test.js tests/rrsi-regularizer.test.js` + `node scripts/perf-budget-check.js --json`.
