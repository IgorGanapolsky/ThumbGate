# Change: create a Stripe Checkout Session only after a confirmed human click, and tag every session with where it came from

Status: proposed, revised after one goldfish review, 2026-11-18. Owner: plugin-evals session. Base commit: `41b4566d4` on `main`.

## Problem

Read-only Stripe pull on 18 Nov 2026 (`docs/checkout-leak-2026-11-18.md`, re-pulled with `payment_link` and `after_expiration` fields):

- 575 live sessions in 30 days, 0 paid by anyone outside the owner. 400 came from the website.
- 141 of the 400 were created in same-minute bursts.
- The 323 website sessions our server made all carry `installId` and `after_expiration.recovery.enabled`. The 77 with no attribution have no `installId`; 76 of those 77 are Stripe payment-link sessions (Stripe creates them when a visitor opens the link, so metadata code in `scripts/billing.js` cannot reach them). The remaining 1 has neither `installId` nor a payment link and may come from the Cloudflare worker in `workers/src/billing.ts`.
- Our own sessions record landing path `/` on every one: `buildCheckoutBootstrapBody` reads the `landing_path` query parameter and falls back to `'/'` (`src/api/server.js:3243`, `:3252`), and every caller leaves it out. The stored `referrer` is the raw `Referer` header including its query string (`src/api/server.js:3251`).
- What creates a session with no click proof today:
  - `GET /checkout/pro?confirm=1&customer_email=<valid>` from a non-bot user agent (`src/api/server.js:9093`).
  - `GET /go/pro-direct|pro-annual|founding-100` from a non-bot user agent that is not caught by the rapid guard (`src/api/server.js:3600`).
  - `POST /v1/billing/checkout` with a valid email, no click or rate check (`src/api/server.js:11111`).
  - Any `GET /go/<slug>` whose destination is a Pro payment link: the 302 at `src/api/server.js:3674` hands the visitor, or a link scanner, to `buy.stripe.com`, where Stripe creates a session with none of our metadata.
- The confirm page's primary button is a plain GET link to `/go/pro-direct` or `/go/pro-annual` (`src/api/server.js:2993`, `:3001`, `:3048`).
- Abandoned-checkout recovery and promotion consent are already on: `after_expiration` since `01b19cc8b` (21 Oct), `consent_collection` since `ea26b1f8a` (11 Nov). Only `buildCheckoutSessionPayload` is tested for it, not the `sessions.create` call.
- Production runs behind Railway's edge (`server: railway-hikari`, checked with a plain HEAD request 18 Nov), not Cloudflare. The repo already trusts `x-real-ip` only when `RAILWAY_ENVIRONMENT_ID` or `RAILWAY_PROJECT_ID` is set and otherwise ignores forwarding headers (`src/api/server.js:5967-5978`).

## Goals and non-goals

