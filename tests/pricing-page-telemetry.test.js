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
  assert.match(pricingHtml, /data-cta-id="pricing_diagnostic"/);
  assert.match(pricingHtml, /data-cta-id="pricing_sprint"/);
  assert.match(pricingHtml, /data-cta-id="pricing_pro"/);
});

test('pricing leads with diagnostic confirmation, sprint payment, and gated Pro checkout', () => {
  assert.match(pricingHtml, /href="\/diagnostic\?[^"]*cta_id=pricing_nav_diagnostic/);
  assert.match(pricingHtml, /href="\/diagnostic\?[^"]*cta_id=pricing_diagnostic/);
  assert.match(pricingHtml, /href="\/go\/sprint\?[^"]*cta_id=pricing_sprint/);
  assert.match(pricingHtml, /Start \$__SPRINT_DIAGNOSTIC_PRICE_DOLLARS__ diagnostic/);
  assert.match(pricingHtml, /Scope \$__WORKFLOW_SPRINT_PRICE_DOLLARS__ sprint/);
  assert.match(pricingHtml, /href="\/checkout\/pro\?[^"]*cta_id=pricing_pro/);
  assert.doesNotMatch(pricingHtml, /checkout\/pro\?confirm=1/);
  assert.match(pricingHtml, /"url": "__APP_ORIGIN__\/checkout\/pro\?plan_id=pro&billing_cycle=monthly/);
  assert.match(pricingHtml, /"name": "Workflow Hardening Diagnostic"/);
  assert.match(pricingHtml, /"name": "Workflow Hardening Sprint"/);
});
