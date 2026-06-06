'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const pricingHtml = fs.readFileSync(path.resolve(__dirname, '../public/pricing.html'), 'utf8');

test('pricing page emits first-party telemetry for views and CTA clicks', () => {
  assert.match(pricingHtml, /\/v1\/telemetry\/ping/);
  assert.match(pricingHtml, /pricing_page_view/);
  assert.match(pricingHtml, /pricing_cta_click/);
  assert.match(pricingHtml, /data-pricing-cta/);
  assert.match(pricingHtml, /data-cta-id="pricing_pro"/);
});

test('pricing Pro CTAs use confirmed checkout so Stripe collects email without the extra gate', () => {
  assert.match(pricingHtml, /href="\/checkout\/pro\?confirm=1[^"]*cta_id=pricing_nav_start_pro/);
  assert.match(pricingHtml, /href="\/checkout\/pro\?confirm=1[^"]*cta_id=pricing_pro/);
  assert.match(pricingHtml, /"url": "__APP_ORIGIN__\/checkout\/pro\?confirm=1&plan_id=pro&billing_cycle=monthly/);
});
