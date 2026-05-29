---
"thumbgate": minor
---

OAuth 2.1 (PKCE) authorization-server foundation for the remote MCP connector.

The Claude Connectors Directory requires OAuth 2.0 for authenticated services;
ThumbGate's /mcp authenticated tools currently use an API-key Bearer and had no
OAuth discovery. This adds:

- `scripts/mcp-oauth.js` — pure, dependency-free OAuth machinery (RFC 9728/8414
  metadata, RFC 7591 dynamic client registration, RFC 7636 PKCE-S256 auth-code
  grant, token issue/validate with TTLs, bound to a ThumbGate key server-side).
  Fully unit-tested (PKCE round-trip, single-use codes, expiry, redirect/client
  mismatch, S256-only enforcement).
- `src/api/server.js` — serves `/.well-known/oauth-protected-resource` and
  `/.well-known/oauth-authorization-server` (+ openid-configuration alias),
  smoke-verified live (200, correct JSON).

Remaining (tracked, NOT in this PR): wire POST /oauth/register, /oauth/authorize
(consent + key binding) and /oauth/token over the machinery, accept OAuth access
tokens at /mcp alongside API keys, and run the end-to-end Claude handshake. Those
need a security review + live test before the directory submission.
