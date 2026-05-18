---
"thumbgate": patch
---

Add `scripts/stripe-business-identity-probe.js` — what does the buyer actually see on the Stripe-hosted checkout page?

The stripe-checkout-diagnostic from PR #2097 revealed the failure mode is buyer-bail-at-Stripe-page (100 sessions, 100% open/expired, 100% no customer email, zero payment_intent errors). That means buyers are seeing something on the Stripe page in the first 3 seconds that makes them close the tab. The diagnostic doesn't pull the *identity surface* — what name/logo/description/statement_descriptor the merchant actually has configured. This probe does.

Pulls every Stripe-side field that contributes to brand recognition on the checkout page:

- `account.business_profile.{name, url, support_email, product_description, mcc}` — buyer-facing merchant identity
- `account.settings.payments.statement_descriptor` — what shows on the card statement after purchase
- `account.settings.card_payments.statement_descriptor_prefix`
- `account.settings.branding.{logo, icon, primary_color, secondary_color}` — visual continuity from thumbgate.ai → Stripe page
- `paymentLinks.list` per-link config: `active`, `submit_type`, `billing_address_collection`, `phone_number_collection`, custom_text presence, metadata keys
- Diagnoses each missing field as `critical` / `warning` / `info` with a specific message about what the buyer will see (or not see) as a result.

Wired into the Daily Revenue Loop workflow as a new step between unified-rollup and external-customer-audit. Outputs markdown + JSON to `reports/revenue/stripe-business-identity.*` plus a GitHub Actions job-summary section.

12 unit tests cover identity field extraction (with and without business_profile / branding / payments / card_payments sections), gap diagnosis (critical on missing name, warning when name doesn't contain "ThumbGate", info on missing URL / support_email), Payment Link summary extraction, Payment Link gap diagnosis (critical on inactive Payment Link still on file, warning on phone-collection friction), the runProbe end-to-end happy path, and unconfigured-Stripe degradation.
