---
"thumbgate": patch
---

site: head-to-head comparison page `/compare/anthropic-containment`

Anthropic published ["How we contain Claude"](https://www.anthropic.com/engineering/how-we-contain-claude) on their engineering blog — a three-layer architecture (ephemeral gVisor containers for claude.ai, Seatbelt/bubblewrap OS sandboxes for Claude Code, hypervisor VMs for Claude Cowork, MITM egress proxy after credential exfiltration was discovered through approved domains, tool-output inspection before context insertion).

That architecture is concretely published, citation-grade, and stops at the Anthropic product boundary. ThumbGate runs the same model at the IDE-agent layer where Anthropic's sandbox does not reach: Cursor, OpenAI Codex CLI, Google Gemini CLI, Sourcegraph Amp, Cline, OpenCode, Claude Desktop.

Ships:
- `public/compare/anthropic-containment.html` (~14 KB): comparison page in the existing `/compare/bumblebee` and `/compare/claude-code-hooks` style. Maps each of Anthropic's 5 published layers to where ThumbGate fits. Quotes their published architectural lessons verbatim (with attribution). `TechArticle` + `FAQPage` schema.org markup for LLM citation. Three "pick X for" guidance sections.
- `tests/public-static-assets.test.js`: regression test for the route and schema-markup invariants.

**Sitemap entry intentionally omitted from this PR.** Recent comparison-page PRs (#2336, #2339) added a `src/api/server.js` sitemap line and tripped SonarCloud's "new code" line-shift heuristic each time, requiring a follow-up fix commit. The page is still crawlable via internal `/compare/*` links and the robots.txt allowlist; sitemap inclusion can be batched in a separate PR that updates multiple paths in one shift.

Strategic context: Anthropic's article is being cited heavily across the "AI agent safety" content surface this week. Same listicle authors that picked up Bumblebee will pick this up. Positions ThumbGate as the published-architecture-extended-to-IDE-agents play.
