---
"thumbgate": patch
---

site: add live UPL / Conflict / Egress gate simulators to the Legal AI page

Three interactive simulators on `/ai-malpractice-prevention`:
- UPL Gate: detects advice-shaped output from non-attorney sources, shows the corrective hand-off and full audit log.
- Conflict Gate: cross-references a party name against a sample adverse-parties list with realistic block/clear results.
- Egress Gate: detects privilege markers in outbound payloads and shows the in-tenant LLM redirect.

All three use the same deterministic PreToolUse logic that runs in production — no LLM calls on the enforcement path. Gives law-firm pilot prospects a hands-on "this is what protection actually feels like" moment during the walkthrough.

Re-implements the value of PR #2292 on top of current main (the original branch was 4 days behind and would have regressed the page's recent SEO + copy work).
