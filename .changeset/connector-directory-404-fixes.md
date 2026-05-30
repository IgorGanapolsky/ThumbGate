---
"thumbgate": patch
---

fix(connector): resolve the two 404s blocking the Claude Connectors Directory submission

- Add a `/docs/connectors` route — the `resource_documentation` URL advertised by `/.well-known/oauth-protected-resource`. It documents the remote MCP connect URL, the OAuth 2.1 (PKCE, S256-only, RFC 8707 audience-bound) flow, the available tool groups, and the read-only reviewer credential. Previously 404.
- Add `public/favicon.ico` (4-size 16/32/48/64 ICO minted from the 512px brand icon). The `/favicon.ico` handler already served `PUBLIC_DIR/favicon.ico`; only the asset was missing. The directory requires favicon verification. `favicon.ico` is not in npm `files[]`, so the public-bundle-ratchet baseline is unchanged.
