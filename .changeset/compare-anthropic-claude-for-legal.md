---
"thumbgate": patch
---

site: `/compare/anthropic-claude-for-legal` — preempt the direct-to-BigLaw Anthropic threat

Anthropic launched **Claude for Legal** on 2026-05-12 — 12 practice-area plugins (Commercial, Employment, Privacy, Corporate, AI Governance, ...), 20+ connectors (DocuSign, Ironclad, iManage, NetDocuments, LexisNexis, Thomson Reuters, Box, Everlaw, LSuite), Claude Opus 4.7 at **90.9% on Harvey's BigLaw Bench**. Available to all paid Claude customers as one-click installs into Word, Outlook, Cowork, and Projects.

This is the most likely *"what about Anthropic's legal product?"* question Matt Beekhuizen could raise at tomorrow's Greenberg Traurig pilot meeting. The page closes that gap with the honest framing: **Anthropic generates the legal action; ThumbGate learns from the attorney and gates the action.**

Critically, this page leads with **ThumbGate's full feedback-to-enforcement loop**, not just the PreToolUse endpoint:

1. **Capture** — attorney 👍/👎 on any AI answer (Claude for Legal draft, Cowork summary, conflict-check action, research citation)
2. **Memory** — feedback record lands in local lesson DB (SQLite + LanceDB), wins/mistakes/edge cases all stored, vector-searchable
3. **Rule promotion** — recurring 👎 patterns become deterministic prevention rules via Thompson Sampling; wins reinforce preferred routing
4. **Enforcement** — promoted rules fire at PreToolUse before Claude's next proposed tool call, with artifact-level audit logs

The loop is the product. The hook is the endpoint. This page is the first compare/* page to lead with that framing explicitly — corrects a scope-narrowing pattern caught by the CEO in review.

Ships:

- `public/compare/anthropic-claude-for-legal.html` (~24 KB): 8-row scope comparison, dedicated "full ThumbGate loop" section, shared-architectural-insight section citing Anthropic's own published containment as endorsement of the deterministic-runtime-gate posture, dual-deploy story, 5 FAQ entries, 3 verified citations in schema.org. Sitemap priority **0.9** (same tier as `/ai-malpractice-prevention`) — this is a vertical-flagship comparison.
- `src/api/server.js`: sitemap entry at priority 0.9.
- `public/compare/{anthropic-containment,bumblebee,claude-code-hooks,oak-and-sparrow-gatekeeper,arcjet}.html`: each adds a related-card pointing at the new page.
- `tests/public-static-assets.test.js`: route + schema + sitemap regression + 5-way cross-link discoverability test. Verifies the "full feedback loop" framing is in the rendered HTML.

Anthropic's safety story for Claude for Legal is *"keep a human in the loop on decision making"* — a workflow principle. Sullivan & Cromwell had that principle codified in policy when their associates filed hallucinated citations with a federal judge. The page draws the line: policies are not enforcement; a runtime gate that fires before the human is asked to approve is.
