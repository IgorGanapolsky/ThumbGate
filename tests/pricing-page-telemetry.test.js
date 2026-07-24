'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const pricingHtml = fs.readFileSync(path.resolve(__dirname, '../public/pricing.html'), 'utf8');

test('pricing page emits first-party telemetry for views and buyer actions', () => {
  assert.match(pricingHtml, /\/v1\/telemetry\/ping/);
  assert.doesNotMatch(pricingHtml, /\/v1\/telemetry\/event/);
  assert.match(pricingHtml, /pricing_page_view/);
  assert.match(pricingHtml, /pricing_cta_click/);
  assert.match(pricingHtml, /checkout_start/);
  assert.match(pricingHtml, /data-cta-id="pricing_nav_buy"/);
  assert.match(pricingHtml, /data-primary-checkout/);
  assert.match(pricingHtml, /href="https:\/\/github\.com\/IgorGanapolsky\/ThumbGate\/blob\/main\/docs\/VERIFICATION_EVIDENCE\.md"/);
});

test('pricing exposes Pro self-serve and direct $499 managed-gate checkout', () => {
  assert.match(pricingHtml, /action="\/go\/diagnostic-pay" method="POST"/);
  assert.match(pricingHtml, /Get Started — \$499 Diagnostic/);
  assert.match(pricingHtml, /name="customer_email"[^>]*required/);
  assert.match(pricingHtml, /"name": "ThumbGate Enterprise Workflow Gate"/);
  assert.match(pricingHtml, /"price": "499"/);
  assert.match(pricingHtml, /\/checkout\/pro/);
  assert.match(pricingHtml, /Start Pro — \$19\/mo/);
  assert.match(pricingHtml, /\$19/);
  assert.match(pricingHtml, /\$149/);
  assert.doesNotMatch(pricingHtml, /\/go\/sprint|workflow-sprint-intake/);
  assert.doesNotMatch(pricingHtml, /\$1,500|\$3,000|\$10,000|\$15,000/);
});
