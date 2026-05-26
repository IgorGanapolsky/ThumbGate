# Skill: ApplyOps Deploy

Repeatable skill for deploying ApplyOps pages to GitHub Pages with full analytics.

## When to use

- After any ApplyOps page edit (pricing, copy, new tier)
- After rotating analytics keys
- When CEO says "ApplyOps is down" or pages return 404

## Architecture

- **Source of truth:** `IgorGanapolsky/Resume` repo, `docs/applyops/` (private)
- **Deployed to:** `IgorGanapolsky/IgorGanapolsky.github.io` repo, `/applyops/` (public)
- The Resume repo is private — GitHub Pages cannot serve from it. All public pages live in the `.github.io` repo.

## Prerequisites

- `gh` CLI authenticated
- Analytics keys available in ThumbGate repo `.env` or memory

## Steps

### 1. Copy pages from Resume repo to public site repo

```bash
cd /Users/igorganapolsky/workspace/git/igor

# Clone if needed
[ -d IgorGanapolsky.github.io ] || git clone https://github.com/IgorGanapolsky/IgorGanapolsky.github.io.git

# Sync pages
cp Resume/docs/applyops/*.html IgorGanapolsky.github.io/applyops/
```

### 2. Inject analytics into all HTML pages

Every ApplyOps HTML file must have these three providers before `</head>`:

**Plausible** (tagged-events for custom event names):
```html
<script defer data-domain="igorganapolsky.github.io" src="https://plausible.io/js/script.tagged-events.js"></script>
<script>window.plausible=window.plausible||function(){(window.plausible.q=window.plausible.q||[]).push(arguments)};</script>
```

**GA4:**
```html
<script async src="https://www.googletagmanager.com/gtag/js?id=G-SZR5039QN4"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag("js",new Date());gtag("config","G-SZR5039QN4");</script>
```

**PostHog:**
```html
<script>!function(t,e){...posthog snippet...}(document,window.posthog||[]);posthog.init("$POSTHOG_API_KEY",{api_host:"https://us.i.posthog.com"})</script>
```
> Get the PostHog project API key from `.env` (`POSTHOG_API_KEY`) or the PostHog dashboard.

### 3. Add CTA click tracking

Every Stripe buy link must have onclick handlers:
```html
onclick="try{plausible('applyops_cta_click',{props:{tier:'snapshot',price:49,placement:'hero'}})}catch(_){};try{posthog.capture('applyops_cta_click',{tier:'snapshot',price:49,placement:'hero'})}catch(_){}"
```

Tiers: `snapshot` ($49), `pro` ($149), `dfy` ($1500).
Placements: `hero`, `card`.

### 4. Push to public repo

```bash
cd /Users/igorganapolsky/workspace/git/igor/IgorGanapolsky.github.io
git checkout -b feat/applyops-update
git add applyops/
git commit -m "feat(applyops): update pages"
GIT_ASKPASS="" GH_TOKEN=$(gh auth token) git -c credential.helper='!f(){ echo "username=x-access-token"; echo "password=$GH_TOKEN"; }; f' push -u origin feat/applyops-update
gh pr create --repo IgorGanapolsky/IgorGanapolsky.github.io --title "update applyops pages" --body "..."
gh pr merge <PR#> --repo IgorGanapolsky/IgorGanapolsky.github.io --squash
```

### 5. Verify

```bash
# Page is live
curl -sf https://igorganapolsky.github.io/applyops/ | grep -c 'ApplyOps'

# All 3 analytics present
curl -sL https://igorganapolsky.github.io/applyops/ | grep -oE 'plausible|posthog|gtag' | sort -u

# Stripe links resolve
curl -sL -o /dev/null -w '%{http_code}' 'https://buy.stripe.com/3cIaEX1M80aO9G1fSH3sI2N'

# Plausible collecting data
source /Users/igorganapolsky/workspace/git/igor/ThumbGate/repo/.env
curl -s -H "Authorization: Bearer $PLAUSIBLE_API_KEY" \
  'https://plausible.io/api/v1/stats/aggregate?site_id=igorganapolsky.github.io&period=7d&metrics=visitors'

# Subpages
curl -sf https://igorganapolsky.github.io/applyops/intake.html | grep -c 'Intake'
curl -sf https://igorganapolsky.github.io/applyops/sample-truth-snapshot.html | grep -c 'Truth Snapshot'
```

## Current Stripe links (last verified 2026-05-26)

| Tier | Price | Stripe Link ID |
|------|-------|---------------|
| Truth Snapshot | $49 | `3cIaEX1M80aO9G1fSH3sI2N` |
| Resume OS Pro | $149 | `3cI3cvgH26zccSd7mb3sI2O` |
| Done-For-You Sprint | $1,500 | `9B600j4YkcXAcSdayn3sI2P` |

## Plausible event reference

| Event | Props | Source |
|-------|-------|--------|
| `applyops_cta_click` | tier, price, placement | Client-side onclick |

## Gotchas

- The `.github.io` repo uses HTTPS credential helper, not SSH. Use the `GH_TOKEN` push pattern above.
- Resume repo is private. Never make it public — it has personal application data.
- Plausible domain is `igorganapolsky.github.io`, NOT `thumbgate-production.up.railway.app`.
