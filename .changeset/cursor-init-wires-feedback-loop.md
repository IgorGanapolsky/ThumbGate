---
"thumbgate": patch
---

`thumbgate init --agent cursor` now wires the whole thumbs-down loop into `~/.cursor/hooks.json`: beforeSubmitPrompt (a typed thumbs-down places the hold before the next tool call), beforeMCPExecution (MCP chat sends go through the holds and send rules), the after* recorders and the stop claim check. Before, it wired only beforeShellExecution, so a thumbs-down typed in a Cursor set up with npm held nothing.
