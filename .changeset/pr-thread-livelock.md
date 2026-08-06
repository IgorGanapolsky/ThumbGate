---
'thumbgate': patch
---

Fix a livelock where the PR-thread-resolution gate blocked its own escape hatch.

Once `pr_thread_resolution_verified_after_commit` was pending, the gate denied
every tool call in the session — including `satisfy_gate`, the only tool that
can clear it. Any ordinary commit on a feature branch halted the session
permanently, and a human had to remove the state file to recover.

The exemption list compared the raw `toolName` against bare names, but hook
payloads deliver MCP tools as `mcp__<server>__<tool>`, so
`mcp__thumbgate__satisfy_gate` never matched `satisfy_gate`. The gate's own
comment already documented the intended behaviour; the code just did not
implement it. `isReadOnlyObservabilityTool` in the same file already stripped
the prefix correctly.

`tests/pr-thread-livelock.test.js` pins both call shapes, asserts the gate still
denies ordinary tools, and asserts the exemption does not leak to unrelated
namespaced tools.
