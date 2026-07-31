---
"thumbgate": patch
---

Make auto-promoted gates actually enforce.

The thumbs-down → block loop was inert. Three repeated 👎 on a command produced a gate that rendered as `action: "block"`, `severity: "critical"`, `occurrences: 3` — while a pre-action check on that exact command still returned **allow**. The dashboard showed a learned blocking rule; nothing was enforced.

**The gate's match pattern was the group key.** `buildGateRule` reused `group.key` as the gate's `pattern`. Keys are usually tag-derived — a `kubectl delete deploy` capture was tagged `entity:Customer` / `entity:Funnel` by the auto-tagger. The gates engine compiles `pattern` with `new RegExp()` and tests it against command text, so `entity:Customer+entity:Funnel` could never match a command, and its `+` silently parsed as a regex quantifier. Grouping by tag is correct; reusing that key as the match pattern is not. Patterns now derive from the captured command, with regex metacharacters escaped.

**The regression guard counted the incident itself as a false positive.** The command you are learning to block was, by definition, allowed before you learned it — that prior allow *is* the failure that got thumbs-downed. With a false-block limit of zero, every gate learned from a real failure was quarantined to `warn` and never enforced. Originating contexts are now excluded from the false-block count by normalized command equality, so genuine collateral damage (a different command that merely quotes the incident text) still quarantines as intended. Applied to both the new-gate and the `warn` → `block` upgrade path.

`promote()` also now refuses to persist any gate whose pattern cannot match its own originating context, rather than writing an inert rule that reads as though the agent learned something.
