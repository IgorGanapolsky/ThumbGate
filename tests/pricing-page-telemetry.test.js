'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const pricingHtml = fs.readFileSync(path.resolve(__dirname, '../public/pricing.html'), 'utf8');

test('pricing telemetry attributes Pro clicks to the configured canonical price', () => {
  assert.match(pricingHtml, /pricing_cta_click/);
  assert.match(pricingHtml, /Number\(value \|\| 0\)/);
  assert.match(pricingHtml, /data-plan-id="pro"/);
  assert.match(pricingHtml, /data-value="__PRO_PRICE_DOLLARS__"/);
  assert.match(pricingHtml, /data-cta-id="pricing_pro_checkout"/);
  assert.match(pricingHtml, /data-primary-checkout>[\s\S]*?href="\/checkout\/pro"[^>]*data-revenue-cta/);
});

test('pricing preserves free installation and truthful self-serve Pro boundaries', () => {
  assert.match(pricingHtml, /href="\/install"/);
  assert.match(pricingHtml, /recall, dashboard, adapters, and exports/);
  assert.match(pricingHtml, /__PRO_PRICE_LABEL__/);
  assert.match(pricingHtml, /SSO.*not generally available/);
  assert.doesNotMatch(pricingHtml, /\$499|Setup Sprint|diagnostic-pay|workflow-sprint|48h turnaround/);
  assert.doesNotMatch(pricingHtml, /80%|120\+|Most Popular|universal savings/i);
  for (const match of pricingHtml.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(match[1]);
});


test('pricing preserves proof links and rejects unsupported claims', () => {
  assert.match(pricingHtml, /href="https:\/\/github\.com\/IgorGanapolsky\/ThumbGate\/blob\/main\/docs\/VERIFICATION_EVIDENCE\.md"/);
  assert.doesNotMatch(pricingHtml, /\$1,500|\$3,000|\$10,000|\$15,000|\$15k\+ loaded|Never reliable/);
  assert.doesNotMatch(pricingHtml, /IrashTech|blank to growth/i);
});


test('pricing preserves private first-party page views and Pro checkout clicks', () => {
  assert.match(pricingHtml, /\/v1\/telemetry\/ping/);
  assert.doesNotMatch(pricingHtml, /\/v1\/telemetry\/event/);
  assert.match(pricingHtml, /sendFirstPartyTelemetry\('pricing_page_view'/);
  assert.match(pricingHtml, /sendFirstPartyTelemetry\('cta_click', props\)/);
  assert.match(pricingHtml, /sendFirstPartyTelemetry\('checkout_start', props\)/);
  assert.match(pricingHtml, /link.getAttribute\('href'\) === '\/checkout\/pro'/);
  assert.match(pricingHtml, /link.dataset.value \|\| '0'/);
  assert.match(pricingHtml, /navigator.globalPrivacyControl === true/);
  assert.match(pricingHtml, /navigator.doNotTrack === '1'/);
  assert.match(pricingHtml, /window.doNotTrack === '1'/);
  assert.match(pricingHtml, /if \(privacySignalOptOut\(\)\) return;/);
});
