# ADR-001: Local-First `<0.5ms` PreToolUse Firewall & Unified `/specs` Architecture

- **Status:** Accepted
- **Date:** 2026-10-23

## Context
1. Autonomous coding agents (Claude Code, Cursor, Codex, Gemini, MCP servers) execute tool calls at inference speed (where adversary or rogue-agent breakout takes as little as 27 seconds). Cloud observability proxies (`80ms–279ms`) and oversized instruction files (`AGENTS.md > 3,000 words`) fail to prevent destructive actions at $T=0$.
2. External architectural reviews highlighted two structural gaps in the repository:
   - `AGENTS.md` had grown to `5,479` words (`44.6 KB`), diluting core invariants with 25+ reference command blocks.
   - Specification artifacts were split across `openapi/`, `conformance/`, `WORKFLOW.md`, and `docs/agents/` without a unified root `specs/` directory or ADR log.

## Decision
1. **Sub-Millisecond Local `PreToolUse` Enforcement:** Keep all `PreToolUse` decisions on local CPU (`p95 < 0.06ms` warm state) backed by local SQLite/JSONL and offline Ed25519 entitlements (`scripts/entitlement.js`). Central control planes (`scripts/typed-gate-verdicts.js`) receive redacted evidence and handle human approval queues, but a central `allow` can never override a local hard `deny`.
2. **Unified `/specs` Root & 6-Block EARS Standard:** Establish `/specs` (`specs/README.md`, `specs/NNN-<feature>/spec.md`) as the canonical entrypoint for Spec-Driven Development, validated by `validateSpecDrivenScaffold()` and fed automatically from production `👎` feedback via `promoteFeedbackToSddSpec()`.
3. **`AGENTS.md` Word-Budget Ceiling (`<= 3,000` Words):** Keep `AGENTS.md` focused strictly on non-negotiable operational, safety, and verification invariants (`< 2,000` words), moving reference catalog blocks to `docs/agents/README.md`.

## Consequences
- Every new `feat:` PR traces to a 6-block EARS specification under `specs/` and co-commits a deterministic test.
- `AGENTS.md` remains well inside the `<= 3,000`-word adherence budget enforced by `evaluateOuterHarnessRuleTestCoCommitAndContextEditor()`.
