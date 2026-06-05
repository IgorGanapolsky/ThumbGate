---
"thumbgate": patch
---

fix(mcp): stdio server self-exits on stdin EOF/close

stdio MCP server (adapters/mcp/server-stdio.js) now listens to stdin 'end' and 'close' events to exit the process with code 0 when the client disconnects. This prevents orphaned serve processes from accumulating on the host system.
