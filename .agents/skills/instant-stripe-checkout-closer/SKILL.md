---
name: instant-stripe-checkout-closer
description: Diagnose checkout funnel drop-offs, enforce 1-click direct Stripe bypass (/go/pro-direct, $100 Founding Tier, $499 Diagnostic), and run signed-receipt abandoned checkout recovery. Use when conversion rate drops, checkoutInterstitialViews spike with 0 clicks, or checkoutCancelPageViews > 0.
---

# Instant Stripe Checkout Closer

## Purpose

Eliminate checkout interstitial friction between buyer intent (`go_pro` / `go_gpt` CTA clicks) and Stripe settlement, and recover abandoned/cancelled checkouts with deterministic economics gating (`LTV/CAC >= 3x`, `<50ms`).

## Canonical Checkout Rails (Never Use Retired $29 Links)

| Tier | Price | Canonical URL | When to Route |
| --- | --- | --- | --- |
| **Pro Direct (Monthly)** | `$19/mo` | `https://thumbgate.ai/go/pro-direct` (`https://buy.stripe.com/8x2dR91M84r4cSd9uj3sI3f`) | Solo developer self-serve (skips email wall for human browsers; deflects bots to `/checkout/pro`) |
| **Founding Tier (One-Time)** | `$100` | `https://buy.stripe.com/bJe28rduQ5v82dz6i73sJ0n` | Founders, newsletter subscribers, and buyers who want zero recurring billing |
| **Workflow Gate Diagnostic** | `$499` | `https://thumbgate.ai/diagnostic` (`/go/diagnostic`) | Engineering teams with one painful agent workflow failure or FDEs deploying for clients |

## Workflow

1. **Measure Live Funnel Telemetry First:**
   ```bash
   node scripts/revenue-status.js --json
   node scripts/fast-money-engine.js --audit --json
   ```
2. **Enforce 1-Click Direct Stripe Styling:**
   - Ensure `src/api/server.js` styles both `button.primary` and `a.primary` (`#22d3ee` cyan button) so `data-i="pro_checkout_direct_stripe"` (`Skip form — open Stripe checkout directly →`) is visually prominent on `/checkout/pro`.
   - Ensure `public/index.html` routes hero Pro CTAs to `/go/pro-direct`.
3. **Run Abandoned Checkout Recovery (`scripts/checkout-recovery.js`):**
   ```bash
   node bin/recover-checkout.js --session-id cs_live_1 --amount 10000 --email buyer@company.com --firm "Acme AI"
   ```
   - Refuses to fire if `cacPerAttempt >= contributionPerSale` (`$0.05` vs `$96.75`, `LTV/CAC = 1935x`).
   - Appends an HMAC-SHA256 signed receipt to `~/.thumbgate/checkout-recovery-ledger.jsonl`.
