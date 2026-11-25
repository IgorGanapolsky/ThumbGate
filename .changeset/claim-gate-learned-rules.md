---
"thumbgate": patch
---

The optional Stop-time claim gate now ships in the npm package, holds claims like "sign-in is refused" until a check from the same turn is attached (a health-page 200 or an old log file does not count), and two thumbs-downs from a person on one unchecked claim write a rule into `claim-gate-rules.json` with no file edit. It stays opt-in: it only runs where the Stop hook is installed.
