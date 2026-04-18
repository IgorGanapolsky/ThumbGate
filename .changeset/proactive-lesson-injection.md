---
thumbgate: minor
---

Add `buildRecentCorrectiveActionsContext` to `scripts/gates-engine.js`: surfaces the 3 most recent captured mistakes (from `memory-log.jsonl`, last 24h) as `hookSpecificOutput.additionalContext` on every tool call. Plugs the cold-start gap where a just-captured mistake would otherwise wait for semantic match or the recurring-pattern threshold before reaching the agent's context.
