# Continue everything — pricing-surface hygiene + Money-Now ops (2026-06-06)

CEO directive: "continue everything. leave no stone unturned." Three threads found in the
working tree / branch state, none of which matched each other. This note tracks decisions.

## State at start (VERIFIED)
- Top-level wrapper repo on `feat/pricing-surface`, even with main, no remote, **zero committed pricing work**. Branch name was the only pricing signal.
- Canonical source `repo/` on `fix/unify-statusline-cache-read-write`, **even with origin/main (0/0)**. The statusline commit `10f85858` my cross-session memory flagged as a "lost race" is already in main — branch is a caught-up pointer, not dangling work.
- Only real in-progress work: 8 uncommitted GTM report edits (Money-Now + community-course-promo cockpit), refreshed today.

## Thread A — pricing surfaces
### Verification (VERIFIED via curl against https://thumbgate.ai, prod v1.27.6 build 6f2458ba)
- Homepage: gtag + plausible + posthog present. OK.
- /pricing: gtag + plausible + posthog present; prices `$0 / $19 / $149`. OK.
- /checkout/pro?confirm=1: **302 → checkout.stripe.com (cs_live_ session)**. Checkout WORKS.
- /checkout/pro interstitial HTML: **only plausible** (no gtag/posthog).

### Decision: the checkout "missing analytics" is NOT a bug — do NOT add gtag/posthog to it.
- `renderCheckoutIntentPage` (src/api/server.js ~2029) is a deliberately-minimal, **sampled** (`shouldSampleCheckoutInterstitial`), bot-protected confirmation page.
- It is instrumented with plausible custom events + **first-party server telemetry** (`sendTelemetry`, `checkout_interstitial_view`, `checkout_interstitial_cta_clicked`), per changeset `pricing-checkout-friction` ("adding first-party pricing page/CTA telemetry").
- Adding gtag/posthog page-view scripts would add latency to a fast page, duplicate instrumentation, and change live revenue-path behavior for no real benefit. REJECTED.

### Real fix: `skills/verify-pricing-surfaces/SKILL.md` was STALE and would have driven a future session to "fix" healthy revenue code (classic "verify against spec, not the bot").
- Price expectation `$0,$19,$49,$149` → corrected to `$0,$19,$149`. ($49 is ApplyOps, not ThumbGate.)
- Checkout interstitial expectation "all 3 analytics" → corrected to "plausible + first-party telemetry", with a note on WHY gtag/posthog are intentionally absent.

### pricing.html cleanup (Team-tier retirement residue)
- DEAD (removed): `.price-card.team-card`, `.price-card.team-card .tier`, `.price-card.team-card li::before` — no element has class `team-card` in pricing.html (Enterprise card uses `enterprise-card`).
- KEPT (NOT dead — corrected an early wrong assumption): `.btn-team` / `.btn-team:hover` are load-bearing — the Enterprise "Talk to us" CTA uses `.btn-team`, the e2e test asserts `#enterprise a.btn-team`, and index.html keys telemetry click-tracking off `.btn-team` (maps to tier/offer dimensions). Renaming would break tests + corrupt analytics. Left as legacy-named-but-functional.

## Thread B/C — Money-Now / GTM
- Draft warm Reddit four-pack follow-ups (DRAFTS ONLY per standing rule — never send).
- Commit the 8 refreshed cockpit reports on a docs branch (not the statusline branch).

## Blockers carried from the cockpit (UNVERIFIED — runtime-local, not fixable here)
- `ZERNIO_API_KEY` absent in this shell → Zernio publish/analytics preview-only.
- Skool public-page reader headless-blocked.
- GitHub API rate-limited in prior shell session.
