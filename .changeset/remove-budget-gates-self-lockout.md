---
"thumbgate": patch
---

Remove budget gates from the PreToolUse hook path (self-lockout fix). A stale `~/.thumbgate/budget-state.json` (session_start never reset across sessions) permanently blocked every Bash/Edit/Write call — including the edits needed to repair the gate itself. The hook no longer consults budget gates at all; spend tracking remains advisory-only. `evaluateBudget()` is now advisory by default (deny requires explicit `THUMBGATE_BUDGET_ENFORCE=1`), auto-resets state older than 2× the time cap, and scopes state to a `sessionId` when provided. Regression test `tests/hook-no-budget-lockout.test.js` spawns the real hook with poisoned budget state and asserts it can never block.
