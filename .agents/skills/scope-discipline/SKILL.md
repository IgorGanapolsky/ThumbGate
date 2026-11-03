---
name: scope-discipline
description: >
  Keep one task closed-looped before starting the next. Triggered when a new
  problem surfaces mid-task (a bug, a security finding, a missing env var), when
  you're about to branch into unrelated work, or when you notice the session has
  sprawled across many half-finished threads. Prevents the "nothing ever lands"
  failure where each step spawns new work and none finishes.
---

# Scope Discipline — Close Loops, Don't Open Them

## The failure this prevents

A single request balloons into a chain where every step uncovers new work and you
chase it immediately, so nothing reaches "done + verified + deployed." This
session: RAG → OAuth → directory submission → reviewer key → consent-key
validation → CodeQL fixes — six threads, each started before the prior landed.
The result feels like motion but lands nothing. (2026 reliability research flags
"repetitive actions / no task completion" as the top long-horizon failure trigger
— a metacognitive check on this is recommended: arxiv 2509.19783.)

## The rule: one in-flight task, with a parking lot

1. **One task is `in_progress` at a time** (mirror it in the task-state-ledger).
2. When a new issue surfaces mid-task, **do NOT start it.** Write it to a parking
   lot and keep going. Park, don't pivot.
3. A task is closeable only when **verified** (the `evidence-first-answer` /
   deployment-gate bar), not when code is written.
4. After closing, pick the next item from the parking lot **or ask the CEO which
   to take** if priority is ambiguous.

## The parking lot

Keep a `## Parking lot` section in the task-state-ledger:
```markdown
## Parking lot (found mid-task — do NOT start until current loop closes)
- [security] CodeQL: 2 critical cmd-injection + 1 XSS on main — own PR
- [infra] THUMBGATE_REVIEWER_KEY not set on Railway
- [docs] /docs/connectors 404, favicon 404
```
For genuinely independent work, prefer spawning a separate task (e.g. the
`spawn_task` chip) over context-switching this session.

## When the user says "continue" / "do everything"

That means *make progress on the current loop*, not *fan out into new threads*.
The most valuable thing is the next closed loop, not the most new activity.
Before branching, ask: "does this finish the current task or start a new one?"
If it starts a new one → park it.

## Allowed exception

A discovery that makes the current task unsafe to finish (e.g. you find the thing
you're about to ship has a security hole) DOES belong in the current loop — fixing
it IS closing the loop correctly. The test: "is this a prerequisite of the current
Goal, or a new Goal?" Prerequisite → handle now. New Goal → park.

## Anti-patterns

| Pattern | Fix |
|---|---|
| Find a bug mid-task → immediately go fix it | Park it; finish current loop first |
| 5 open PRs, 0 merged-and-verified | Drive ONE to deployed before opening more |
| "While I'm here I'll also…" | That's a new Goal — park it |
| Treating "continue" as "find new work" | "continue" = advance the current loop |

## Exit criteria

The current task's Goal is verified done. The parking lot is either empty or
explicitly handed to the CEO as "here's what I parked; which next?"
