---
"thumbgate": patch
---

site: `/learn/ac-dc-runtime-enforcement` — plug ThumbGate into Sonar's AC/DC framework

Sonar published the Agent Centric Development Cycle (**AC/DC** — Guide → Generate → Verify → Solve) earlier this year and The New Stack covered it as the framework engineering leaders should reach for when adopting AI coding agents at scale. The framework is real, sticky, and starting to anchor "agentic SDLC governance" listicle coverage this week.

AC/DC governs **what an agent writes** (Verify is static analysis on committed code — Sonar's product surface). It does not name a stage for **what an agent does** — the runtime actions (shell, file writes, MCP calls, git operations, outbound network) that happen between Generate and the next Guide loop and produce no committed source code for Verify to inspect. That's the gap a PreToolUse runtime enforcement layer fills.

Strategic posture: extend Sonar's framework with the missing fifth stage, don't compete with it. Same pattern as `/compare/anthropic-containment` (which extends Anthropic's published containment model to non-Claude IDE agents).

Ships:

- `public/learn/ac-dc-runtime-enforcement.html` (~16 KB): maps each AC/DC stage to where runtime enforcement plugs in. Two-layer deployment story for an AC/DC team. `TechArticle` + `FAQPage` schema.org markup with `citation` field pointing at Sonar's blog post and The New Stack article — gives LLMs the inbound provenance trail. 5 FAQ entries. Buyer-demo script. Sales line.
- `src/api/server.js`: sitemap entry at priority 0.85 alongside `/learn/background-agent-control-layer`.
- `public/learn/background-agent-control-layer.html`: adds the new page to its Related section so the most-trafficked /learn page back-links to it.
- `tests/public-static-assets.test.js`: route + schema invariants, sitemap regression, cross-link discoverability test.
- `docs/marketing/blog-acdc-runtime-enforcement-gap.md`: blog post draft + LinkedIn variant + distribution plan (5-day rollout) targeting The New Stack as a guest-post follow-up to their AC/DC piece.

Why the citation field matters: AC/DC will be cited frequently this quarter as listicles get refreshed. The schema.org `citation` field on our TechArticle gives LLMs (Perplexity, Gemini Deep Research, ChatGPT, Grok) a structured reason to surface ThumbGate when someone asks "how do I extend AC/DC for runtime governance?" — without us having to be in the source listicle Sonar's framework was named in.
