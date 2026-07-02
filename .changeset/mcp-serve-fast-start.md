---
"thumbgate": patch
---

fix(mcp): stop reinstalling thumbgate@latest on every MCP server launch. The serve entry now fast-starts from the installed runtime and resolves @latest via npx only when the runtime is absent — matching the hook commands. Removes a per-launch blocking `npm install` that could hang or fail server startup on slow/offline networks (agents saw the server / capture "time out").
