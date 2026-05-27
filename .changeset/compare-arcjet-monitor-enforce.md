---
"thumbgate": patch
---

site: `/compare/arcjet` + monitor-vs-enforce callout on `/ai-malpractice-prevention`

The New Stack's *"Who's monitoring the agents?"* (Darryl K. Taft, Mar 2026) and *"The attack surface moved inside the agent. So did Arcjet."* both ran without ThumbGate cited. The same publication that runs Sonar's AC/DC framework + Anthropic's containment architecture has been steadily covering agent-governance coverage in 2026 — and ThumbGate is absent from every single piece. **Arcjet specifically sits adjacent to our wedge** (TNS describes them as "WAF moved inside the agent"). A prospect that searches `ThumbGate vs Arcjet` currently gets nothing from us.

This PR closes two gaps before tomorrow's Greenberg Traurig pilot meeting:

**1. `/compare/arcjet`** (~12 KB) — same template as the four prior `/compare/*` pages. Positions Arcjet honestly as **runtime SDK in your application code** (Node, Python, Deno, Bun) protecting **inbound** HTTP traffic — bot detection, rate-limit, prompt-injection scoring, PII detection, Shield WAF rules — and ThumbGate as **PreToolUse hook inside the developer's AI coding agent** gating **outbound** tool calls before they fire. 8-row side-by-side scope table, "shared architectural insight" section (both products independently arrived at the same posture: deterministic gate, in-runtime, no LLM on the enforcement path), dual-deploy story for a regulated firm running both, 5 FAQ entries. TechArticle + FAQPage schema.org markup. Honest framing: not sponsored, not a partnership, will correct on issue report.

**2. Monitor-vs-enforce callout above the live demos on `/ai-malpractice-prevention`** — single cyan-bordered callout pre-empting the "monitoring" frame Matt Beekhuizen may have pattern-matched ThumbGate into after reading TNS coverage: *"Agent observability tools log what your agent did. ThumbGate gates what your agent is about to do — runtime block before execution, not retrospective alert."*

**3. `docs/marketing/blog-tns-monitor-vs-enforce-pitch.md`** — pitch email targeting Darryl K. Taft (not Jennifer Riggins; different author, different angle) as a follow-up to *"Who's monitoring the agents?"* with the runtime-enforcement counter-framing. Distribution plan attached.

Cross-link discovery graph updated: `/compare/{bumblebee,claude-code-hooks,anthropic-containment,oak-and-sparrow-gatekeeper}` now each back-link to `/compare/arcjet`, so a crawler that lands on any prior compare page reaches the new one.

Sitemap entry at priority 0.85 alongside the four siblings. Regression tests added for route + schema invariants, sitemap, cross-link discovery, and the monitor-vs-enforce callout.
