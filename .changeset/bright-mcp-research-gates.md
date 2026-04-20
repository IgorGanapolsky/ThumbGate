---
"thumbgate": minor
---

Add high-ROI MCP agent-discovery and research-loop surfaces.

- Publish progressive MCP discovery manifests under `.well-known/mcp`, including a compact tool index, per-tool schema URLs, skill manifests, and application manifests so AI agents and crawlers can load ThumbGate without stuffing every tool into context.
- Add `run_autoresearch` as a bounded MCP tool for Shopify-style baseline, hypothesis, holdout, and keep/discard loops around revenue and reliability metrics.
- Add `plan_multimodal_retrieval` so operators can plan screenshot, PDF, dashboard, and proof-artifact retrieval using multimodal sentence-transformer guidance, Matryoshka-style dimensions, reranker metrics, and hard-negative holdouts before spending GPU time.
