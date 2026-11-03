---
applyTo: "src/**,scripts/**"
---

# Copilot Instructions for Core Runtime (`src/**` & `scripts/**`)

1. **PreToolUse & Security Invariants:**
   - Never weaken or bypass unconditional hard-floor gates in `scripts/gates-engine.js` (`rm -rf`, `git push --force`, `ALTER TABLE ... DISABLE ROW LEVEL SECURITY`, inline base64 blobs into Postgres, or ticket-named feature flags like `JIRA-1234`).
   - Never store static database passwords or raw credentials in code or laptop env files; enforce identity-scoped access and whitelisted secret vaults (`~/.resume_secrets`).
2. **Package Boundary & Ratchet Discipline:**
   - If you add a new runtime file required by `src/api/server.js` or `bin/cli.js`, include it in `package.json#files` and verify `node --test tests/package-boundary.test.js`.
3. **Telemetry & Checkout Truth:**
   - Ensure `pro_checkout_direct_stripe` and `stripe_redirect_started` remain in `CHECKOUT_START_EVENT_TYPES` (`scripts/telemetry-analytics.js`) and map to `stripe_redirect` in `scripts/visitor-journey.js`.
