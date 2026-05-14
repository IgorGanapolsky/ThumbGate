# Stripe Payment Link audit — 2026-05-14

**Why this audit:** Data analysis surfaced "pricing schizophrenia" (4 prices across 2 motions on every public surface). Behind that, the repo references **15 unique** Stripe Payment Links. Some are live tier links, some are dead test links, some are old campaign-specific one-offs. Funnel-leak risk: a prospect clicks a stale link, lands on a Stripe error, never returns.

## Inventory (by reference count)

| Refs | URL | Likely status (needs CEO verify in Stripe dashboard) |
|---|---|---|
| 10 | `buy.stripe.com/bJe14naiE9Lo7xT49Z3sI12` | LIVE — most-referenced, likely the canonical Pro monthly |
| 9 | `buy.stripe.com/fZufZhaiE5v819vdKz3sI14` | LIVE — annual or team tier |
| 9 | `buy.stripe.com/eVq5kDfCY7Dg4lH49Z3sI13` | LIVE — secondary tier |
| 9 | `buy.stripe.com/7sY8wP4Yk7Dg9G10XN3sI15` | LIVE — secondary tier |
| 7 | `buy.stripe.com/00w14neyUcXA5pL5e33sI0e` | LIVE — older Pro link |
| 6 | `buy.stripe.com/7sYcN5bmIf5IcSd8qf3sI0a` | LIVE — older link |
| 5 | `buy.stripe.com/aFa8wPgH29Lo4lH35V3sI0w` | **LIVE — the $19 Quick Read link on /pro** (verified earlier this session) |
| 4 | `buy.stripe.com/fZu9AT76saPsg4pbCr3sI0f` | Status unknown |
| 2 | `buy.stripe.com/aFa4gz1M84r419v7mb3sI05` | Likely campaign one-off |
| 2 | `buy.stripe.com/4gM6oHgH2bTw4lH6i73sI0z` | Likely campaign one-off |
| 1 | `buy.stripe.com/DRYRUN` | Test sentinel — safe to keep |
| 1 | `buy.stripe.com/8x25kDcqMaPs9G15e33sI0p` | Likely campaign one-off |
| 1 | `buy.stripe.com/7sYfZhgH29LodWhdKz3sI0v` | Likely campaign one-off |
| 1 | `buy.stripe.com/3cI8wPfCYaPs2dzdKz3sI07` | Likely campaign one-off |
| 1 | `buy.stripe.com/3cI7sLgH25v8dWh5e33sI0o` | Likely campaign one-off |

## Recommended consolidation

**Active set after this PR (Sprint-only public surface):**

1. **$499 Workflow Hardening Sprint** — currently NO Stripe Payment Link, only a `#workflow-sprint-intake` form. After first sale, create a `buy.stripe.com/sprint-499` Payment Link and add it to the new `/pricing` page CTAs.
2. **$19/mo Pro** — keep the most-referenced link (`bJe14naiE9Lo7xT49Z3sI12`) as canonical. Self-serve from `/checkout/pro` only (no longer surfaced on `/pricing` or `/`).
3. **$149/yr Pro annual** — keep one canonical annual link. Currently fragmented across 3-4 URLs.
4. **$49/seat Team** — keep one canonical Team link. Currently fragmented.

**Suggested next CEO actions (NOT autonomous — Stripe dashboard work):**

1. Open Stripe dashboard → Payment Links → archive every link not in the active set above.
2. Update `scripts/commercial-offer.js` constants to reference ONLY the canonical surviving URLs.
3. Run `grep -rh 'buy.stripe.com/' scripts/ public/ docs/` once more after dashboard archives — anything still referencing an archived URL should be rewritten or deleted.

## Why this is not in this PR

This PR ships the public `/pricing` and `/case-studies` pages — strict simplification of the conversion funnel. The deeper Payment Link consolidation requires Stripe-dashboard access (CEO-only) and care around webhooks / existing recurring subscriptions. Surfaced here so the cleanup is queued, not lost.
