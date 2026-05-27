---
name: revenue-truth
description: Fetch live ThumbGate revenue, paid orders, and funnel telemetry from production billing endpoints. Use BEFORE answering any question about money, conversion, traffic, or "why we didn't make X." Never quote planning documents as actuals.
allowed-tools:
  - Bash
  - Read
---

# Revenue Truth — Live Data Before Any Money Claim

## Why this exists

On 2026-05-26 the CTO answered "why didn't we make money?" three times in a row by quoting *planning documents* and *stale March snapshots* as if they were current telemetry. The CEO had to push back with "are you sure?" three times before the CTO admitted he had never queried the live billing endpoint. This skill exists so that never happens again.

The first version of this skill (written same day) referenced an env var named `THUMBGATE_ADMIN_KEY` that does not exist anywhere in the codebase — a name I invented without grepping. The CEO caught it with another "are you sure?". The skill now defers to the canonical `scripts/revenue-status.js` pipeline so it cannot drift again.

## Hard rule

**Before claiming any revenue, visitor, conversion, or funnel number, you MUST run `node scripts/revenue-status.js` and quote its output. If no credentials are configured, say so — do not fall back to planning docs.**

## Canonical command

```bash
node scripts/revenue-status.js
```

Reads credentials in this exact priority order (same as `scripts/operational-summary.js` and `scripts/operational-dashboard.js`):

1. `$THUMBGATE_OPERATOR_KEY` — read-only billing-summary access, recommended for agents
2. `~/.config/thumbgate/operator.json` — created by `node bin/cli.js billing:setup`
3. `$THUMBGATE_API_KEY` — full admin, only when operator unavailable

Output sections (quote these directly, never paraphrase):
- `Source:` — `hosted-billing-summary` (live) vs `local-fallback` (no creds)
- `Today / 30d / Lifetime:` — visitors, pageViews, checkoutStarts, paidOrders, bookedRevenue
- `30d attribution coverage` — channel telemetry quality
- `Gaps:` — exact phrases describing what's missing

## Quick lookups against the same endpoint

If you need a single field rather than the full report, query directly:

```bash
KEY="${THUMBGATE_OPERATOR_KEY:-${THUMBGATE_API_KEY:-}}"
[ -z "$KEY" ] && { echo "no operator/api key configured"; exit 1; }

curl -fsS \
  -H "Authorization: Bearer ${KEY}" \
  "https://thumbgate-production.up.railway.app/v1/billing/summary?window=30d" \
  | jq '{
      window,
      booked_cents: .revenue.bookedRevenueCents,
      paid_orders: .revenue.paidOrders,
      checkout_starts: .funnel.checkoutStarts,
      visitors: .funnel.uniqueVisitors,
      acquisition: .funnel.acquisitionBySource
    }'
```

## Stripe direct (cross-check only)

```bash
curl -fsS https://api.stripe.com/v1/charges?limit=20 \
  -u "${STRIPE_SECRET_KEY:?set STRIPE_SECRET_KEY in env}:" \
  | jq '[.data[] | select(.paid==true and .refunded==false)
         | {amount, created, description, customer}]
        | {count: length, total_cents: (map(.amount) | add)}'
```

Note the var is `STRIPE_SECRET_KEY` (matches `src/api/server.js:2597`), not `STRIPE_SECRET`. If the two sources disagree, **`/v1/billing/summary` is truth** for booked-revenue claims; Stripe disagreement is an attribution bug worth filing.

## What counts as truth vs. noise

| Source | Truth? | Notes |
|--------|--------|-------|
| `scripts/revenue-status.js` output where `Source: hosted-billing-summary` | YES | Backed by Stripe-reconciled ledger |
| `scripts/revenue-status.js` output where `Source: local-fallback` | NO | Means no key configured; numbers are zero-state local |
| Stripe API `/v1/charges` | YES | Cross-check only |
| `reports/gtm/*/operator-close-packet.md` numbers labeled "revenue plan" | NO | These are forecasts |
| `docs/VERIFICATION_EVIDENCE.md` snapshot dates | YES at that date, NO as current | Always check the date in the section heading |
| `docs/COMMERCIAL_TRUTH.md` cumulative line | YES as of file's "Updated:" date | Stale if `git log -1 -- docs/COMMERCIAL_TRUTH.md` is >7 days old |

## If no credentials are configured

State this exactly:

> "No operator key in this session's env and no `~/.config/thumbgate/operator.json` on this container. `scripts/revenue-status.js` reports `Source: local-fallback`. The last verified production snapshot in the repo is `<date>: <numbers>` from `docs/VERIFICATION_EVIDENCE.md`. Any number labeled '30d' in operator packets without a corresponding live curl is a forecast, not measured traffic."

Then offer one specific resolution:

> "To unlock live numbers for this session AND future sessions: paste a `THUMBGATE_OPERATOR_KEY` value into the harness env (the agent container's env, not Railway's server env). Generate one with `node bin/cli.js billing:setup` on a machine where the admin key is already configured, or copy the existing operator key from Railway's variables."

Then stop. **Do not speculate. Do not quote forecasts as actuals.**

## Channel-attribution sanity check

When booked revenue is low, also pull acquisition breakdown:

```bash
KEY="${THUMBGATE_OPERATOR_KEY:-${THUMBGATE_API_KEY:-}}"
curl -fsS \
  -H "Authorization: Bearer ${KEY}" \
  "https://thumbgate-production.up.railway.app/v1/billing/summary?window=30d" \
  | jq '.funnel.acquisitionBySource'
```

This tells you whether traffic came from channels we actually posted to (Bluesky, Threads, Reddit) or from background ai_search / direct. Channel mismatch is usually the real story.

## If you're running from a cloud Claude Code session and seeing 401

Use the wrapper, not the raw script:

```bash
npm run revenue:truth     # or: bash bin/revenue-truth.sh
```

The wrapper handles three branches:

1. **Operator key configured AND fresh.** Runs the canonical pipeline. Output starts with `Source: hosted-billing-summary`.
2. **Operator key configured but STALE** (env var or `~/.config/thumbgate/operator.json` exists but no longer authenticates against Railway after a rotation). Runs the pipeline, then prints a loud `WARNING — configured operator key authenticated against the LOCAL fallback` block with the exact fix command. This is what you want to see when describing the 401 to the CEO instead of guessing.
3. **No operator key AND shell looks like a cloud session** (`$CI`, `$CODESPACES`, `$GITHUB_ACTIONS`, `$CLAUDE_CODE_REMOTE`, or `/home/user/...` Linux container path). Prints a one-paragraph "revenue truth is local-only by design, run from your laptop, do NOT paste the key here" message and exits `0`. This is the **expected** posture for cloud sessions — not a bug, not a blocker, not something to keep reporting back to the CEO.

The wrapper refuses to accept the operator key as a CLI argument (exits 64). Pasting the key on the command line would leak it to shell history; pasting it into the Claude transcript would leak it to the model context. Per CLAUDE.md hard-block rule #2.

**Anti-pattern this section exists to prevent:** an agent in a cloud session running `node scripts/revenue-status.js` directly, hitting 401, then repeatedly telling the CEO "I can't see hosted revenue" across multiple turns as if it were news. After the first observation, route to `npm run revenue:truth` so the diagnostic message is the response, not a back-and-forth.
