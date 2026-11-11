# ReAct GraphRAG eval: MoE router, JIT compactor, stdio gate_check

Dispatch task MAC-20261111-04 (lane-graphrag-mcp).

## Problem

A GraphRAG agent that writes Cypher can write to the graph, query labels the
schema never declared, or loop forever on a failing step. None of that was
checked before the query ran, and ThumbGate's `gate_check` was not in the path.

## Technical plan

`runner.js` runs a ReAct loop as an explicit state machine:
`THOUGHT -> COMPACT -> ROUTE -> GATE -> ACT -> OBSERVE`, ending a step in
`DONE`, `FAILED` or `SKIPPED`.

- **Read-only Cypher deny check**: CREATE, MERGE, DELETE, DETACH, SET, REMOVE,
  DROP, FOREACH, LOAD CSV, IN TRANSACTIONS, `apoc.*`, `dbms.*` and any CALL
  other than `db.labels`, `db.relationshipTypes`, `db.schema.visualization`
  are denied. String literals and comments are stripped first.
- **Schema-first Cypher gate**: every node label and relationship type in the
  query must be in the declared schema. Queries with no typed node pattern or
  with backtick identifiers are denied.
- **stdio `gate_check`**: the query is then sent as `graph_query` to
  `thumbgate serve` over JSON-RPC stdio. Only `allow` runs it; `warn`, `block`
  and `error` fail closed.
- **3-attempt topological fail-safe**: steps run in dependency order (Kahn's
  algorithm). A cycle or unknown dependency fails before anything runs. Each
  step gets at most 3 attempts, the planner sees the last error, then the step
  fails closed and its dependents are skipped with the reason.
- **Dual-stack MoE router**: `classifyTask` from `scripts/model-tier-router.js`
  picks a tier; `frontier` and `bulkCloud` map to the frontier stack, every
  other tier to the local stack. High risk plus retries escalates to frontier.
- **JIT context compactor**: before each attempt, context is trimmed to the
  step's token budget. Pinned items (goal, upstream observations) stay, others
  are kept by priority then recency, the rest are dropped and reported.

## Alternatives rejected

- A Cypher parser dependency: adds to the bundle; the deny list fails closed.
- A new router: `model-tier-router.js` already has deterministic rules.

## Files

- `evals/graphrag-moe-jit/runner.js`, `fixture.js`, `SPEC.md`
- `tests/graphrag-moe-jit-evals.test.js`
- `GEMINI.md` (usage section), `package.json` (test registration)
