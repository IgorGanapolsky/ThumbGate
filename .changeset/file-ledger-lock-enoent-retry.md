---
"thumbgate": patch
---

Retry ledger lock acquisition when a concurrent stale-lock recovery deletes the lock directory between mkdir and owner write (ENOENT race).
