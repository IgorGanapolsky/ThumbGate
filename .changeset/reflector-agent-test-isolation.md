---
"thumbgate": patch
---

test(reflector-agent): isolate from developer feedback DB

The `reflector-agent.test.js` unit tests call `checkRecurrence`, which
transitively reads `memory-log.jsonl` under the resolved feedback dir.
On developer machines with a populated lesson DB, assertions that
expect zero matches (`severity: 'info'`, `recurrence.count: 0`) flip
to `'warning'` / `1` because real recurring-mistake memories leak in.

Pin `THUMBGATE_FEEDBACK_DIR` to a fresh empty `mkdtempSync` dir for the
lifetime of the file, and restore the prior value in an `after` hook.
This lets the full verification chain run head-to-tail without one
stray test stopping the `&&` chain.

No runtime change. Tests only.
