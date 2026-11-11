---
"thumbgate": patch
---

`dispatchWorkload` in `scripts/agentic-prompt-pipelines.js` now fails over across providers (Claude <-> Gemini) when an expert call errors or its output fails an optional `validateOutput` schema check (`requireJsonObject(keys)` helper included). Fallback hops are capped per dispatch (default 2, hard max 3) and skipped when the prompt won't fit the fallback expert's context; every attempt is returned in `attempts`.
