# Commercial Truth

Status: current
Updated: March 13, 2026

This document is the source of truth for product, pricing, traction, and proof claims in this repository.

## What is true today

- The open-source `mcp-memory-gateway` package is free and MIT licensed.
- The current public self-serve commercial offer is **Pro at $49 one-time one-time**, hosted on Cloudflare Workers.
- Engineering verification is strong and should be cited through `docs/VERIFICATION_EVIDENCE.md` and machine-readable proof reports.

## Product Tiers

### Free (local, `npx mcp-memory-gateway serve`)

- 500 memories, 100 retrievals/day
- 5 built-in gates
- Single user, single machine
- DPO/KTO export for fine-tuning
- CLI dashboard

### Pro ($49 one-time, hosted on Cloudflare Workers)

- Cloud-synced memories accessible from any machine
- Unlimited memories and retrievals
- Team sharing of prevention rules
- Usage dashboard (memories, retrievals, cache hits, cost savings)
- Unlimited custom gates with auto-gate promotion
- Priority support

## What we must not claim

- Do not treat GitHub stars, watchers, dependents, or npm download counts as customer or revenue proof.
- Do not present AI-agent self-validation as independent market proof.
- Do not use hardcoded scarcity or social-proof claims such as "spots remaining" or "founding members" unless they are backed by live data.
- Do not present historical pricing experiments as the current live offer.

## Proof policy

- Use booked revenue, paid orders, or named pilot agreements for commercial proof.
- Use the admin billing summary and CLI CFO output to distinguish `bookedRevenueCents` from `paidOrders`; not every paid provider event carries a verifiable amount by default.
- Use `docs/VERIFICATION_EVIDENCE.md`, `proof/compatibility/report.json`, and `proof/automation/report.json` for engineering proof.
- When in doubt, prefer "early-stage" or "pilot" language over unverified traction claims.
 
