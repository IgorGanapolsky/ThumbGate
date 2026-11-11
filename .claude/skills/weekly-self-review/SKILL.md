---
name: weekly-self-review
description: >
  Weekly retrospective on the agent's own work: what shipped, what stalled,
  where the operator had to repeat himself, and which skills, memory or
  CLAUDE.md rules need to change so it doesn't happen again. Use on the weekly
  schedule or when the operator says he keeps having to remind the agent.
---

# Weekly Self-Review — Turn Repeated Reminders Into Durable Rules

The operator should never have to say the same thing twice. Every repeated
correction is a missing rule, skill step, or memory entry.

## 1. Collect the week (evidence only)

- PRs: `gh pr list --repo IgorGanapolsky/ThumbGate --state all --search "updated:>=<7 days ago>" --json number,title,state,isDraft,mergedAt,createdAt`
  — count opened, merged, still open, and open-but-green (a green PR left open
  is a miss).
- `main` health: `gh run list --branch main --limit 20`.
- Revenue: `node scripts/revenue-status.js` (or UNKNOWN). Week-over-week only if
  last week's number was recorded.
- Outreach receipts from the project log (posts, sends, follow-ups, replies).
- Project threads / sessions from the last 7 days: which finished, which are
  waiting, and on what.
- Local lessons: `npm run feedback:stats`, `npm run feedback:summary`.

## 2. Find the misses

For each, quote the evidence:

1. **Repeated asks** — the operator asked for the same thing (or corrected the
   same behavior) more than once.
2. **Handoffs** — anywhere the agent told the operator to do a step itself.
   Was there a route it didn't try? (`blocked-action-fallback`)
3. **Stalls** — threads/PRs idle > 24h with no recorded blocker.
4. **False claims** — "done/merged/sent/deployed" without the matching
   evidence class.
5. **Dead automation** — scheduled tasks that failed or produced nothing.

## 3. Fix the system, not just the instance

For every miss, make one durable change, smallest that works:

| Miss type | Durable fix |
|-----------|-------------|
| Behavior rule | Edit the relevant skill or CLAUDE.md (absolute ZERO/ALWAYS wording) via PR |
| Fact the next session needed | Write/update the project memory file |
| Broken route | Record the working route in `blocked-action-fallback` or memory |
| Missing guard | Add a test or hook (policy belongs in gates, not prose) |
| Stalled work | Restart it now, or close it with a reason |

Keep memory and instructions in sync (CLAUDE.md: "Memory and instructions must
be updated together").

## 4. Report (short)

```
Week of <date>
Shipped: <merged PR count + links> · Revenue: <number|UNKNOWN> · Posts/sends: <count with receipts>
Misses: <n> — <one line each with evidence>
Fixed this review: <PR/memory links>
Next week's one priority: <single item>
```

Log a thumbs-down lesson for each miss and a thumbs-up for each fix that held
(`.claude/scripts/feedback/capture-feedback.js`).
