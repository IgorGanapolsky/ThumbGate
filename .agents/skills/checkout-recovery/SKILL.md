---
name: Checkout Recovery Agent (Freebutter/OneShot Oct 2026 steal)
description: Recover abandoned checkouts with a deterministic economics gate and signed receipts. Refuses to fire when recovery CAC >= contribution per sale (freebutter's walk-away rule). Every attempt emits a tamper-evident HMAC receipt into ~/.thumbgate/checkout-recovery-ledger.jsonl.
---

# Checkout Recovery Agent — `thumbgate recover-checkout`

Stolen from freebutter ("Your checkout says nothing. An AI checkout agent that recovers abandoned carts through conversation") and OneShot's signed-receipt ledger model (every dollar an agent spends, signed).

## Entry point

`bin/recover-checkout.js <session.json> [--send]` — wraps `scripts/checkout-recovery.js` (exports `recoverCheckout`, `economicsGate`, `MAST`, `ECONOMICS`).

## The economics gate (non-negotiable)

Public-facts model only — no private customer data:

| Constant | Value | Source |
|---|---|---|
| tier price | $100.00 | thumbgate.ai/checkout/pro |
| Stripe fee | $3.20 | 2.9% + $0.30 US rate |
| recovery LLM call | $0.05 | public Sonnet-class pricing |
| **contribution / sale** | **$96.75** | model |
| **CAC / attempt** | **$0.05** | model |
| **LTV:CAC** | **~1935×** | model |

Gate rule (freebutter): **`if CAC >= contribution → DO NOT FIRE`**. A session with no positive `amount_total` is rejected (`REJECTED_below_accuracy_floor_unverified_state_mutation`). Gate latency <1ms (MAST budget 50ms).

## Signed receipts

Every call (pass or fail) appends to `~/.thumbgate/checkout-recovery-ledger.jsonl`:
```
{ status, channel, source_session, gate:{verdict,contribution_per_sale,cac_per_attempt,ltv_per_cac,ma_st_*}, draft, signed:{timestamp,signer,source}, signature }
```
The HMAC is over the receipt body — flipping any `gate` field breaks the signature (tamper-evident).

## Run discipline (from freebutter)

- Dry-run by default — **approval sends nothing**. `--send` only flips `dry_run`; the human still approves via the dashboard.
- One channel (Stripe checkout recovery). Do not scale until LTV:CAC ≥ 3× (this channel: 1935× — cleared).
- Monthly: report recovery rate + CAC/LTV; stop if the gate goes red.

## Test

`node --test tests/checkout-recovery.test.js` → 8/8 pass.
