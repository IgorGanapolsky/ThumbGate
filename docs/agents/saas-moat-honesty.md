# SaaS Moat & Seat-Compression Honesty (Walling 2026 FORMAT)

Source: Rob Walling, [*The Only SaaS Moats Left in 2026*](https://www.youtube.com/watch?v=KpILHX2D-AA).

## Why This Exists

ThumbGate's `MOAT.md` established that 212 of 216 private Core scripts also ship in the public npm bundle, and `docs/COMMERCIALIZATION_STRATEGY.md` established our open-core split:
- **Free / permissive adoption wedge:** `PreToolUse` runtime firewall (`scripts/gates-engine.js`), CLI adapters, starter destructive-action gates.
- **Paid / entitlement-gated moat:** 5 learned models (`risk-scorer.js`, `bayes-optimal-gate.js`, `thompson-sampling.js`, `agent-reward-model.js`, `intervention-policy.js`), 3 training-data exporters (`export-dpo-pairs.js`, `export-hf-dataset.js`, `export-databricks-bundle.js`), hosted cross-machine sync, and the cross-customer learning loop.

`scripts/saas-moat-honesty.js` operationalizes Walling's 8-Moat diagnostic and closes the three gaps between `docs/COMMERCIALIZATION_STRATEGY.md` and the live runtime:

1. **Unified Ed25519 Entitlement Enforcement (`scripts/license.js` + `scripts/entitlement.js`)**
   - `scripts/license.js` now verifies offline Ed25519 signed tokens (`THUMBGATE_LICENSE`, `~/.config/thumbgate/license.json`, and signed tokens in `THUMBGATE_PRO_KEY` / `THUMBGATE_API_KEY` / `~/.thumbgate/license.json`).
   - When `THUMBGATE_ENFORCE_ENTITLEMENTS=1` is enabled, forged legacy `tg_pro_...` prefix keys are rejected across both `scripts/entitlement.js` and `scripts/license.js`.
2. **Cross-Customer Anonymized Learning Loop (Moat #7)**
   - `distillCrossCustomerSignature()` and `aggregateCrossCustomerLoop()` convert blocked tool calls into secret-redacted, path-normalized SHA-256 structural signatures (`toolName::category::normalizedPattern`).
   - Raw transcripts (`rawTranscript`) and unredacted secrets fail closed.
   - Structural signatures promote to the shared rule pack only when observed across $\ge 2$ distinct orgs and $\ge 3$ interdictions, ensuring learned intelligence remains in the control plane even when a user exports their raw DPO pairs (`export-dpo-pairs.js`).
3. **8-Moat Self-Assessment & Anti-Theater Diode**
   - Blocks unverified moat claims (e.g., claiming closed-source Core is the moat or claiming unheld SOC 2 / FedRAMP certifications) and human-seat-only pricing claims.

## CLI Usage

```bash
npx thumbgate saas-moat-honesty --json
npx thumbgate saas-moat-honesty --map-only --json
npx thumbgate saas-moat-honesty --claim="closed-source core is our moat" --strict --json
```
