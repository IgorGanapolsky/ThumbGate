# Always-fused graph retrieval

Source: Cekikj, [Making the Knowledge Layer a Graph You Actually Traverse](https://towardsdatascience.com/making-the-knowledge-layer-a-graph-you-actually-traverse/) (TDS 2026-08-20).

Not Azure. Not Cosmos Gremlin. Complementary to PR #3647 `knowledge-layer-plan.js` (do not dual-edit).

## Steal

1. Retrieval quality is a **system** property. No wiki-first / search-only caller mode.
2. Fixed pipeline: search anchors → 1–2 hop traverse → RRF union.
3. Time is a **filter** on edges (`validFrom`/`validTo`), not a third engine. graphify AST edges with no window are labeled unspecified.
4. `CONTRADICTS` → decline to settle.
5. Two-threshold entity resolution (auto / review / new). No LLM in this prototype.
6. Ablation vs search-only is the acceptance test for whether the graph earned its cost.

## Do not

Clone Ostermere, Foundry, change-feed workers, or insurance ontologies.
