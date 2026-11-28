---
name: thumbgate-blocked
description: Show ThumbGate's feedback and enforcement record from the hosted ThumbGate server, including thumbs-up/down totals, the trend, active prevention rules, and recent sessions. Reads feedback_stats, prevention_rules and session_report. Use when the user says "what has ThumbGate blocked", "is enforcement working", "show gate stats", or "what got stopped". Do NOT use to create a rule (use thumbgate-guard) or to check whether ThumbGate is wired up (use thumbgate-doctor).
---

# ThumbGate Blocked

Show what ThumbGate has learned and enforced, using only the hosted tools this plugin connects to.

## Workflow

1. **Totals:** call `feedback_stats` for thumbs-up and thumbs-down counts and the trend.
2. **Rules in force:** call `prevention_rules` for the active rules and why each exists.
3. **Recent activity:** call `session_report` for recent sessions and outcomes.
4. **Summarize:** totals, the trend, the most important rules, and anything that changed recently.
5. **Block counts** (how many tool calls were actually stopped before running) are recorded by the local ThumbGate hook, not the hosted server. If the user wants them, say they come from `npx thumbgate gate-stats` in a project with the local install (https://thumbgate.ai/guide).

Field meanings are in [references/enforcement-fields.md](references/enforcement-fields.md).

## Quality checklist

- [ ] Every number came from a tool call made now, not an estimate.
- [ ] On all zeros, said whether nothing was captured yet or nothing was promoted to a rule.
- [ ] Did not claim local block counts the hosted server can't see.
