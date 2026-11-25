---
"thumbgate": patch
---

`thumbgate init --agent cursor` now wires the whole thumbs-down loop into `~/.cursor/hooks.json`: beforeSubmitPrompt (a typed thumbs-down places the hold before the next tool call), beforeMCPExecution (MCP chat sends go through the holds and send rules), the after* recorders and the stop claim check. Before, it wired only beforeShellExecution, so a thumbs-down typed in a Cursor set up with npm held nothing.

Existing Cursor installs repair themselves: on the next ThumbGate MCP server start or the next shell command in Cursor, `scripts/cursor-self-heal.js` adds the missing hooks to `~/.cursor/hooks.json`. It acts only when that file already holds ThumbGate's shell gate, never writes to stdout, adds each hook once, and is off with `THUMBGATE_DISABLE_CURSOR_SELF_HEAL=1`. Restart Cursor to load the new hooks.
