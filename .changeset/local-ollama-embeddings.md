---
thumbgate: minor
---

Enable local Ollama `nomic-embed-text` (768-dim) as the primary semantic embedding provider, replacing the degraded feature-hash fallback. Adds Nomic-style asymmetric query/document prefixes, exports `normalizeEmbeddingKind`, loads dotenv in the eval entry point, adds `@huggingface/transformers` as an optional secondary local fallback, and configures `THUMBGATE_LOCAL_LLM_ENDPOINT` for local LLM generation via Ollama chat completions.
