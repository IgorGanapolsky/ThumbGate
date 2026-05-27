---
"thumbgate": patch
---

site: serve `/llms.txt` (llmstxt.org spec) for LLM-search visibility + fix systemic CI flake

**Two bundled fixes:**

1. **`/llms.txt`**: AI search engines (Perplexity, ChatGPT, Claude, Gemini, Grok) look for the canonical `/llms.txt` manifest at the site root per the [llmstxt.org](https://llmstxt.org) spec. Currently 404. This PR ships the file + server route.
   - `public/llms.txt` (~50 lines): one-line summary + section links to canonical URLs.
   - `src/api/server.js`: GET handler mirroring the existing `/llm-context.md` handler.
   - `tests/api-server.test.js`: regression test for the route.

2. **CI broker-audit test fragility**: `tests/api-server.test.js`'s `/broker-audit returns 500…` test was using rename-and-restore (`fs.renameSync` to `.swap-<pid>` then back). When the test process was SIGTERM'd (which happens routinely under timeout in CI sandboxes), the asset file stayed renamed and every subsequent CI run on every PR failed with ENOENT until someone manually restored it. Replaced with in-memory swap (`readFileSync` → `unlinkSync` → `writeFileSync(saved)`); the saved content lives in process memory so a crash leaves only a missing file that `git restore` recovers.

`/robots.txt` already explicitly allows GPTBot, ClaudeBot, PerplexityBot, anthropic-ai, Google-Extended.
