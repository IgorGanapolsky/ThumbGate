# ThumbGate Revenue Plan

Updated: 2026-07-13

## Goal

Book the first external ThumbGate payment, then build a repeatable path to $100/day after-tax profit.

## Current Truth

- External paid diagnostics: 0 verified.
- Aiventyx listing: 53 raw page loads, 9 checkout clicks, 0 verified payments.
- The prior production `$499` Stripe Payment Link was deactivated. Railway now routes to the active `AI Agent Reliability Audit` Payment Link; the redirect, attribution reference, buyer page, price, and enabled payment controls were verified externally.
- Production revenue summary is not readable from this machine because the operator credential is missing.
- PRs #2883 and #2889 are merged and live; they corrected unsupported public claims and the stale deploy verifier.

## Active Work

- [x] Verify Stripe, PayPal receipt, npm, GitHub, Aiventyx, checkout, and deployment surfaces.
- [x] Close the public-claim gap and verify the exact production build.
- [x] Restore the instrumented Stripe checkout route and verify attribution metadata externally.
- [x] Send Qaiser the intake-first Aiventyx URL and record LinkedIn delivery evidence.
- [x] Preserve Aiventyx as the billing source of truth by making its diagnostic traffic intake-only until its checkout is live.
- [x] Build the diagnostic intake/fulfillment repair: confirmed-payment gating, no Pro provisioning, retry-safe email delivery, secret redaction, and intake quotas.
- [x] Verify the final fulfillment patch: 262/262 targeted tests, 73/73 billing tests, 30/30 end-to-end tests, 48/48 adapter proofs, and 55/55 automation proofs.
- [ ] Merge and deploy the diagnostic intake/fulfillment repair through Trunk.
- [ ] Confirm Aiventyx replaces its direct checkout CTA with the intake-first URL.
- [ ] Verify the first external payment from the actual payment rail before claiming revenue.

## Verification Truth

- Targeted fulfillment suite: 262/262 passing, including adversarial SKU spoofing, exact Payment Link identity, canceled-entitlement replay, credit-pack replay, public trial-input rejection, zero-dollar one-time checkout rejection, non-entitlement service-order isolation, guest checkout, payment-before-email, sender-vs-recipient delivery recovery, and invalid-intake quota tests.
- `npm run test:billing`: 73/73 passing.
- `npm run test:e2e`: 30/30 passing.
- Aiventyx intake-only browser contract: 2/2 passing.
- `npm run prove:adapters`: 48/48 passing.
- `npm run prove:automation`: 55/55 passing.
- Monolithic `npm test`: three existing `rate-limiter.test.js` failures. The test isolates `HOME`, but the previously loaded creator-mode module remains cached and incorrectly reports Pro. This is not caused by the diagnostic diff and must not be reported as green.
- Coverage snapshot: 86.29% lines, 73.72% branches, 87.95% functions; the coverage command is not green because of unrelated environment-sensitive tests.

## Commercial Focus

1. Sell one concrete workflow outcome, not the architecture.
2. Use the $499 diagnostic as the founder-led offer; Pro remains the self-serve follow-on.
3. Capture buyer identity and workflow context before redirecting to payment.
4. Keep acquisition, checkout starts, paid orders, and fulfilled diagnostics as separate metrics.

## Parking Lot

- Restore authenticated production revenue reporting.
- Add PayPal-native payment reconciliation only if Aiventyx activates it as a secondary rail.
- Isolate creator mode in `rate-limiter.test.js` so the monolithic suite is machine-independent.
- Consolidate stale PRs, branches, and worktrees after the revenue loop closes.
- Finish hosted team sync only after a qualified team buyer commits to a pilot.
