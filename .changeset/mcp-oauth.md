---
"thumbgate": minor
---

OAuth 2.1 (PKCE) for the remote MCP connector — full, tested flow + authenticated tool execution.

The Claude Connectors Directory requires OAuth 2.0 for authenticated services, and
the hosted /mcp endpoint was previously discovery-only (it listed tools but executed
none, returning -32601). This adds the complete authorization flow AND wires
authenticated tool execution over HTTP.

- `scripts/mcp-oauth.js` — RFC 9728/8414 metadata, RFC 7591 dynamic client
  registration, RFC 7636 PKCE-S256 auth-code grant, RFC 8707 resource-indicator +
  token audience validation, token issue/validate with TTLs. 11 unit tests.
- `src/api/server.js` — serves the two discovery docs and the `/oauth/register`,
  `/oauth/authorize` (consent + code), `/oauth/token` endpoints; executes authenticated
  `tools/call` (via the shared stdio `callTool`); 401s unauthenticated calls with a
  RFC 9728 `WWW-Authenticate` pointing at the protected-resource metadata. Auth accepts
  an audience-bound OAuth token OR an exact operator/admin key (never "any bearer").
- End-to-end test (`tests/mcp-oauth-flow.test.js`): register → authorize → token →
  authenticated tools/call returning a real result; garbage token → 401. Passing.

KNOWN LIMITATION (tracked, not in this PR): `callTool` runs on the server's local
feedback DB, so the hosted connector is single-tenant. Production needs per-user data
scoping keyed to the OAuth-bound key.
