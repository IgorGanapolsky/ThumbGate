---
"thumbgate": patch
---

site: `/learn/feedback-loop-vs-decision-layer` — anchor the full-loop scope correction

Permanent /learn page anchoring the CEO scope correction from 2026-05-27: ThumbGate is a four-stage feedback-to-enforcement loop, NOT a PreToolUse hook with feedback bolted on. Captures the canonical framing once so every future compare/blog/learn piece can cite a single canonical reference.

The page makes three structural points:

1. **Decision-layer governance** (prompt rules, AI judge models, "human in the loop" workflow principles, RLHF) is necessary but not sufficient — Sullivan & Cromwell had every form and still got sanctioned.
2. **Action-layer enforcement alone** (a static rule set fired at PreToolUse) is necessary but not sufficient either — generic rules don't encode YOUR team's incidents.
3. **The loop is the product**: Capture (👍/👎 on any AI answer) → Memory (local SQLite + LanceDB) → Rule promotion (Thompson Sampling) → Enforcement (PreToolUse hook). The hook is one stage of four.

Also includes a direct comparison vs RLHF: where the change lives, who controls it, how many examples to shift behavior, what happens at model upgrade, auditability. ThumbGate's loop wins on every row when the buyer's question is "how do I keep MY team's safety posture across model changes."

Self-contained content, no commercial confirmations required, no public-API change. Adds 1 new HTML file + sitemap entry + cross-link from /learn/background-agent-control-layer + regression test + this changeset.
