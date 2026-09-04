---
name: graphify
description: >
  Query the local Graphify-Labs AST knowledge graph for ThumbGate architecture
  questions (what connects X to Y, explain a symbol, PreToolUse/gates/adapters).
  Slash: /graphify.
---

# Graphify — ThumbGate rail (Graphify-Labs)

Upstream package: **graphifyy** ([Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify)).  
This repo wires it locally. We do **not** clone Graphify into a ThumbGate SKU.

## Setup / readiness

```bash
npm run graphify:setup
npm run graphify:ready -- --require-graph
npm run graphify:stale
```

Binary: `.graphify-venv/bin/graphify`  
Graph: `graphify-out/graph.json` (gitignored runtime)

## Query first

When the graph exists, prefer these over raw grep for architecture:

```bash
.graphify-venv/bin/graphify query "<question>"
.graphify-venv/bin/graphify path "<A>" "<B>"
.graphify-venv/bin/graphify explain "<concept>"
.graphify-venv/bin/graphify god-nodes --top 10
```

Refresh after large pulls: `.graphify-venv/bin/graphify update . --no-cluster`

## Never

- Treat `graph.html` as retrieval
- Claim a vector store
- Dual-edit DIRTY lesson-store graph PR #3650
- Ship Graphify as a paid ThumbGate feature without counsel clearance

## Detail

- `docs/agents/code-search.md`
- Upstream skill references (if present): `.agents/skills/graphify/references/`
