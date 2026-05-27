---
"thumbgate": patch
---

site: head-to-head comparison page `/compare/claude-code-hooks`

karanb192/claude-code-hooks currently ranks #1 on the buyer query "Claude Code safety pre-tool-use hooks npm package" — the exact query an npm/GitHub user searches before they discover ThumbGate. This PR ships a fair, fact-based comparison page that explains the scope difference (their local shell scripts vs our hosted sync + adapter matrix + dashboard) and links honestly to their repo.

- `public/compare/claude-code-hooks.html`: full comparison page in the same style as the existing `/compare/heidi`, `/compare/mem0`, `/compare/speclock` pages. TechArticle + FAQPage schema.org markup so Perplexity/ChatGPT/Claude/Gemini can cite it. Honest framing — credits karanb192 explicitly and recommends installing both for the seed library.
- `src/api/server.js`: sitemap entry added at priority 0.85.
- `tests/public-static-assets.test.js`: regression tests for the route + sitemap inclusion.

Targets the third-party listicle gap identified in the LLM-search visibility audit: ThumbGate is currently absent from every "best AI agent safety tools" comparison that LLMs retrieve from. Owning the head-to-head against the top-ranking competitor is the lowest-cost way to surface in those answers.
