# Defended RAG pipeline (end-to-end)

**Proof command:**
```bash
node scripts/defended-rag-pipeline.js
node --test tests/defended-rag-pipeline.test.js
```

## Architecture (defended)

```
capture 👎
  → normalize / quality-gate          (feedback-quality.js)
  → store lesson                      (JSONL always; SQLite FTS5 when promotable)
  → retrieve: pragmatic-hybrid-search (keyword + bigram-Jaccard)
  → multi-query ≤3 variants           only when top lexical < 0.6
  → rerank: cross-encoder             LLM if key present (async), else heuristic
  → assemble context                  deterministic text block
  → gate next tool call               allow | warn | block (deterministic)
```

## Why each stage exists

| Stage | Defense |
|-------|---------|
| Quality-gate on 👎 | Vague “thumbs down” is **logged, not promoted** — prevents junk rules |
| SQLite FTS5 store | Durable ranked search; JSONL remains the PreToolUse source of truth |
| Keyword + bigram-Jaccard | Hot-path lexical without requiring embeddings |
| Multi-query only if top &lt; 0.6 | Avoids query fan-out cost when a hit is already strong |
| Cross-encoder rerank | Joint (query, lesson) scoring; LLM optional, heuristic default |
| Deterministic gate | PreToolUse cannot depend on non-deterministic LLM for allow/block |

## Modules

| File | Role |
|------|------|
| `scripts/feedback-quality.js` | Normalize signal; assess promotability |
| `scripts/feedback-loop.js` | `captureFeedback` write path |
| `scripts/lesson-db.js` | SQLite FTS5 upsert/search |
| `scripts/pragmatic-hybrid-search.js` | Keyword + bigram + multi-query RRF |
| `scripts/cross-encoder-reranker.js` | Heuristic / LLM rerank |
| `scripts/defended-rag-pipeline.js` | Orchestrator + `defendPipeline()` proof |
| `scripts/hook-pre-tool-use.js` | PreToolUse uses defended retrieve path |

## Multi-query policy

- **Threshold:** `0.6` (`DEFAULT_LEXICAL_THRESHOLD`)
- **Max variants:** `3` (original, synonym-normalized, tool-focused tokens)
- **Fusion:** Reciprocal Rank Fusion (k=60) when multi-query engages
- **When top ≥ 0.6:** single-query only (latency defense)

## PreToolUse

`hook-pre-tool-use.js` → `retrieveAndGate` (defended) → lessons injected as reminders → risk tags may **block** / strong negative match may **warn** → default **allow**. Fail-open on unexpected errors (hook must not brick the agent).

## Honesty bounds

- Dense embeddings are **optional** (`retrieveRelevantLessonsAsync`); PreToolUse stays lexical+heuristic.
- FTS5 boost is best-effort; missing sqlite degrades cleanly.
- LLM cross-encoder only on async path when `ANTHROPIC_API_KEY` is present.
