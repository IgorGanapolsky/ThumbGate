---
"thumbgate": patch
---

Make the Claude/MCP connector discoverable: fix the MCP Registry publish + document the remote connector.

ThumbGate already runs as a working remote MCP server (https://thumbgate.ai/mcp),
but it wasn't listed in the MCP Registry — the publish workflow had been failing.

- `.github/workflows/mcp-registry-publish.yml`: bump `mcp-publisher` v1.5.0 → v1.7.9
  (v1.5.0 requested the old OIDC audience `mcp-registry`; the registry now requires
  `https://registry.modelcontextprotocol.io` and 401s the old one). Add a step that
  waits for the npm package version in `server.json` to be live on npmjs.org before
  publishing, so a release that bumps the version ahead of npm no longer 404s the
  registry publish.
- README: add an "Add ThumbGate to Claude (remote connector)" section pointing at
  `https://thumbgate.ai/mcp` (Settings → Connectors → Add custom connector) — usable
  today with no install.
