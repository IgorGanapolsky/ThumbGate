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
  assert.match(pricingHtml, /pricing_cta_click|checkout_start|data-cta-id="pricing_pro_buy"/);
  assert.match(pricingHtml, /data-primary-checkout/);
  assert.match(pricingHtml, /data-plan-id="pro"/);
  assert.doesNotMatch(pricingHtml, /data-plan-id="sprint_diagnostic"/);
  assert.match(pricingHtml, /href="https:\/\/github\.com\/IgorGanapolsky\/ThumbGate\/blob\/main\/docs\/VERIFICATION_EVIDENCE\.md"/);
});

test('pricing exposes Pro self-serve as the sole paid public checkout', () => {
  assert.doesNotMatch(pricingHtml, /action="\/go\/diagnostic-pay"/);
  assert.doesNotMatch(pricingHtml, /\$499/);
  assert.doesNotMatch(pricingHtml, /sprint_diagnostic/);
  assert.match(pricingHtml, /Start Pro/);
  assert.match(pricingHtml, /ThumbGate Pro/);
  assert.match(pricingHtml, /"name": "ThumbGate Pro monthly"/);
  assert.match(pricingHtml, /"price": "19"/);
  assert.match(pricingHtml, /"name": "ThumbGate Pro annual"/);
  assert.match(pricingHtml, /"price": "149"/);
  const jsonLdBlocks = [...pricingHtml.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g)]
    .map((match) => JSON.parse(match[1]));
  const offerGraph = jsonLdBlocks.find((block) => Array.isArray(block['@graph']))['@graph'];
  assert.ok(offerGraph, 'expected @graph JSON-LD');
  assert.ok(!offerGraph.some((node) => node['@type'] === 'Service' && /diagnostic/i.test(node.name || '')),
    'managed diagnostic Service offer must not remain in JSON-LD');
  const pro = offerGraph.find((node) => node['@type'] === 'SoftwareApplication');
  assert.ok(pro, 'expected Pro SoftwareApplication JSON-LD');
  assert.deepEqual(pro.offers.map((offer) => offer.price), ['19', '149']);
  assert.match(pricingHtml, /\/checkout\/pro/);
  assert.match(pricingHtml, /\$19/);
  assert.match(pricingHtml, /\$149/);
  assert.doesNotMatch(pricingHtml, /\/go\/sprint|workflow-sprint-intake/);
  assert.doesNotMatch(pricingHtml, /\$1,500|\$3,000|\$10,000|\$15,000/);
});

test('pricing keeps free evaluate and self-serve fences explicit', () => {
  assert.match(pricingHtml, /Self-serve only|self-serve/i);
  assert.match(pricingHtml, /Free|npx thumbgate init/i);
  assert.match(pricingHtml, /not generally available/i);
  assert.doesNotMatch(pricingHtml, /\$15k\+ loaded|Never reliable/);
});
