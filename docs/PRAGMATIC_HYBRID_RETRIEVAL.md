# Pragmatic hybrid retrieval (turbopuffer ideas, local-only)

Source inspiration: [turbopuffer × Pragmatic Engineer](https://turbopuffer.com/pragmatic) and their [hybrid](https://turbopuffer.com/docs/hybrid) / [rank-by-attribute](https://turbopuffer.com/blog/rank-by-attribute) / [continuous recall](https://turbopuffer.com/blog/continuous-recall) guidance.

## What we stole (architecture, not the SaaS)

| turbopuffer idea | ThumbGate implementation |
|------------------|---------------------------|
| Multi-query: vector + BM25 | Lexical list ⊕ optional dense id list |
| RRF fuse ranks | `reciprocalRankFusion` / pragmatic wrapper |
| Attribute in first stage | Recency `Decay` + occurrence `Saturate` + negative signal |
| Second-stage rerank | Existing field-weighted BM25 `rerankLessons` |
| Diversify (`limit.per`) | Cap per domain×tool before top-K |
| Dual features | `hybridFeatures`: rrf, lexicalRank, denseRank, attributeBoost |
| Continuous recall sampling | `sampleRetrievalRecall` → `.thumbgate/retrieval-recall-samples/` |
| Keep logic in app code | `scripts/pragmatic-hybrid-search.js` — no cloud dependency |

## What we did *not* do

- Did not adopt turbopuffer as a dependency or host data off-machine.
- Did not reimplement object-storage ANN or MAXSCORE inverted indexes (corpus is local JSONL + optional LanceDB).

## How it improves us

1. **First-stage recall** — recency/occurrence enter ranking *before* rerank, so yesterday’s force-push lesson is not buried under old lexical-heavy noise.
2. **Hybrid honesty** — dense list is optional; without an embedder we still get attribute-aware lexical + BM25 (no fake vectors).
3. **Diversity** — one domain cannot fill all top-K slots.
4. **Measurable** — ranking golden still runs IR metrics (Recall@k / MRR / nDCG) through this path.
5. **Ops signal** — sampled retrievals for offline continuous recall (turbopuffer spirit).

## Commands

```bash
node --test tests/pragmatic-hybrid-search.test.js
npm run eval:ranking
npm run eval:rag
```
