# ThumbGate Observability

## Operator truth path (what to trust)

1. **Hosted first-party ledger** — `/v1/billing/summary` via operator key  
   Visitors, CTA clicks, checkout interstitial, paid orders, booked revenue.
2. **Journey export** — `/v1/telemetry/export` (operator/admin key)  
   Bounded JSONL window + `journeySummary` stage counts.
3. **Public funnel health** — homepage + `/checkout/pro` shape (email required, Pro CTA, no offer-soup leaks).
4. **Third-party analytics** (optional query APIs) — Plausible / PostHog / GA4 ingest on the site; operator *readback* needs API keys.

## Doctor

```bash
npm run observability:doctor
# or
node scripts/revenue-observability-doctor.js
```

Verdicts:
- `ready` — critical + high checks pass
- `degraded` — critical pass; high missing (usually third-party API keys)
- `blocked` — a critical proof path is broken

## Configure local secrets (never commit)

```bash
npm run observability:setup -- --print   # template to stdout
npm run observability:setup -- --write  # writes ~/.config/thumbgate/observability.json (0600)
```

Fill in:

| Field | Env equivalent | Purpose |
|---|---|---|
| `stripeSecretKey` | `STRIPE_SECRET_KEY` | Direct Stripe charge audit |
| `plausibleApiKey` + `plausibleSiteId` | `PLAUSIBLE_*` | Plausible query automation |
| `posthogPersonalApiKey` + `posthogProjectId` | `POSTHOG_*` | PostHog query automation |

Operator key continues to live in `~/.config/thumbgate/operator.json` from `npx thumbgate billing:setup`.

## Activation stage

- **Acquisition**: `cli_init_completed`, checkout sessions, site leads  
- **Activation**: first non-audit feedback capture (`first_feedback_capture`)  
- **Paid**: Stripe/provider paid events  

## Export performance

`/v1/telemetry/export` uses a bounded reverse scan of JSONL ledgers (`scripts/jsonl-window.js`) so large production files do not time out operator tools.
