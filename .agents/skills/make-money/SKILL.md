---
name: make-money
description: Execute the end-to-end 6-stage autonomous revenue loop whenever the user says "make money", "make money faster", "monetize", or "/make-money". Runs live revenue truth telemetry, 24/7 partner discovery & 9-channel GraphRAG promotion, 30 daily 4-tier omnichannel drafts, 9-platform viral carousels, Gumroad catalog verification ($9.99 Playbook + $49 Corporate-Expense Bundle), and Freebutter abandoned checkout recovery at $0 outbound spend.
---

# Make Money — Master Autonomous Revenue Skill (`/make-money`)

> **Spec:** [`docs/specs/make-money-autonomous-loop.md`](../../../docs/specs/make-money-autonomous-loop.md)
> **Hard Invariants:** `$100/day` North Star · `$0.00` Outbound Spend (`outboundCashSpendUsd === 0`) · ECI Domain Isolation (`@ecisolutions.com` / `@ecinexus.com` blocked) · Zero Babysitting (`humanInterruptionsCount === 0`).

## Immediate Action When Igor Says `"make money"`

Do **not** ask clarifying questions. Immediately run the single canonical orchestrator:

```bash
npm run make:money
# Equivalent to: node scripts/fast-money-engine.js --make-money
```

## What `npm run make:money` Executes Automatically (6 Stages)

1. **Stage 1 — Live Revenue & Funnel Truth (`scripts/revenue-status.js` + `evaluateFastMoneyFunnelAndTierLadder`):**
   - Queries live Railway/Stripe booked revenue and traffic telemetry (`visitors`, `ctaClicks`, `checkoutInterstitialViews`, `checkoutCancelPageViews`).
   - Verifies `/go/pro-direct` 1-click Stripe routing and `a.primary` skip-button styling on `/checkout/pro`.
2. **Stage 2 — 24/7 Inbox Triage, Partner Discovery & 9-Channel GraphRAG (`scripts/thumbgate-24x7-sales-promotion-job.js`):**
   - Sweeps Apple Mail/Gmail non-ECI threads (`thumbgate-inbox-sentinel.js`).
   - Discovers 30 curated + live Show HN partner targets (`proactive-partner-discovery-engine.js`) and writes anti-slop pitch files to `marketing/partner-offers/`.
   - Runs the 9-channel Thompson-Sampling + 3-Tier Agentic GraphRAG promotion cycle (`linkedin`, `x`, `bluesky`, `threads`, `skool`, `biggerpockets`, `reddit`, `zyvop`, `hackernews`).
3. **Stage 3 — 30 Daily 4-Tier Drafts + 9-Platform Viral Carousels (`daily-content-generator.js` + `social-carousel-generator.js`):**
   - Generates 30 daily drafts (`10` platforms × `3` posts) wired with the **4-Tier Value Ladder**:
     - **Tier 1 (`$9.99` Playbook):** `https://iganapolsky.gumroad.com/l/odrkon`
     - **Tier 2 (`$49.00` 1-Time Corporate-Expense Kit):** `https://iganapolsky.gumroad.com/l/vcrho`
     - **Tier 3 (`$100.00` Founding Pass / `$19/mo` Pro):** `https://buy.stripe.com/bJe28rduQ5v82dz6i73sJ0n`
     - **Tier 4 (`$499.00` Workflow Gate Diagnostic):** `https://thumbgate.ai/diagnostic`
   - Generates 9-platform carousel JSONs (`public/assets/carousels/drafts/`) and the 7-slide verified HTML carousel deck (`2026-10-26-linkedin-instagram-carousel-deck.html`).
4. **Stage 4 — Thesys OpenUI Lang Offer Stream (`compileOpenUiLangPricingAndCarouselStream`):**
   - Compiles the 4-tier offer stack into a root-first, catalog-bounded `OpenUI Lang` stream (`-52.8%` to `-67.1%` fewer tokens than JSON).
5. **Stage 5 — Gumroad Catalog & Live Product Audit (`products.json` + `revenue-observability-dashboard.js`):**
   - Audits all published Gumroad products (`yhdbza`, `flyczx`, `odrkon` `$9.99`, `vcrho` `$49.00`).
   - When a new Gumroad draft is queued and BrowserOS Neo (`http://localhost:9111`) is active, publish via `node scripts/gumroad-product-publisher.js <draft.md>`.
6. **Stage 6 — Abandoned Checkout Recovery & Receipt (`scripts/checkout-recovery.js`):**
   - Runs the Freebutter `<50ms` economics gate (`LTV/CAC = 1935x`, `$96.75` contribution vs `$0.05` CAC) and writes the tamper-evident run receipt to `.thumbgate/make-money-last-run.json`.

## Composed Sub-Skills

- `instant-stripe-checkout-closer` — `/checkout/pro` & `/go/pro-direct` conversion + abandoned checkout recovery
- `inbound-partner-flip-monetizer` — `$0`-spend, 50% net-collected rev-share replies for inbound DMs (`--partner-flip`)
- `high-ticket-gumroad-bundle-engine` — `$9.99` Playbook & `$49` Corporate-Expense Bundle publisher
- `viral-carousel-monetizer` — 8-step save/share-ranked carousel & lead-magnet generator (`--carousel`)
- `revenue-truth` & `evidence-first-answer` — live telemetry verification before any revenue claim
