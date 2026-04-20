---
"thumbgate": minor
---

Agentic-engineering Leader Agent endpoints: completion gate, swarm coordinator, and unified observability.

Adds three MCP tools that lift ThumbGate from a bag of primitives into a Leader-Agent coordination layer (per the LangChain agentic-engineering framing — worker agents consume, leader endpoints coordinate and verify):

- `require_evidence_for_claim` — completion gate. Wraps `verifyClaimEvidence` with a first-class `blocking` boolean and mode (`blocking` default, `advisory`). Records the decision to the audit trail under `gateId: completion_claim`. Agents call this before declaring done/fixed/shipped; hooks honor the blocking flag to stop evidence-free completion claims.
- `distribute_context_to_agents` — swarm coordinator. Constructs one context pack via `constructContextPack` and records a `context_pack_distributed` provenance event per named agent (dedup'd, capped at `MAX_AGENTS=32`, TTL defaults to 15 minutes). Replaces N independent context derivations by auto-agents (perplexity-bug-resolver, codex-reviewer, grok-x-intelligence, etc.) with one shared pack.
- `session_report` — unified observability rollup. Aggregates feedback stats, gate stats, and windowed provenance into a single LangSmith-style report. `windowHours` clamps to `[1, 720]`; invalid/missing input falls back to the 24h default. Errors in any section are isolated via a per-section `errors` map so one broken source doesn't sink the report.

Exposed in `default`, `essential`, `readonly`, and `dispatch` MCP profiles. No OpenAPI surface changes (MCP-only). Ships with 24 new tests across `tests/swarm-coordinator.test.js`, `tests/session-report.test.js`, and `tests/require-evidence-gate.test.js`; regression runs clean across `test:api` (834), `test:gates` (198), `test:tool-registry` (11), `test:proof` (96), `test:deployment` (55), `test:e2e` (29), `test:workflow` (98), `test:schema` (8), and `test:mcp-config` (9).
