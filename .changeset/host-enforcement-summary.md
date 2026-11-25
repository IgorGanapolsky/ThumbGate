---
"thumbgate": patch
---

Adds a generated per-host enforcement summary (hard-stops, fails open or closed, evidence link) to the README, docs/host-compatibility.md and a new page at /learn/enforcement-matrix; npm run compat:check fails when any of them differ from a fresh run. It records that the Claude Code hook fails open when ThumbGate errors.
