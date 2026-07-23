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

test('pricing exposes $499 as the primary cash path, with Pro only as a secondary self-serve link', () => {
  assert.match(pricingHtml, /action="\/go\/diagnostic-pay" method="POST"/);
  assert.match(pricingHtml, /Buy the \$499 enterprise gate/);
  assert.match(pricingHtml, /name="customer_email"[^>]*required/);
  assert.match(pricingHtml, /"name": "ThumbGate Enterprise Workflow Gate"/);
  assert.match(pricingHtml, /"price": "499"/);
  assert.doesNotMatch(pricingHtml, /\/go\/sprint|workflow-sprint-intake/);
  // 2026-07-23: CEO reversed the single-cash-path policy — $19/mo Pro is
  // restored as a secondary self-serve link, never the primary form action.
  assert.doesNotMatch(pricingHtml, /action="[^"]*\/checkout\/pro/);
  assert.match(pricingHtml, /class="pro-alt-offer"[^>]*>[^<]*<a href="\/checkout\/pro/);
  assert.doesNotMatch(pricingHtml, /\$149|\$1,500|\$3,000|\$10,000|\$15,000/);
});
