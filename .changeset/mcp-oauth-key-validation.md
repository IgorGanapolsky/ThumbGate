---
"thumbgate": minor
---

Make the MCP OAuth flow actually authenticate, and add a read-only reviewer credential.

Previously the consent-screen `api_key` was stored as the token's bound key but never
validated, so any client completing dynamic registration + PKCE received a working token
and could execute `/mcp` tools (including write tools) against shared server state.

- **Authorize now validates the key.** When ThumbGate keys are configured (production),
  the consent key must match a configured admin / operator / reviewer key, or the
  request is rejected (`access_denied`). In insecure/dev mode (no keys configured) any
  non-empty key is still accepted, preserving local development.
- **`THUMBGATE_REVIEWER_KEY`** — a dedicated, independently-revocable, **read-only**
  credential. Tokens bound to it may only invoke `readOnlyHint: true` tools; write tools
  return an error. Safe to share with a directory reviewer without granting mutation
  rights or exposing the operator key.
