---
"thumbgate": minor
---

Real semantic RAG in the per-action gating hot path.

The "learn from the past" core is now literally semantic. Previously the per-action
lesson retrieval that gates tool calls was *commented* "semantically-relevant" but
ran purely lexical scoring (token overlap + bigram Jaccard + BM25); the embedding /
LanceDB vector store existed only for storage. The async gate path (`runAsync`) now
uses **hybrid dense + sparse retrieval**: lexical ranking ⊕ embedding-similarity
ranking → Reciprocal Rank Fusion (k=60) → existing cross-encoder rerank → top-K.

This surfaces past mistakes that share no keywords with the current action
(paraphrase / synonym / different file path) — recall lexical matching cannot give —
so agents are warned about semantically-related failures before executing.

- New `scripts/lesson-embedding-index.js`: cached dense index (vectors keyed by
  `id + sha256(text)`, persisted to `lesson-embeddings.json`; only the query is embedded
  per call, only new/changed lessons re-embed). Reuses `vector-store.embed`
  (Gemini → local transformers → stub) — no new dependency.
- New `retrieveRelevantLessonsAsync` + `reciprocalRankFusion` in `scripts/lesson-retrieval.js`.
- `gates-engine` gains `buildRelevantLessonContextAsync`, wired into `runAsync`.
- Honest degradation: when no real embedder is available (or embedding errors), the
  path returns the identical pure-lexical result. No fabricated vectors, no regression
  to the synchronous `run()` path.
