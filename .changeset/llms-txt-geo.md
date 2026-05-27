---
"thumbgate": patch
---

site: serve `/llms.txt` (llmstxt.org spec) for LLM-search visibility

Adds the canonical `/llms.txt` manifest at the site root so Perplexity, ChatGPT, Claude, Gemini, and Grok crawlers get a clean markdown index of what ThumbGate is and which canonical URLs to fetch. The existing `/llm-context.md` (29 KB single-file dump) stays — `llms.txt` is the short table-of-contents that points at it.

- Adds `public/llms.txt` (~50 lines): one-line summary + section links to the legal AI page, agent manager, FinOps, pricing, guide, compatibility matrix, dashboard.
- Adds GET handler in `src/api/server.js` (mirrors the `/llm-context.md` handler).
- Adds regression test in `tests/api-server.test.js` asserting 200 + `text/markdown` + content.

`/robots.txt` already explicitly allows GPTBot, ClaudeBot, PerplexityBot, anthropic-ai, Google-Extended — this is the missing surface those crawlers look for first.
