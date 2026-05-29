# Semantic RAG in the per-action hot path

**Date:** 2026-05-29
**Branch:** `feat/semantic-rag-hotpath`
**Goal:** Make the "learn from the past" claim literally true. Today the per-action
lesson retrieval that gates tool calls is *commented* "semantically-relevant" but is
purely lexical (token overlap + bigram Jaccard + BM25). The real embedding/LanceDB
vector store already exists (`scripts/vector-store.js`) but is only wired into storage
and `filesystem-search`, never the gating retrieval. This change wires dense retrieval
into the hot path as **hybrid dense+sparse → rank fusion → cross-encoder rerank**, with
full lexical fallback (zero regression when embeddings are unavailable).

## Architecture decisions

- **Why hybrid, not pure dense:** Sparse (BM25/lexical) is precise on exact tokens
  (tool names, file paths, `rm -rf`); dense recalls paraphrases/synonyms lexical misses.
  Reciprocal Rank Fusion (RRF, k=60) is scale-free — no score normalization needed
  across the two retrievers, and it is the industry-standard fusion for this exact case.
- **Why an async sibling, not replacing the sync path:** `buildRelevantLessonContext`
  and `retrieveRelevantLessons` are SYNCHRONOUS and called from the sync `run()` gate
  entry. Embeddings are async (model load / Gemini fetch). The gate engine already has
  an async entry (`runAsync` → `evaluateGatesAsync`). So: add `retrieveRelevantLessonsAsync`
  + `buildRelevantLessonContextAsync`, wire them into `runAsync` only. Sync path stays
  lexical. No behavior change for sync callers.
- **Why a persistent embedding cache:** Embedding the whole lesson corpus on every tool
  call is too expensive. `lesson-embedding-index.js` caches doc vectors keyed by
  `id + sha1(text)` in `<feedbackDir>/lesson-embeddings.json`; only the query is embedded
  per call, and only changed/new lessons are re-embedded. Amortizes to ~1 embed/action.
- **Embedder reuse:** delegates to `vector-store.embed()` (Gemini → local transformers →
  stub), now exported. No new embedding dependency.
- **No fake semantics (honesty):** when no real embedder is available
  (`isEmbedderAvailable()` false) or any embedding error occurs, the async path returns
  the existing lexical result. We never synthesize hash-based pseudo-embeddings — that
  would be overclaiming. Degrade to lexical, transparently.

## Assumptions

- VERIFIED: `runAsync` is the async gate entry and already builds lesson context.
- VERIFIED: `vector-store.embed` supports `THUMBGATE_VECTOR_STUB_EMBED=true` (deterministic
  384-dim vector) — used by tests so CI needs no model download.
- VERIFIED: memory-log.jsonl is the corpus the hot path reads (not feedback-log.jsonl).
- UNVERIFIED (runtime): real local-transformer embeddings improve recall on the live
  lesson DB. Validated structurally via tests (semantic surfaces a lexical-miss); live
  uplift to be confirmed against production memory-log.

## Tradeoffs / rejected alternatives

- Rejected: synchronous query embedding (would block the hot path / require bundling a
  model into sync code). Async sibling is cleaner and the async gate path already exists.
- Rejected: routing through `filesystem-search.searchSimilar` (it is lexical-only — no
  embeddings). Used `vector-store.embed` directly for true dense scoring.
- Rejected: replacing the cross-encoder reranker. Kept it as the final stage — fusion
  feeds it a better candidate pool.

## Files touched

- `scripts/vector-store.js` — export `embed` (additive).
- `scripts/lesson-embedding-index.js` — NEW: cached dense index + cosine + availability.
- `scripts/lesson-retrieval.js` — add `retrieveRelevantLessonsAsync` + `reciprocalRankFusion`.
- `scripts/gates-engine.js` — add `buildRelevantLessonContextAsync`, use it in `runAsync`.
- `tests/lesson-semantic-retrieval.test.js` — NEW.
- `package.json` — add `test:lesson-semantic-retrieval`.
