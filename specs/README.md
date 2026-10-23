# ThumbGate Unified Specifications (`/specs`)

This directory is the single source of truth for **Spec-Driven Development (SDD)** in ThumbGate, unifying feature specifications, data/API contracts, conformance suites, and Architecture Decision Records (ADRs).

## 1. Unified Spec Map

| Surface | Canonical Path | Purpose |
| --- | --- | --- |
| **Feature Specs (`NNN-feature`)** | `specs/NNN-<slug>/{spec.md,plan.md,tasks.md}` | 6-Block EARS SDD specifications (`Constitution -> Specify -> Plan -> Tasks -> Implement -> Verify`) |
| **OpenAPI & Wire Contracts** | [`openapi/`](../openapi/) | Machine-readable HTTP/MCP OpenAPI 3.1 schemas and 6-block envelopes |
| **Provider Conformance Specs** | [`conformance/`](../conformance/) | Deterministic provider-attestation and runtime conformance suites |
| **PreToolUse Gate Rules** | [`rules/`](../rules/) · [`gate-program.md`](../gate-program.md) | Compiled pre-action safety gates and policy invariants |
| **Architecture Decision Records** | [`docs/adr/`](../docs/adr/) | Immutable design decisions written before implementation |
| **Agent Format Steals Index** | [`docs/agents/README.md`](../docs/agents/README.md) | On-demand honesty doctors and architectural format steals |

## 2. Mandatory 6-Block EARS Specification Standard (`spec.md`)

Every feature specification under `specs/NNN-<slug>/spec.md` is validated by `validateSpecDrivenScaffold()` (`scripts/rrsi-doctor.js`) and MUST contain all 6 blocks:

1. **Constitution Reference:** Pointer to the governing invariant in `AGENTS.md` or `THREAT_MODEL.md`.
2. **EARS Acceptance Criteria:** Deterministic clauses in EARS syntax (`WHEN <trigger>, WHILE <precondition>, THE SYSTEM SHALL <response>`).
3. **Explicit Out-of-Scope Boundaries (Non-Goals):** Forbidden scope and anti-patterns.
4. **Locked Architectural Decisions:** Storage, cryptography, and latency constraints (`<5ms` p95 `PreToolUse`).
5. **Worktree-Isolated Atomic Tasks:** Disjoint file-scoped tasks executed in isolated git worktrees.
6. **Adversarial Verification & Postcondition Completeness Probe (PCP) Contract:** Mutated state variables verified by independent tests (`tests/*.test.js`).
