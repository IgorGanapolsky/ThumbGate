---
"thumbgate": patch
---

Reading a file locally no longer gets a hard deny just because a line in it looks like a secret assignment (the "Likely secret assignment" heuristic, often a test stub such as `token: 'stub-token-for-unit-tests'`). The Read tool, and Bash `cat`/`sed`/`grep`/`head` with nothing that reaches the network, now warn instead of denying in the default mode. `THUMBGATE_STRICT_ENFORCEMENT=1` keeps the old deny. High-confidence key patterns (AWS, GitHub, Stripe live, private keys, JWTs), secret files such as `.env`, and any command that sends the file stay denied in every mode. Fixtures in `tests/read-only-file-precision.test.js`.
