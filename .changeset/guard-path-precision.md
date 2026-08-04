---
"thumbgate": patch
---

Stop the money guard from hard-denying ordinary developer commands.

The commerce-path matcher allowed a bare-word alternation, so any tool payload
merely CONTAINING one of its tokens anywhere was hard-denied — regardless of
context. Confirmed live: routine version-control and package-manager
subcommands were blocked, and a Python docstring in an unrelated repository was
rejected as an attempted transaction. Because the hook is registered with a
match-everything pattern, this affected every project on the machine, not just
this one.

Replaces the bare-word branch with a character class requiring a real path or
fragment separator, plus a trailing word boundary so a token that continues
into a longer identifier is not treated as a commerce path.

Verified by differential analysis over the repository corpus: lines matched
drop from 5257 to 639, eliminating 4618 false positives with zero regressions.
All vendor hosts and all path/fragment forms remain denied (21/21 assertions).
Spend authority is unchanged — nothing that was previously denied is now
allowed except non-commerce text.

Adds `tests/spend-guard-path-precision.test.js`, which derives its vectors from
the pattern itself. Against the previous pattern it fails 4 of 5 cases.
