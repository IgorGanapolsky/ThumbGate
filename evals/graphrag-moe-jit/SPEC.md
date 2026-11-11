# ReAct GraphRAG eval behind stdio gate_check

Dispatch task MAC-20261111-04 (lane-graphrag-mcp).

## Problem

`scripts/agentic-prompt-pipelines.js` already has the ReAct GraphRAG loop,
the Claude/Gemini expert router and the JIT context trimmer. Two gaps:
its schema-first rule only checks that `get_graph_schema` was called, not
that a query's labels exist, and no graph query passed through ThumbGate's
own `gate_check`.

## Technical plan

`runner.js` reuses the pipelines and adds a gated graph-tool wrapper. Per eval case:

1. **JIT compactor**: `trimContextJustInTime` with model calls disabled, so
   only the deterministic pass runs (noise and duplicate lines dropped, error
   lines and stack frames kept verbatim).
2. **Dual-stack MoE router**: `routeWorkload` with model calls disabled, so
   the Claude/Gemini rules decide, or the safe fallback picks Claude.
3. **ReAct GraphRAG**: `runGraphRagTraversal` with scripted model turns.
   Each Cypher query passes, in order:
   - the pipeline's read-only deny check (CREATE, MERGE, DELETE, DETACH, SET,
     REMOVE, DROP, FOREACH, LOAD CSV, IN TRANSACTIONS, CALL subqueries, any
     procedure outside the read allow list such as `apoc.*` and `dbms.*`);
   - the **schema-first Cypher gate** (new): every node label and relationship
     type must be in the schema `get_graph_schema` returned; untyped patterns
     and backtick identifiers are denied;
   - **`gate_check` over stdio** (new): `thumbgate serve` is asked about
     `graph_query`. Only `allow` runs the query; `warn`, `block`, `error` throw.
   Semantic searches also go through `gate_check`.
4. **3-attempt fail-safe**: every denial or empty result is a failed attempt;
   the pipeline halts after 3 and reports the missing link.

## Alternatives rejected

- A second router/compactor/ReAct loop in `evals/`: the pipeline already has them.
- A Cypher parser dependency: it would grow the bundle; the checks fail closed.

## Files

- `evals/graphrag-moe-jit/runner.js`, `fixture.js`, `SPEC.md`
- `tests/graphrag-moe-jit-evals.test.js`
- `GEMINI.md` (usage section), `package.json` (test registration), `.changeset/`
