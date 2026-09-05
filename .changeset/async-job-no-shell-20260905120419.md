---
"thumbgate": patch
---

Run async-job command stages with quote-aware argv parsing and `shell: false` (no `sh -lc` / `cmd /c`), rejecting unquoted shell metacharacters.
