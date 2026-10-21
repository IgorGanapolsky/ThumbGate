---
name: saas-moat-honesty-not-clone
description: Audit ThumbGate against Rob Walling's 8 SaaS moats, enforce Ed25519 signed entitlements on learned models and exporters, and aggregate anonymized cross-customer gate signatures without leaking raw transcripts.
---

# SaaS Moat & Seat-Compression Honesty (Walling 2026 FORMAT)

Use this skill when evaluating SaaS defensibility, entitlement boundaries (`scripts/entitlement.js`, `scripts/license.js`), seat-compression pricing, or cross-customer rule learning (`scripts/saas-moat-honesty.js`).

## Non-Negotiable Rules

1. **No Closed-Source Theater (`MOAT.md`):** Never claim `ThumbGate-Core` holds secret code when 212/216 scripts ship in `npm pack thumbgate`. Defensibility comes from Agency (`PreToolUse` `<5ms` interdiction), Operational Grit (7-CLI adapter matrix), System of Record (tamper-evident ledgers), and the Ed25519-gated Learning Loop.
2. **Enforce Ed25519 Entitlements on Crown Jewels:** Keep the 5 learned models (`risk-scorer.js`, `bayes-optimal-gate.js`, `thompson-sampling.js`, `agent-reward-model.js`, `intervention-policy.js`) and 3 exporters (`export-dpo-pairs.js`, `export-hf-dataset.js`, `export-databricks-bundle.js`) gated behind `scripts/entitlement.js`. Forged `tg_pro_...` prefix keys must fail when `THUMBGATE_ENFORCE_ENTITLEMENTS=1`.
3. **Cross-Customer Signatures Without Raw Transcript Leakage:** Use `distillCrossCustomerSignature()` and `aggregateCrossCustomerLoop()` to aggregate secret-redacted, path-normalized SHA-256 structural rule signatures across orgs (`uniqueOrgs >= 2`, `occurrenceCount >= 3`). Never exfiltrate raw transcripts or unredacted secrets.

## Commands

```bash
npx thumbgate saas-moat-honesty --json
npx thumbgate saas-moat-honesty --map-only --json
node --test tests/saas-moat-honesty.test.js tests/license.test.js tests/entitlement.test.js
```
