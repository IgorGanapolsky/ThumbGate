# Change: /admin redirects signed-out visitors, refuses non-owners with 403, and shows the money board

Status: proposed, 2026-11-19. Owner: builder session (Claude). Base commit: `96474dacc` on `origin/main`.

## Problem

Igor opened `https://thumbgate.ai/admin` at 2:32 PM and got `{"error":"Not found"}`. `origin/main` already serves an owner admin (`scripts/owner-admin.js`, `public/admin.html`, the private-route block in `src/api/server.js`). It was built to hide itself: a signed-out visitor, a signed-in non-owner and an expired session all get the same 404, so a signed-out owner cannot tell a missing page from a missing login. The page also has no money board: it shows Stripe records, hosted data, analytics and observability, but not paying customers, active Pro, revenue, the human-versus-bot split of checkout starts, or leads by source.

The earlier admin commits `f4d2c9f39` and `596f086d4` are not on `main`. They rest on a typed-email "founder login" in the stale branch's cloud token firewall module (absent from `main`), the code the sign-in fix (`1f3cb6d18`) removes, so nothing from them is reused. Only the idea (an owner-only page) is.

## Goals and non-goals

- Goal: a signed-out `GET /admin` answers 302 to `/signin?next=/admin`, never 404 and never data.
- Goal: a valid Google or Apple session whose email is not in `THUMBGATE_OWNER_EMAILS` gets 403 and no data on every admin path, page and API.
- Goal: the owner sees a Money board first: paying customers, active Pro, revenue (last 30 days), checkout starts and completions for the last 7 days split into human and bot, visitors and checkout activity, and lead counts by source.
- Goal: the owner allowlist comes only from the `THUMBGATE_OWNER_EMAILS` environment variable. The admin gate contains no email address.
- Not a goal: a typed-email or password login for the admin. The only way in stays the verified Google or Apple round trip that already issues `thumbgate_auth_session`.
- Out of scope: returning to `/admin` automatically after sign-in (the Apple callback is a cross-site POST that a Lax cookie would not survive). After sign-in the owner opens `/admin` again.
- Not a goal: any other change to the existing Stripe, data, analytics or observability sections.

## Alternatives considered

- Rebuild the admin from the two old commits: they depend on the typed-email founder login, which is the flaw the sign-in fix removes. Rejected.
- Keep the all-404 behaviour and only add the money board: leaves Igor staring at "Not found". Rejected; he asked for 302 and 403.
- Redirect every unauthenticated request, including the API, to the sign-in page: an API client would follow a redirect to HTML. Rejected; signed-out API calls keep the private 404, and only the page redirects.
- Compute the money numbers in the browser from existing sections: needs several round trips and cannot split checkouts by user-agent class. Rejected; one server section, `GET /v1/admin/money`.

## Requirements

- REQ-01: a signed-out, expired or unknown-cookie `GET /admin`, `/admin/` and `/admin.html` return 302 with `Location: /signin?next=%2Fadmin`, `Cache-Control: private, no-store`, and no body data.
  Check: `node --test --test-name-pattern="signed out" tests/admin-board.test.js` passes.
- REQ-02: a valid Google or Apple session whose email is not on the allowlist gets 403 and `{"error":"Forbidden"}` on `/admin`, `/v1/admin/money` and `/v1/admin/stripe/customers`, and no Stripe or billing collection runs.
  Check: `node --test --test-name-pattern="not on the allowlist" tests/admin-board.test.js` passes.
- REQ-03: an owner session gets 200 on `/admin` and `/v1/admin/money`; the money response carries `payingCustomers`, `activePro`, `revenueLast30Days`, `checkouts7d` with `human`, `bot`, `completedHuman`, and `leadsBySource`, and no Stripe secret or card data.
  Check: `node --test --test-name-pattern="owner" tests/admin-board.test.js` passes.
- REQ-04: when Stripe or the billing summary is unavailable the money section reports `unavailable` with no invented zero.
  Check: `node --test --test-name-pattern="unavailable" tests/admin-board.test.js` passes.
- REQ-05: `GET /signin` returns 200 HTML with a Google and an Apple link to `/v1/cloud/sso/authorize` and no email input.
  Check: `node --test --test-name-pattern="sign-in page" tests/admin-board.test.js` passes.
- REQ-06: the existing owner-admin behaviours (forged credentials ignored, CSP, revocation on allowlist change, Stripe projection) still pass with the 404 expectations updated to 302 and 403.
  Check: `node --test tests/owner-admin.test.js` passes.
- REQ-07: the new test file is listed in `npm test` (parity).
  Check: `node --test tests/test-suite-parity.test.js` passes.

## Decisions after the fresh-context review

- Session states are three: none (no cookie, unknown, expired, or an unreadable store), non-owner (any unexpired session, API-key sessions included) and owner (Google or Apple session whose email is on the allowlist). Non-owner gets 403 on every admin path and method; none gets 302 only on GET and HEAD of the page URLs and keeps the private 404 everywhere else, including the API.
- The money numbers are labelled by basis: `payingCustomers` is external paid orders in 30 days, `activePro` is active Stripe subscriptions excluding owner emails (first 100 only, flagged), revenue is a per-currency map with its reconciliation status. Each block fails alone and reports null, never zero.
- Checkouts come from `scripts/checkout-session-count.js` behind the Stripe read slot with an 8 second deadline. The response returns started, human, completed, paid, and every excluded bucket, because crawler checkouts are refused before Stripe and sessions older than the human gate are unclassified.
- The money result is cached for 60 seconds so the first tab does not trip the two-collection cap or hammer Stripe.
- `next` on `/signin` is an inert hint; nothing reads it.
- A 403 writes one server log line naming the provider, never the email.

## Files changed

- `scripts/owner-admin.js`: `readSessionIdentity`, the `money` section, `collectMoney`.
- `src/api/server.js`: the private-route gate (302, 403) and the `/signin` route with its page.
- `/signin` is served from an inline constant in `src/api/server.js` (a public HTML file would add to the npm bundle that the ratchet test pins).
- `public/admin.html`: a Money tab, first and default.
- `tests/admin-board.test.js` (new) and `tests/owner-admin.test.js` (404 expectations).
- `package.json`: registers the new test file in `test:api`.

## Risks

- The 404-to-403 change tells a non-owner the page exists. Accepted by the owner's request; no data is returned.
- `THUMBGATE_OWNER_EMAILS` must be set on the hosted service or nobody, including the owner, passes the gate. Mitigation: set it through the Railway CLI and verify with a request before saying done.
- Revenue is a rolling 30 days, not the calendar month, because the billing summary window is rolling.
- Checkout split depends on `metadata.uaClass`, which exists only for sessions created since the human gate shipped; older sessions fall into "unclassified" and are excluded, as in `scripts/checkout-session-count.js`.
