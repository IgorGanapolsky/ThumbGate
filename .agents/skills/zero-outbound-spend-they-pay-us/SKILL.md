---
name: zero-outbound-spend-they-pay-us
description: Enforce the permanent $0 Outbound Spend / They-Pay-Us mandate across all emails, negotiations, partnerships, M&A/licensing pitches, and tool calls. Never offer to pay cash, wire money, buy out IP upfront, or purchase external subscriptions.
---

# Zero Outbound Spend Mandate — THEY PAY US ($0 Outbound Cash)

## Non-Negotiable Rule (Added 2026-10-22)

1. **$0 Outbound Cash Spend — Forever:**
   - Igor / ThumbGate **NEVER** spends money (`outboundCashSpendUsd === 0`, `upfrontWireUsd === 0`).
   - **NEVER** offer to pay cash, wire tranches (e.g., "50% wired on signing"), pay a fixed buyout price out of pocket, or buy paid tiers/subscriptions from external founders, vendors, or partners.
2. **Steal the Format & Build Natively First:**
   - When an external founder pitches a tool, detector, model router, or workflow (e.g., Gaetano Franco's Agent Reliability, Cello, Paper Instruments), extract and implement the valuable architectural patterns natively inside ThumbGate (`scripts/rrsi-doctor.js` + tests) at **$0 cost**.
3. **Flip Every Negotiation so THEY PAY US:**
   - **Path 1 — Partner Pays Us (`$499` Diagnostic or `$19/mo` Pro):** Charge the external founder/company **`$499`** for a **Managed Workflow / Enforcement Integration Diagnostic** (or **`$19/mo` Pro**) to wire their tool into ThumbGate's `<0.5ms` `PreToolUse` firewall and commercial distribution rail.
   - **Path 2 — 100% Customer-Funded Revenue Share (`$0` Upfront):** If an IP transfer or partnership is structured, **100% of any payout must come strictly out of net cash collected from paying customers they bring into the funnel first** (`outboundCashSpendUsd === 0`). If they bring $0 in customer sales, we pay $0.
4. **Pre-Send Verification Gate:**
   - Reject any draft, email, or term sheet containing `"wire"`, `"upfront payment"`, `"fixed buyout price"`, `"we pay"`, or any `outboundCashSpendUsd > 0`.
