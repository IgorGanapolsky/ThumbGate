# Skill: Verify Pricing Surfaces

Repeatable skill for verifying all revenue-generating pages are live, have analytics,
and have working Stripe links. Covers both ThumbGate and ApplyOps.

## When to use

- Session startup (quick health check)
- After any deploy to ThumbGate or ApplyOps
- CEO asks "why aren't we making money?" or "is everything working?"
- Before any pricing/checkout changes

## Steps

### 1. ThumbGate pricing surfaces

```bash
# Homepage — all 3 analytics
curl -sL https://thumbgate.ai/ | grep -oE 'plausible|posthog|gtag' | sort -u
# Expected: gtag, plausible, posthog

# Pricing page — all 3 analytics + correct prices
curl -sL https://thumbgate.ai/pricing | grep -oE '\$[0-9]+' | sort -u
# Expected: $0, $19, $149   (Free / Pro monthly / Pro annual; Enterprise is "Custom")

# Checkout interstitial — plausible + first-party telemetry ONLY (by design)
curl -sL https://thumbgate.ai/checkout/pro | grep -oE 'plausible|posthog|gtag' | sort -u
# Expected: plausible
# NOTE: the /checkout/pro confirmation interstitial is a deliberately-minimal, sampled,
# bot-protected page (renderCheckoutIntentPage in src/api/server.js). It is instrumented
# with plausible custom events + first-party server telemetry (checkout_interstitial_view /
# _cta_clicked), NOT gtag/posthog page-view scripts. Do NOT "fix" it by adding gtag/posthog —
# that adds latency to the fast checkout path. gtag+posthog belong on /pricing and homepage only.

# Checkout actually redirects to live Stripe (this is the real health signal):
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' "https://thumbgate.ai/checkout/pro?confirm=1&customer_email=test@test.com"
# Expected: 302 https://checkout.stripe.com/c/pay/cs_live_...

# Health check
curl -sf https://thumbgate.ai/health | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'v{d[\"version\"]} up={d[\"uptime\"]:.0f}s ok={d[\"status\"]}')"
```

### 2. ApplyOps pricing surfaces

```bash
# Landing page — all 3 analytics
curl -sL https://igorganapolsky.github.io/applyops/ | grep -oE 'plausible|posthog|gtag' | sort -u
# Expected: gtag, plausible, posthog

# Correct prices shown
curl -sL https://igorganapolsky.github.io/applyops/ | grep -oE '\$[0-9,]+' | sort -u
# Expected: $1,500  $149  $49

# Subpages live
curl -sf -o /dev/null -w '%{http_code}' https://igorganapolsky.github.io/applyops/intake.html
curl -sf -o /dev/null -w '%{http_code}' https://igorganapolsky.github.io/applyops/sample-truth-snapshot.html
# Expected: 200, 200
```

### 3. Stripe payment links

```bash
# ThumbGate Pro checkout redirects to Stripe
curl -sL https://thumbgate.ai/checkout/pro?confirm=1&customer_email=test@test.com -o /dev/null -w '%{http_code} %{redirect_url}'
# Expected: 303 to checkout.stripe.com

# ApplyOps Stripe links resolve
for link in 3cIaEX1M80aO9G1fSH3sI2N 3cI3cvgH26zccSd7mb3sI2O 9B600j4YkcXAcSdayn3sI2P; do
  code=$(curl -sL -o /dev/null -w '%{http_code}' "https://buy.stripe.com/$link")
  echo "$link → $code"
done
# Expected: all 200
```

### 4. Plausible live data

```bash
source /Users/igorganapolsky/workspace/git/igor/ThumbGate/repo/.env

# ThumbGate visitors
curl -s -H "Authorization: Bearer $PLAUSIBLE_API_KEY" \
  'https://plausible.io/api/v1/stats/aggregate?site_id=thumbgate-production.up.railway.app&period=7d&metrics=visitors,pageviews'

# ApplyOps / GitHub Pages visitors
curl -s -H "Authorization: Bearer $PLAUSIBLE_API_KEY" \
  'https://plausible.io/api/v1/stats/aggregate?site_id=igorganapolsky.github.io&period=7d&metrics=visitors,pageviews'

# ThumbGate checkout funnel events (30d)
for event in "pricing_cta_click" "Checkout Pro Viewed" "Checkout Pro Email Submitted" "Checkout Pro Stripe Redirect Started" "Checkout Pro Purchase Completed"; do
  count=$(curl -s -H "Authorization: Bearer $PLAUSIBLE_API_KEY" \
    "https://plausible.io/api/v1/stats/aggregate?site_id=thumbgate-production.up.railway.app&period=custom&date=2026-04-26,2026-05-26&metrics=events&filters=event:name==$event" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['results']['events']['value'])" 2>/dev/null || echo "0")
  echo "$event → $count"
done

# ApplyOps CTA clicks
curl -s -H "Authorization: Bearer $PLAUSIBLE_API_KEY" \
  'https://plausible.io/api/v1/stats/aggregate?site_id=igorganapolsky.github.io&period=30d&metrics=events&filters=event:name==applyops_cta_click'
```

### 5. Quick pass/fail summary

Print a table:

| Surface | Live? | Analytics? | Stripe? | Visitors (7d) |
|---------|-------|-----------|---------|---------------|
| thumbgate.ai | ✅/❌ | 3/3 or N/3 | ✅/❌ | N |
| thumbgate.ai/pricing | ✅/❌ | 3/3 | — | — |
| thumbgate.ai/checkout/pro | ✅/❌ | 3/3 | ✅/❌ | — |
| igorganapolsky.github.io/applyops | ✅/❌ | 3/3 | ✅/❌ | N |

## Pricing truth (last verified 2026-05-26)

### ThumbGate (COMMERCIAL_TRUTH.md is canonical)
- Free: $0 (CLI)
- Pro: $19/mo or $149/yr
- Team: $49/seat/mo (intake-led)

### ApplyOps
- Truth Snapshot: $49
- Resume OS Pro: $149
- Done-For-You Sprint: $1,500

## If something is broken

- ThumbGate pages missing analytics → check `hostedConfig.posthogApiKey` and `hostedConfig.gaMeasurementId` in Railway env vars. Use `skills/configure-analytics/SKILL.md`.
- ApplyOps pages 404 → deploy from Resume repo to `.github.io` repo. Use `skills/applyops-deploy/SKILL.md`.
- Stripe links broken → check Stripe dashboard in Chrome for archived/deleted payment links.
- Plausible returns zeros → check `PLAUSIBLE_API_KEY` and site registration at plausible.io.
