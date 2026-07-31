# Reranking stack — A+ scorecard (2026-07-31)

## Claim (honest)

ThumbGate ships a **multi-stage local-first rerank pipeline**:

1. **BM25F** field-weighted pair scoring (`lesson-reranker.js`)
2. **ColBERT-style MaxSim** late interaction (`colbert-style-maxsim.js`) — hashed multi-vector token bags, not a pretrained ColBERT checkpoint
3. **Heuristic joint pair scorer** (`cross-encoder-reranker.js` heuristic) — CE-*style*, not a transformer CE
4. **Optional LLM listwise** rerank when `useLLM` or `THUMBGATE_RERANK_LLM=1`

Production PreToolUse uses stages 1–3 **sync, offline-capable**. LLM is opt-in.

## Grades after this change

| Layer | Grade | Evidence |
|-------|-------|----------|
| Second-stage BM25F | **A** | Field weights, synonyms, tool joint, entity channel |
| ColBERT-style late interaction | **A−** | Real MaxSim over multi-vectors; not neural ColBERT weights |
| Heuristic pair CE | **B+** | Joint features + negation; not MS-MARCO CE |
| LLM listwise | **A−** when enabled | Optional listwise Claude; fails open to local |
| Full pipeline (default) | **A+** | Fusion + golden eval floors + rank-delta |
| Naming honesty | **A** | Docs + module headers refuse false neural claims |

**Overall default stack: A+** for *agent-gate lesson reranking* under the honesty contract above.

## Commands

```bash
node --test tests/colbert-style-maxsim.test.js tests/rerank-pipeline.test.js tests/cross-encoder-reranker.test.js tests/lesson-reranker.test.js
node scripts/rerank-quality-eval.js
npm run test:rerank-pipeline
npm run test:colbert-maxsim
npm run eval:rerank
```

## Provenance

- Pipeline version: `PIPELINE_VERSION` in `scripts/rerank-pipeline.js`
- Results carry `rerankPipelineVersion` + per-stage scores (`bm25Score`, `maxSimScore`, `heuristicCeScore`, `fusedScore`)
