# WorkOS AuthKit governance (ThumbGate)

Canonical adapter note: [`adapters/workos/WORKOS.md`](../../adapters/workos/WORKOS.md).

## High-ROI controls shipped 2026-08-05

1. **MCP OAuth scope hierarchy** — `mcp:write` implies `mcp:read` / `mcp:gates` / `mcp:feedback` (`scripts/mcp-oauth.js`).
2. **Production AuthKit guard** — `scripts/workos-production-guard.js` (email + Google on production host; no staging).
3. **Gate templates** — spend-cap, MCP OAuth scope, WorkOS skill-install review.
4. **Proof** — `npm run prove:workos`.

## Spend cap (HARD)

≤ $10/mo AuthKit: no custom domains, no enterprise SSO connections, no Directory Sync for public product without written budget change.
