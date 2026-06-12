---
"thumbgate": minor
---

Strengthen the anti-claim Stop hook (`hook-stop-anti-claim.js`). Expand the lie-phrase set to catch completion claims that previously slipped past it — "all green", "tests pass/passing", "verified", "confirmed", "is/now stable", "all clear", "good to go", "race is over" — all still suppressed when the same turn ran a proof tool call (curl/grep/test/Read). Add a strict mode: with `THUMBGATE_STRICT_ENFORCEMENT=1` the hook emits a Stop-hook `block` decision (forcing the agent to verify or retract before ending the turn) instead of a soft next-turn reminder. Default behavior unchanged.
