---
"thumbgate": minor
---

Add cross-encoder reranker to lesson retrieval pipeline (Advanced RAG)

Introduces `scripts/lesson-reranker.js` — a field-weighted BM25F cross-encoder
that processes (query, lesson) pairs jointly rather than independently:

- **Field weighting**: query terms in `whatWentWrong` (weight 3.0) contribute
  more than the same term in `tags` (weight 0.4), catching field-specific
  relevance that bi-encoders miss
- **Synonym expansion**: "deploy" ↔ "deployment/release/publish", "force-push"
  ↔ "git push --force", ".env" ↔ "secret/dotenv", and 8 more synonym clusters
- **Signal coherence**: failure-sounding queries boost negative-signal lessons
  by 1.2× so the right cautionary lesson surfaces first
- **Tool name joint scoring**: exact tool match in `metadata.toolsUsed` adds
  a 1.3× ranking bonus
- **Score blending**: final score = 0.7 × normalised BM25 + 0.3 × original
  bi-encoder score so retrieval signal is never fully discarded

The pipeline is now two-stage: bi-encoder retrieves top-50 candidates, then
the cross-encoder reranks and returns top-K. Both the PreToolUse hook path
(`lesson-retrieval.js`) and the MCP `search_lessons` path (`lesson-search.js`)
use the reranker.
