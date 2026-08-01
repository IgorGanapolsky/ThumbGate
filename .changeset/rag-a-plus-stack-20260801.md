---
"thumbgate": minor
---

feat(rag): A+ hybrid stack — multi-stage rerank, quality-tier honesty, unified eval floors

Production retrieval now ships with BM25F → ColBERT-style MaxSim → heuristic pair CE fusion on the PreToolUse path, offline IR + generation quality suite (`npm run eval:quality`) that gates A+ floors, retrieval quality-tier honesty so feature-hash never claims semantic search, dashboard request envelopes + hard tier budgets, and state-backup coverage for LanceDB directories. README embedding claims align with the real cascade (Ollama / Gemini Embedding 2 / MiniLM, not bge-small).
