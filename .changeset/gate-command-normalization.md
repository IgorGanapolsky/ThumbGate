---
"thumbgate": patch
---

Gate pattern keys now collapse trivial command variants. Previously, `rm -rf node_modules`, `rm -rf ./node_modules`, and `rm -rf "node_modules"` produced three separate gate IDs — accidental dislikes proliferated and one captured failure didn't catch its near-twins on the next run.

Addresses the r/ClaudeCode critique (MomSausageandPeppers, 2026-05-17): "commands are matched by string equality, so trivial variations create separate gates."

New helper `normalizeCommandSignature(input)` (exported from `scripts/auto-promote-gates.js`) applies a conservative set of transforms:

- lowercase
- strip `/Users/<name>/` and `/home/<name>/` home-dir prefixes (→ `~`)
- drop `:LINE` and `:LINE:COL` refs
- per-token: strip one layer of matching outer quotes/backticks
- per-token: drop leading `./`
- collapse whitespace + trim

Explicitly does **not** reorder flags, collapse `&&` chains, or canonicalize subcommands — each of those can change semantics. Regression tests pin both behaviors (`does NOT reorder flags`, `does NOT collapse && chains`).

`extractPatternKey()` now routes context through `normalizeCommandSignature` so five common rm-rf variants collapse to one gate ID. Tag-based keys still take precedence when tags are present.

12 new tests in `tests/auto-promote-gates.test.js`; 31/31 in file passing.
