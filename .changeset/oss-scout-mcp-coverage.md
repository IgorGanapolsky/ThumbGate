---
"thumbgate": patch
---

gtm: OSS PR opportunity scout now covers the MCP ecosystem (our #1 community)

The scout mapped only npm dependencies to upstream repos, so it structurally
missed the Model Context Protocol — even though ThumbGate *is* an MCP server and
MCP authors are its exact buyers. Added a strategic-ecosystem path that always
scouts `modelcontextprotocol/typescript-sdk` and `modelcontextprotocol/servers`
(de-duped against package.json), scores them as a top opportunity, and uses a
truthful outreach line ("building ThumbGate as an MCP server") instead of falsely
claiming we import the SDK. Regenerated the committed opportunity plan.
