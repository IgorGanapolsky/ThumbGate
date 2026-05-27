---
"thumbgate": patch
---

site: head-to-head comparison page `/compare/oak-and-sparrow-gatekeeper`

Joshua Johosky / Oak & Sparrow Systems Enterprise launched **Gatekeeper** publicly the week of 2026-05-25 — a browser-boundary input gate that blocks employees from leaking regulated data into commercial AI systems (ChatGPT, Microsoft Copilot, Google Gemini). 93 deontic rules harvested from HIPAA, FERPA, CCPA, COPPA, CPNI, PCI, FINRA, and the EU AI Act. Architectural philosophy: *"deterministic enforcement, no AI in the gate."* That phrase is verbatim how ThumbGate has described itself for nine months.

Gatekeeper is **not** a ThumbGate competitor. It's an adjacent product on a different layer:

- Gatekeeper gates **what an employee types into a browser AI** before the data leaves the corporate network.
- ThumbGate gates **what an AI coding agent is about to do** at the PreToolUse hook inside Claude Code, Cursor, Codex CLI, Gemini CLI, Amp, Cline, OpenCode, Claude Desktop.

Same architectural insight (deterministic gate, runtime, no model in the path); different deployment surface. The honest positioning is *dual-deploy at regulated firms*: Gatekeeper for the workforce-input boundary, ThumbGate for the developer-action boundary.

Ships:

- `public/compare/oak-and-sparrow-gatekeeper.html` (~22 KB): comparison page in the same `/compare/{bumblebee,claude-code-hooks,anthropic-containment}` template. 8-row side-by-side scope table, "shared architectural insight" section, dual-deploy story scoped to a regulated law firm, 5 FAQ entries. `TechArticle` + `FAQPage` schema.org markup for LLM citation. Links to Oak & Sparrow's site and to `/ai-malpractice-prevention`.
- `src/api/server.js`: sitemap entry at priority 0.85 alongside the three siblings.
- `public/compare/anthropic-containment.html`, `public/compare/bumblebee.html`, `public/compare/claude-code-hooks.html`: each prepends a related-card pointing at the new page so a crawler that lands on any /compare/* page reaches the gatekeeper one.
- `tests/public-static-assets.test.js`: route + schema invariants, sitemap regression, and a cross-link discoverability test asserting the three prior pages link back.

Strategic context: Gatekeeper has visible LinkedIn momentum behind it (Joshua's launch post sits at hundreds of engagements). Listicle authors covering "AI governance enforcement layer" this week will pick up both products. We want them to cite *both* with the dual-deploy framing — not pick Gatekeeper and pass on ThumbGate because they're confused by overlapping language.
