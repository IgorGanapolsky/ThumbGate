# Reranking scorecard and A+ target

## Current claim

ThumbGate ships a multi-stage local-first reranking path:

1. BM25F field-weighted scoring (`lesson-reranker.js`)
2. ColBERT-style MaxSim over hashed token bags (`colbert-style-maxsim.js`)
3. deterministic pairwise heuristic (`cross-encoder-reranker.js`)
4. optional caller-supplied neural token embedder and pair scorer
5. optional LLM listwise scorer with opaque IDs and strict output validation

The default PreToolUse path runs stages 1–3 synchronously. A hashed MaxSim
operator is not a pretrained ColBERT model, and a deterministic joint scorer is
not a neural cross-encoder. The output keeps `pairwiseHeuristicScore`,
`lateInteractionScore`, and `crossEncoderScore` distinct so fallback behavior
cannot masquerade as model quality.

## Evidence-grade score

| Layer | Current grade | What is verified | A+ requirement |
|---|:---:|---|---|
| BM25F | A | fields, aliases, tool and entity channels | external query holdout |
| Hashed MaxSim | B+ | real late-interaction operator, deterministic regression | pretrained token embeddings on a labeled holdout |
| Pairwise heuristic | B+ | negation and joint query-document features | true neural pair scorer on a labeled holdout |
| LLM listwise | B+ | ID binding, full-coverage validation, safe fallback | live-provider injection, malformed-output, timeout, cost, and quality holdouts |
| Default production wiring | A | BM25F, hashed MaxSim, and pairwise fusion run from PreToolUse | live latency and retrieval-delta traces |
| Overall | **A−** | strong deterministic local cascade | all provider-holdout and live-production checks above |

The three-case rerank golden is a regression tripwire, not evidence for broad
generalization. Global A+/10 remains blocked by
`npm run score:a-plus -- --require-a-plus` until the provider and production
evidence surfaces pass.

## Commands

```bash
node --test tests/colbert-style-maxsim.test.js tests/rerank-pipeline.test.js
node --test tests/cross-encoder-reranker.test.js tests/lesson-reranker.test.js
npm run eval:rerank
npm run score:a-plus
```

Pipeline results carry a pinned `rerankPipelineVersion`, per-stage scores,
stage names, fallbacks, and rank-delta provenance.
