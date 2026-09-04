# Code search — grep + Graphify

ThumbGate uses **Graphify-Labs/graphify** (PyPI package `graphifyy`, CLI `graphify`) for a **local AST knowledge graph**. This is not a vector index and not a ThumbGate product SKU.

Upstream: https://github.com/Graphify-Labs/graphify

## Setup (once per clone)

```bash
npm run graphify:setup
# creates .graphify-venv/ (gitignored) and builds graphify-out/graph.json (gitignored)
npm run graphify:ready -- --require-graph
```

## When to use Graphify

Prefer these when `graphify-out/graph.json` exists:

```bash
.graphify-venv/bin/graphify query "how does PreToolUse gate check work?"
.graphify-venv/bin/graphify path "gates-engine.js" "session-lease.js"
.graphify-venv/bin/graphify explain "createApiServer"
.graphify-venv/bin/graphify god-nodes --top 10
```

Use standard Grep/Glob for exact strings and path globs. Use Graphify for architecture / causality / “what connects X to Y”.

## Honesty rules

| Claim | Truth |
|-------|--------|
| Edge tags | Upstream marks `EXTRACTED` vs `INFERRED` |
| LLM for code AST | **0** — tree-sitter local |
| Docs/PDF/image semantic pass | Optional; requires a configured backend — do not enable silently |
| `graph.html` | Visualization only — not retrieval |
| Lesson-store graph (#3650) | Separate ThumbGate lesson DB feature — do not dual-edit that DIRTY PR |

## Refresh

```bash
.graphify-venv/bin/graphify update . --no-cluster
npm run graphify:stale
```

After large pulls, refresh before trusting path/query answers.

## Related

- `npm run graphify:ready` → `scripts/graphify-readiness.js`
- `npm run graphify:stale` → `scripts/graphify-staleness-check.js`
- Fleet skill: `/knowledge-graph-fuse` (fuse search hits with bounded traversal; do not treat HTML as retrieval)
