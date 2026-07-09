---
thumbgate: patch
---

Add signed-entitlement boundary (the real paid-tier protection). New `scripts/entitlement.js` verifies Ed25519-signed license tokens offline (tier, features, expiry, customer id, key id, signature) against a shipped public keyset; `requireEntitlement(feature)` gates paid features — advisory by default, enforced via `THUMBGATE_ENFORCE_ENTITLEMENTS=1`. The DPO/HuggingFace/Databricks exporters now call the gate. Replaces the bypassable `tg_`/`tg_pro_` prefix check: fake prefix keys and tampered/expired/wrong-key tokens all fail verification (proven in `tests/entitlement.test.js`). The private signing key never ships (hosted billing secret / local gitignored dev key only).
