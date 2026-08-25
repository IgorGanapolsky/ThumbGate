---
"thumbgate": patch
---

MCP sessions now register themselves as first-class agent identities at server startup: `startStdioServer` calls a new `registerSessionIdentity` that registers the session's attributed id (or generates one) in the agent registry with `source: mcp` and exports it via `THUMBGATE_SESSION_AGENT`, so every audit record and the gates-engine identity gate can attribute the session's tool calls. This fulfills the registry's long-standing "called on MCP server startup" contract and makes shadow-agent detection meaningful: registered MCP sessions are never shadow, while unregistered actors remain visible. Bootstrap is best-effort and can never block server start.
