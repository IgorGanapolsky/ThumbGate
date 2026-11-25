---
"thumbgate": patch
---

The PreToolUse hook is about twice as fast (about 255 ms down to about 135 ms per tool call in our benchmark). It now asks git for the repo root once per tool call instead of about 20 times, keeps project identity in a small cache file between hook runs, finds executables on PATH without spawning `which`, uses Node's compile cache on Node 22.1+, and refreshes the learned intervention policy at most every 5 minutes instead of on every audited call.
