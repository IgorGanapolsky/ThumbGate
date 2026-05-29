---
"thumbgate": patch
---

Serve MCP tool annotations on the remote /mcp connector.

The remote `/mcp` tools/list (`getPublicMcpTools`) and the server-card discovery
(`getServerCardTools`) were mapping tools to `{name, description, inputSchema}` —
silently **dropping the `readOnlyHint`/`destructiveHint` annotations** defined in
`scripts/tool-registry.js`. So all 82 tools were served unannotated, which (a) is
the #1 rejection cause for the Claude Connectors Directory and (b) deprives MCP
clients of the safety hints they use for permission prompts.

Now both functions pass `tool.annotations` through. New `tests/mcp-tool-annotations.test.js`
pins the contract: every served tool declares a readOnlyHint or destructiveHint.
