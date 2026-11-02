---
"thumbgate": patch
---

Deny the next edit, commit, or push after swarm-claim.py exits 3, including a failed shell on PostToolUseFailure, and only for that session. Deny a second Teams send on the same point after the first send succeeds. Deny `az repos pr update` that publishes a draft before another person has reviewed.
