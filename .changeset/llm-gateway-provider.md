---
"thumbgate": minor
---

Add an OpenAI-compatible gateway provider so LLM capabilities work without an Anthropic key.

Six runtime scripts gated on `ANTHROPIC_API_KEY` — `cross-encoder-reranker`, `eval-rag`, `self-distill-agent`, `secret-scanner`, `tool-registry`, `llm-client` — and every one degraded to heuristics **silently** when it was absent. `isAvailable()` was literally `Boolean(process.env.ANTHROPIC_API_KEY)`, so an operator paying for GLM or Kimi through a local gateway got the heuristic path with no indication the model tier was never consulted.

`llm-client` now falls back to any OpenAI-compatible endpoint (LiteLLM, vLLM, Ollama `/v1`, LM Studio) when no Anthropic client is available:

- `THUMBGATE_LLM_GATEWAY_URL` — enables the provider. Unset means no gateway; a published install never calls localhost because a port is open.
- `THUMBGATE_LLM_GATEWAY_MODEL` — defaults to `glm-5.2`.
- `THUMBGATE_LLM_GATEWAY_TOKEN` — optional; local gateways usually need none. Read at call time, never retained.

`describeInferenceAvailability()` reports **which** provider is live (`anthropic` / `gateway` / `none`, with a reason), so callers can report an honest scoring mode instead of inferring from a key's presence.

**Reasoning-model handling.** Models like GLM and Kimi split the response: `reasoning_content` holds the scratchpad, `content` holds the answer. Two empty-content cases that must not be conflated:

- `finish_reason: 'length'` — truncated mid-reasoning, the answer does not exist yet. Returns `null` so the caller falls back deterministically. Returning the scratchpad here would hand it confident-looking garbage.
- `finish_reason: 'stop'` — the model finished but emitted everything in the reasoning channel; that text is the answer.

Verified live against a LiteLLM gateway: `glm-5.2` returned `[0.9, 0.1]` for a relevance-scoring prompt (71 tokens, 23 cached), and the truncated variant correctly returned `null`.

No new dependency — the gateway contract is a single POST, and a security product's runtime needs a better reason than convenience to grow its supply chain.
