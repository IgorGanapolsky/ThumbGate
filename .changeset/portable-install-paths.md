---
thumbgate: patch
---

Stop baking machine-absolute paths into shared install surfaces. `init` no longer writes
the installing machine's home path into committed `.mcp.json` — project-scope entries are
now repo-relative inside the ThumbGate checkout and the portable npx launcher elsewhere
(absolute paths remain only in machine-local home-scope config). Also fixes the Claude
Desktop `.mcpb` bundle shim, which resolved `bin/cli.js` one directory above the bundle
and crashed on launch with "Server disconnected".
