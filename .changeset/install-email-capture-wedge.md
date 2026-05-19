---
"thumbgate": minor
---

Add npm install-email capture wedge to convert ~5,000 monthly installers into a re-engageable list.

**The problem.** Daily revenue audit, May 19: 5,071 npm installs in last 30 days, ~3,925 visitors to thumbgate.ai/30d, 257 Stripe checkout starts, **0 external paid conversions**. The postinstall banner is the only surface every installer touches and it had no email capture. Zero leads collected from the entire 30-day install volume.

**Fix:**

1. **`bin/cli.js subscribe` subcommand.** `npx thumbgate subscribe you@company.com` POSTs `{ email, source, installId, cliVersion }` to `/v1/marketing/install-email`. Validates email shape client-side; never prompts interactively (postinstall must stay CI-safe). Per-attempt timeout 8s, exit codes 0/1/2/3 for success / bad-input / server-rejection / network-error.

2. **`POST /v1/marketing/install-email` server route in `src/api/server.js`.** Validates email against RFC 5321-bounded regex, clips overlong source/installId/cliVersion fields, persists capture to a **dedicated `marketing-install-emails.jsonl` ledger** (the standard telemetry sanitizer strips PII by design, so a separate sink is required), emits a privacy-clean `marketing_install_email_captured` telemetry ping for funnel attribution, then fires `sendNewsletterWelcomeEmail` via the existing Resend mailer. Mailer failure (e.g., `RESEND_API_KEY` unset) does NOT fail the capture — the operator can drip later from the ledger.

3. **`bin/postinstall.js` banner update.** New line `npx thumbgate subscribe you@company.com` between the free-start lines and the dashboard URL, sized to fit the existing box.

4. **`tests/install-email-capture.test.js` — 8 tests, all green:**
   - OPTIONS preflight returns CORS headers
   - POST happy path: ok:true, ledger row written, telemetry ping fired WITHOUT email field
   - POST missing email → 400 invalid_email
   - POST malformed email → 400 invalid_email
   - POST invalid JSON → 400 invalid_json
   - POST oversized body → 413 payload_too_large
   - POST oversized non-email fields → clipped to defaults (source) or null (installId/cliVersion), not crash
   - postinstall.js source contains the `npx thumbgate subscribe` line

**What this PR does NOT do:**
- Does not change the postinstall banner outside the single new line.
- Does not add a Stripe-side flow.
- Does not assume `RESEND_API_KEY` is set; capture works without it.
- Does not collect any PII in the standard telemetry stream — the dedicated ledger is the only place email lands.

**Expected outcome at 5% opt-in:** ~250 captured emails / 30 days vs current 0. Even at 1% it is 50/month — meaningfully better than zero.
