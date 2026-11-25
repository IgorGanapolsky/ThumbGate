---
"thumbgate": patch
---

Add a generated table of which gates are enforced on which host (Claude Code, Cursor, Codex, Gemini CLI). `npm run compat:matrix` runs each gate's denial through the real Claude Code and Cursor hook paths and writes `docs/host-compatibility.md`, `docs/compat/host-gate-results.json` and a README block. A cell says "enforced" only with a recorded denial; hosts with no run say "untested".
