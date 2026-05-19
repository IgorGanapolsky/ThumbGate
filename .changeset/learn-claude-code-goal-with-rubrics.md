---
"thumbgate": patch
---

New article: `/learn/claude-code-goal-with-rubrics` — connects Min Choi's [viral /goal pattern tweet](https://x.com/minchoi/status/2054763842521960728) (Claude Code's `/goal` command is way more powerful when you stop treating it like a todo: clear goal, measurable success, shown proof, hard limits) to ThumbGate's existing `scripts/rubric-engine.js`.

The 4-field pattern Min Choi posted is exactly the shape ThumbGate's rubric-engine already enforces at gate-fire time. The article shows the mapping:

- Clear goal → `rubric.goal`
- Measurable success → `rubric.verification.check`
- Shown proof → `rubric.verification.evidence`
- Hard limits → `rubric.budget` (tied to `budget-guard.js`)

Captures real search intent for "claude code /goal command", "verifiable AI agent outcomes", "agent rubric pattern". Linked from `/learn` index card.