- Goal: our server creates no Stripe session unless the request is a POST that carries a short-lived single-use token fetched by page JS after a trusted pointer or keyboard event, from a browser-class user agent, and the client IP is within 2 admissions per minute and the site is within a global ceiling.
- Goal: every session our server creates carries `landingPage`, `referrer` (no query string), `uaClass` and `buttonId` in Stripe metadata.
- Goal: `/go/*` slugs that sell the Pro subscription never redirect a bare GET to a payment link.
- Not a goal: stopping a determined script. Every signal here (user agent, headers, a token endpoint a script can call) can be supplied by a script. The gate stops crawlers, link scanners, uptime monitors and scripts that do not run the page; against a script that rotates IPs it limits damage to the global ceiling, not to zero. The metadata fields `landingPage` and `buttonId` are client supplied and are recorded as untrusted.
- Not a goal: deactivating existing `buy.stripe.com` links in Stripe (a live-account action, the lead's call), or any price, copy or plan change.
- Not a goal: the one-time packs (`bundle-49`, `playbook-10`, `playbook-999`) and the operator service links. They stay as they are.
- Not a goal: the Cloudflare worker `workers/src/billing.ts`. It creates sessions on its own and is not gated here. Evidence it matters little: at most 1 of 575 sessions fits its signature. It is reported so the lead can decide.
- Must stay true: local mode (no Stripe key) keeps working for tests; the live-key refusal for probe requests stays; Stripe metadata stays within 50 keys and 500 characters per value.

## Alternatives considered

- Do nothing: the 30-day conversion number stays unreadable.
- Page-embedded signed token only: a scraper can read it from the HTML. A token fetched after a trusted event is not in the page.
- Reuse `rapidCheckoutGuard`: 20-second window, keyed on IP plus user agent, blocks the second hit. The lead asked for more than 2 a minute per IP, so a new counter is needed.
- Gate only the three server routes: a future caller of `createCheckoutSession` could skip it. The gate also lives in `createCheckoutSession`.
- Trust `cf-connecting-ip` or the leftmost `x-forwarded-for`: both are client supplied here.

## Requirements

- REQ-01: A token issued for one IP and user agent verifies once; a tampered, expired, replayed, wrong-IP, wrong-user-agent or missing token is refused with a distinct reason.
  Check: `node --test tests/checkout-human-gate.test.js` passes the `token` cases.
- REQ-02: The burst limiter admits 2 per IP per 60 seconds and refuses the 3rd, admits again after the window, keeps IPs separate, and a global ceiling of 60 admissions an hour refuses the 61st. The IP key is `x-real-ip` only when running on Railway, else the socket address; `cf-connecting-ip` and `x-forwarded-for` values never change the key.
  Check: `node --test tests/checkout-human-gate.test.js` passes the `burst` cases, including spoofed `cf-connecting-ip` and rotating `x-forwarded-for`.
- REQ-03: `classifyUserAgentClass` returns `browser`, `bot` or `unknown` (no user agent); only `browser` is admitted; Instagram, LinkedIn and Facebook in-app browser strings classify as `browser`.
  Check: `node --test tests/checkout-human-gate.test.js` passes the `uaClass` cases.
- REQ-04: Click metadata always has `landingPage`, `referrer`, `uaClass` and `buttonId`; the referrer has its query string and fragment removed and is cut to 200 characters; a missing or invalid value becomes `unknown`; `landingPage` must look like a URL path and `buttonId` like `[A-Za-z0-9_:.-]{1,80}`, otherwise `unknown`.
  Check: `node --test tests/checkout-human-gate.test.js` passes the `metadata` cases (including a script-injected value).
- REQ-05: `GET /checkout/pro?confirm=1&customer_email=<valid>` with a browser user agent returns the confirm page, the Stripe client is never called, and no `checkout_session_created` funnel event is written. The same holds for a bot user agent.
  Check: `node --test tests/checkout-human-gate.test.js` cases `bare GET creates no session` (asserts the fake client's call count is 0 and that the funnel ledger directory the server wrote to is the test directory).
- REQ-06: `POST /checkout/pro` without a token returns 403; with a token from `POST /v1/checkout/click-token` it creates a session whose metadata has the four click keys; a third admission from one IP inside a minute returns 429. The form field `click_token` is read from the form body.
  Check: cases `POST without token`, `POST with token`, `third POST in a minute`.
- REQ-07: `GET /go/pro-direct`, `/go/pro-annual`, `/go/founding-100` and every `/go/*` slug whose destination is the Pro payment link return a redirect to `/checkout/pro` and never to `buy.stripe.com`, for a browser user agent, a bot user agent and POST without a token. The one-time packs and operator links are unchanged. The confirm page's primary button is a POST form (not a GET link to these slugs), so the page does not redirect to itself.
  Check: cases `pro slugs never redirect to a payment link`, `one-time packs unchanged`, `confirm page primary button is a form`.
- REQ-08: `POST /v1/billing/checkout` without a token returns 403 with code `HUMAN_CLICK_REQUIRED` and creates no session; with a token it passes the gate.
  Check: case `billing checkout needs a token` (asserts the code, not only the status).
- REQ-09: `createCheckoutSession` outside local mode refuses with code `HUMAN_CLICK_REQUIRED` (403) when called without `humanClick.admitted`, before any Stripe call.
  Check: unit case using a fake client injected through `_setStripeClient`, whose `create` fails the test if called.
- REQ-10: The `sessions.create` call made by `createCheckoutSession` for a subscription carries `after_expiration.recovery.enabled === true` and `consent_collection.promotions === 'auto'`, and still carries `after_expiration` when `consent_collection` is dropped on retry. The fake client never reaches live Stripe.
  Check: unit cases `session create carries after_expiration` and `retry keeps after_expiration` in `tests/checkout-recovery-consent.test.js`.
- REQ-11: The interstitial-bypass redirect to a Pro payment link is removed.
  Check: `grep -c "checkout_interstitial_bypass_redirect" src/api/server.js` prints `0`.
- REQ-12: The new test file is registered in `package.json` and the `test` chain, and it runs and passes.
  Check: `node --test tests/test-suite-parity.test.js` exits 0 and `node --test tests/checkout-human-gate.test.js` shows `fail 0`.
- REQ-13: Submitting the confirm form twice quickly sends one request (the button is disabled after the first submit).
  Check: case `confirm page disables the submit button after the first submit` (inspects the page script).

## Design

- New `scripts/checkout-human-gate.js`: `createTokenService`, `createBurstLimiter`, `clientIpKey`, `classifyUserAgentClass`, `buildClickMetadata`, `createHumanGate`. Token is `base64url(JSON{iat,exp,ip,ua,btn,lp,n}).hmac`, TTL 120 seconds, single use in memory, signed with `THUMBGATE_CHECKOUT_TOKEN_SECRET`, else a key derived from `THUMBGATE_API_KEY`, else random per process. A derived or env key keeps verification valid across instances; single-use state and limits are per instance (a second instance would double the limits). Railway config shows one start command and no replica setting; the instance count was not checked.
- `POST /v1/checkout/click-token`: same-origin (`Origin` host or `Sec-Fetch-Site: same-origin`), browser user agent only. Body `{buttonId, landingPage}`. Returns `{token}`.
- Confirm page JS: capture-phase `pointerdown` and `keydown` listeners record a gesture only when `event.isTrusted`. On submit with no gesture in the last 5 seconds the form is not sent. Otherwise fetch a token, fill the hidden `click_token` field, submit, and disable the button. The primary CTA becomes a form that POSTs to `/go/pro-direct` or `/go/pro-annual` with the same token flow.
- Admission order in `admit`: method is POST, user agent class is `browser`, token valid (not yet burned), per-IP limit, global ceiling, then the token is burned.
- `POST /checkout/pro` and `POST /go/*`: copy `click_token` from the form body.
- `createCheckoutSession` takes `humanClick`; outside local mode it refuses unless `humanClick.admitted`. Click metadata is merged in every mode. `_setStripeClient` is exported so tests can inject a fake client.
- `/go/*`: Pro-subscription targets redirect any non-admitted request to `/checkout/pro`. Dynamic session creation runs only after admission; its failure also redirects to `/checkout/pro`.
- A refused POST on `/checkout/pro` renders the confirm page with 403 (token) or 429 (limit).
- After a Stripe error on an admitted request, `/checkout/pro` still redirects to `hostedConfig.checkoutFallbackUrl`. That is a person who passed the gate meeting a Stripe error. Left in place and reported.
- Rollback: revert the commit. No data migration.

## Risks

- A person with JavaScript off cannot buy through our pages. The page carries a `noscript` note and no alternative.
- People behind one office IP share 2 per minute; whether real buyers ever do 3 a minute is not measured (the ledger holds no per-IP data).
- Tokens are lost on restart unless a stable signing value is set; the life is 2 minutes.
- A script that rotates IPs and calls the token endpoint directly still gets sessions, up to 60 an hour site-wide.
- Existing tests that assert a 302 to `buy.stripe.com` or a session on GET fail and are rewritten with the same assertion counts.
- The 76 payment-link sessions come from links shared outside our pages and continue until those links are deactivated.

## Unknowns

- Where each existing payment link is posted outside this repo's served pages.
- Whether the Cloudflare worker is deployed and receiving traffic.
- How many app instances run in production.

## Files changed

- `scripts/checkout-human-gate.js` (new)
- `scripts/billing.js`
- `src/api/server.js`
- `tests/checkout-human-gate.test.js` (new; holds the REQ-10 session-create check too)
- `tests/checkout-recovery-consent.test.js`
- `tests/checkout-pro-confirmation-gate.test.js`
- `tests/checkout-bot-guard.test.js`
- `tests/checkout-no-live-probe.test.js`
- `tests/billing.test.js`
- `tests/api-server.test.js`
- `tests/e2e-product-flows.test.js`
- `tests/hosted-tenant-isolation.test.js`
- `tests/stripe-checkout-abandonment-fix.test.js`
- `tests/package-boundary.test.js`, `tests/public-bundle-ratchet.test.js` (bundle ceiling 690 to 692: two new shipped scripts)
- `package.json`, `CHANGELOG.md`
- `docs/designs/2026-11-18-human-click-checkout.md`

Built beyond the first draft: test-only env knobs `THUMBGATE_CHECKOUT_BURST_MAX` and `THUMBGATE_CHECKOUT_GLOBAL_MAX` (shared test servers see one address). Pro subscription slugs (`pro-direct`, `pro-annual`, `founding-100`, `operator-pro`) are exempt from the older rapid-checkout guard, because the click token and burst limit now cover them.

## Limits

Owner: plugin-evals session. Write scope: the files above. One goldfish review round done before building. Tests run one file at a time under `nice -n 15`. Two commits: the gate (REQ-01 to REQ-09, REQ-11 to REQ-13) and the session-create coverage (REQ-10).

## Evidence

Run one file at a time under `nice -n 15`, after the last edit, on 2026-11-18. Stripe is a fake in every test; no live Stripe call and no checkout URL opened.

| Requirement | Check run | Result |
|---|---|---|
| REQ-01 to REQ-09, REQ-11 to REQ-13 | `node --test tests/checkout-human-gate.test.js` (token, burst, metadata, server wiring) plus the rewritten `checkout-pro-confirmation-gate`, `checkout-bot-guard`, `checkout-no-live-probe`, `billing`, `api-server`, `e2e-product-flows`, `hosted-tenant-isolation`, `stripe-checkout-abandonment-fix` | 40, 9, 24, 9, 54, 177, 9, 15, 5 pass, 0 fail |
| REQ-10 | `tests/checkout-human-gate.test.js` (session-create payload carries `after_expiration`) and `tests/checkout-recovery-consent.test.js` | 40 and 5 pass, 0 fail |
| Packaging | `package-boundary`, `public-bundle-ratchet`, `test-suite-parity` | 5, 2, 5 pass |

Commit SHAs are in the final report and in `git log`.
