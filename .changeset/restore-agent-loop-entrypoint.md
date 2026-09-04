---
"thumbgate": patch
---

fix(agents): restore documented `bin/agent-loop` health entrypoint

Adds the fail-closed session-start health command required by #3670 and
wires it into AGENTS.md / CLAUDE.md Context Engineering so agents stop
hitting exit 127 on the documented entrypoint.
