---
phase: 14
plan: 1
subsystem: billing
tags: [stripe, api-keys, billing, usage-metering, webhooks]
dependency_graph:
  requires: [Phase 13 — deployed API server]
  provides: [Stripe checkout session creation, API key provisioning, key validation, usage metering, webhook handling]
  affects: [src/api/server.js auth middleware, all protected API routes]
tech_stack:
  added: []
  patterns: [Stripe REST API via fetch (zero new npm deps), HMAC webhook signature verification, key store as flat JSON file, usage metering middleware]
key_files:
  created:
    - scripts/billing.js
    - tests/billing.test.js
    - docs/planning/phases/14-billing/14-01-SUMMARY.md
  modified:
    - src/api/server.js
    - .gitignore
    - package.json
decisions:
  - "Used fetch (Node 18+) + https fallback to call Stripe REST API directly — zero new npm dependencies per constraint"
  - "Keys stored in .claude/memory/feedback/api-keys.json — in gitignore, adjacent to other memory files"
  - "Webhook route placed BEFORE auth middleware — Stripe webhooks carry no Bearer token, HMAC-verified instead"
  - "STRIPE_SECRET_KEY absent = local mode — createCheckoutSession returns local_ session, verifyWebhookSignature skips check"
  - "Auth middleware updated to accept any valid provisioned billing key alongside static THUMBGATE_API_KEY"
  - "Usage metering middleware fires on every request authenticated with a billing key (not the static key)"
metrics:
  duration_minutes: 25
  completed_date: "2026-03-04"
  tasks_completed: 3
  files_changed: 5
  tests_added: 27
  total_tests: 362
---

# Phase 14 Plan 1: Stripe Billing — Checkout, Key Provisioning, Usage Metering Summary

**One-liner:** Stripe checkout + API key provisioning via fetch-based REST client with HMAC webhook verification, zero new npm dependencies, 27 tests green.

## What Was Built

### scripts/billing.js

Full Stripe billing integration module using the Stripe REST API directly via `fetch` (Node 18+) with an `https` module fallback for older Node — no `stripe` npm package required.

Functions:
- `createCheckoutSession({ successUrl, cancelUrl, customerEmail })` — Creates Stripe Checkout session for $49/mo Context Gateway (STRIPE_PRICE_ID). In local mode (no STRIPE_SECRET_KEY) returns `{ sessionId: 'local_<uuid>', url: null, localMode: true }`.
- `provisionApiKey(customerId)` — Generates `thumbgate_<32 hex chars>` key, stores in `.claude/memory/feedback/api-keys.json`. Reuses existing active key if customer already has one.
- `validateApiKey(key)` — Returns `{ valid, customerId, usageCount }`. Returns `{ valid: false, reason: 'key_disabled' }` for deactivated keys.
- `recordUsage(key)` — Increments `usageCount` in the store. Returns `{ recorded, usageCount }`.
- `disableCustomerKeys(customerId)` — Sets `active: false` for all keys belonging to a customer.
- `handleWebhook(event)` — Routes `checkout.session.completed` (provision key) and `customer.subscription.deleted` (disable keys). Returns `{ handled, action, result }`.
- `verifyWebhookSignature(rawBody, signature)` — HMAC-SHA256 verify against STRIPE_WEBHOOK_SECRET. Returns `true` in local mode (no secret set).
- `flattenParams(obj)` — Converts nested JS objects to Stripe's `key[0][field]` URL-encoded form format.

### src/api/server.js updates

New routes:
- `POST /v1/billing/checkout` — Creates Stripe Checkout session. Authenticated.
- `POST /v1/billing/webhook` — Stripe webhook handler. **Placed before auth middleware** — authenticated by HMAC signature, not Bearer token. Processes `checkout.session.completed` and `customer.subscription.deleted`.
- `GET /v1/billing/usage` — Returns `{ key, customerId, usageCount }` for the authenticated billing key.
- `POST /v1/billing/provision` — Admin endpoint to manually provision a key by customerId.

Auth middleware updates:
- `isAuthorized()` now accepts any valid provisioned billing key alongside the static `THUMBGATE_API_KEY`.
- New `extractBearerToken()` helper extracts the Bearer token from Authorization header.
- Usage metering middleware fires after auth passes — records usage for billing keys (not the static key).

### tests/billing.test.js

27 tests across 7 describe blocks using Node's built-in `node:test`:
- `provisionApiKey`: unique key generation, customer reuse, missing customerId throws
- `validateApiKey`: valid key, unknown key, empty/null key
- `recordUsage`: increment, persistence across module reloads, invalid key
- `handleWebhook`: checkout.session.completed provisions key, subscription.deleted disables key, unknown event type, missing event, missing customer
- `verifyWebhookSignature`: local mode bypass
- `createCheckoutSession` (local mode): returns local_ session
- API server integration: all 4 routes, provisioned key auth, subscription delete disables key, usage metering increments after 3 requests

## Test Results

```
ℹ tests 27
ℹ pass  27
ℹ fail  0
Full suite: 362 pass, 0 fail (up from 322 before Phase 14)
```

## Deviations from Plan

None — plan executed exactly as specified.

Key implementation notes:
- Webhook route intentionally placed before auth middleware (Stripe doesn't send Bearer tokens)
- `flattenParams()` needed to convert nested JS objects to Stripe's form encoding format
- `disableCustomerKeys()` exported as a separate function (needed by webhook handler)

## Self-Check: PASSED

Files verified:
- FOUND: scripts/billing.js
- FOUND: tests/billing.test.js
- FOUND: src/api/server.js (modified)
- FOUND: docs/planning/phases/14-billing/14-01-SUMMARY.md

Commits verified:
- c92adef: feat(14-01): Stripe billing — all 5 files committed
