---
'thumbgate': patch
---

Recognize Gemini embedding provider automatically when `GEMINI_API_KEY` is
present, even without `THUMBGATE_EMBED_PROVIDER=gemini`. The key activates
Gemini as an automatic fallback after Ollama without changing the primary
local path. Also exports `getActiveEmbeddingProfile` as an alias for
`getLastEmbeddingProfile`, and adds `claw-style`, `hybrid-inference`, and
`agent-identity` tag inference rules to the feedback schema for claw-style
enterprise agent governance capture.
