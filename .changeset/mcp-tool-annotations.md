---
"thumbgate": patch
---

Serve MCP tool titles + annotations on the remote /mcp connector (Connectors Directory requirement).

The remote `/mcp` tools/list (`getPublicMcpTools`) and server-card discovery
(`getServerCardTools`) served all 82 tools with **no `title` and no
`readOnlyHint`/`destructiveHint`** — the #1 Claude Connectors Directory rejection
cause, and missing safety hints for every MCP client.

- `tool-registry.js`: normalize every tool at export to carry a human-readable
  `title` (humanized from the name) plus an annotation (`title` + the
  readOnly/destructive hint; un-hinted tools default conservatively to
  destructiveHint so they're gated, not silently treated as read-only).
- `src/api/server.js`: `getPublicMcpTools`/`getServerCardTools` now pass `title`
  and `annotations` through.
- Test pins the contract: every served tool has a title and a hint.
