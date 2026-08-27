---
"thumbgate": patch
---

self-protect process rule now requires a left word boundary, so prose containing
words that merely end in the verb (e.g. "skill " followed later by a protected
process name) no longer hard-blocks harmless commands; real kill/pkill/killall
invocations still deny. Regression test added from the 2026-08-26 false positive.
