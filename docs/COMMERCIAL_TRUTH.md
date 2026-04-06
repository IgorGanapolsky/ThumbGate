# Commercial Truth

Status: current
Updated: April 1, 2026

This document is the source of truth for product, pricing, traction, and proof claims in this repository.

## What is true today

- The open-source `thumbgate` package is free and MIT licensed.
- The current public self-serve commercial offer is **Pro at $19/mo or $149/yr** via Stripe checkout.
- The preserved founder one-time Stripe link still exists for legacy founder buyers, but it is not the default commercial offer.
- The current Team pricing anchor is **$12/seat/mo with a 3-seat minimum**, and the public Team path remains **Workflow Hardening Sprint intake** until hosted rollout scope is qualified.
- The open-source runtime now supports history-aware lesson distillation from the recent conversation window, linked feedback sessions, and reflector rule proposals across CLI, hosted API, Cursor, and Claude Desktop surfaces.
- Verified booked revenue as of March 19, 2026 is **$20.00** from `2` reconciled Stripe charges tied to the current product.
- Verified booked revenue for March 19, 2026 is **$0.00**; there is no evidence of a new paid charge today.
- Engineering verification is strong and should be cited through `docs/VERIFICATION_EVIDENCE.md` and machine-readable proof reports.

## Product Tiers

### Free (local, `npx thumbgate serve`)

- 5 daily feedback captures
- 10 daily lesson searches
- Unlimited recall on the local runtime
- 10 auto-promoted gates plus the core safety policy
- 5 built-in gates
- Single user, single machine
- DPO/KTO export for fine-tuning
- CLI dashboard
- History-aware lesson distillation and linked feedback sessions

### Pro ($19/mo or $149/yr, hosted checkout on Railway)

- Personal local dashboard
- DPO export and advanced data exports
- Founder-license support
- Unlimited custom gates with auto-gate promotion

### Team ($12/seat/mo, min 3, hosted rollout intake-first)

- Shared hosted lesson database
- Generated hosted review views for team, incident, and rollout operations
- Org dashboard with active agents, gate hit rates, and risk agents
- Curated gate template library
- Workflow hardening sprint intake and rollout support
- Team-wide sharing of prevention rules and proof artifacts

## What we must not claim

- Do not treat GitHub stars, watchers, dependents, or npm download counts as customer or revenue proof.
- Do not present AI-agent self-validation as independent market proof.
- Do not use hardcoded scarcity or social-proof claims such as "spots remaining" or "founding members" unless they are backed by live data.
- Do not present historical pricing experiments as the current live offer.

## Proof policy

- Use booked revenue, paid orders, or named pilot agreements for commercial proof.
- Use the admin billing summary and CLI CFO output to distinguish `bookedRevenueCents` from `paidOrders`; not every paid provider event carries a verifiable amount by default.
- Treat Stripe-reconciled charges as booked revenue proof; treat GitHub Marketplace paid events as booked revenue only when the webhook carries plan pricing or plan pricing is configured, otherwise treat them as paid-order proof until invoice amounts are reconciled.
- When legacy GitHub Marketplace rows were written before pricing capture shipped, repair them with `npx thumbgate repair-github-marketplace --write` once plan pricing is available; do not invent amounts without webhook evidence or configured plan prices.
- Treat `workflowSprintLeads` as pipeline evidence only; qualified intake volume is useful for selling, but it is not revenue.
- Use `docs/VERIFICATION_EVIDENCE.md`, `proof/compatibility/report.json`, and `proof/automation/report.json` for engineering proof.
- When in doubt, prefer "early-stage" or "pilot" language over unverified traction claims.
 
