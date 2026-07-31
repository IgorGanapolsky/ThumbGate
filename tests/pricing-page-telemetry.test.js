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
  assert.match(pricingHtml, /experimentId: 'value_packaging_v1'/);
  assert.match(pricingHtml, /data-plan-id="pro" data-value="19" data-segment="solo_operator"/);
  assert.match(pricingHtml, /data-plan-id="sprint_diagnostic" data-value="499" data-segment="workflow_team"/);
  assert.match(pricingHtml, /data-plan-id="enterprise_service" data-value="0" data-segment="regulated_team"/);
  assert.match(pricingHtml, /link\.dataset\.planId \|\| 'unknown'/);
  assert.match(pricingHtml, /name="utm_campaign" value="value_packaging_v1"/);
  assert.match(pricingHtml, /name="campaign_variant" value="workflow_team"/);
  assert.match(pricingHtml, /buyerSegment\.value = link\.dataset\.segment \|\| 'workflow_team'/);
  assert.match(pricingHtml, /href="https:\/\/github\.com\/IgorGanapolsky\/ThumbGate\/blob\/main\/docs\/VERIFICATION_EVIDENCE\.md"/);
});

test('pricing exposes Pro self-serve and direct $499 managed-gate checkout', () => {
  assert.match(pricingHtml, /action="\/go\/diagnostic-pay" method="POST"/);
  assert.match(pricingHtml, /Get Started — \$499 Diagnostic/);
  assert.match(pricingHtml, /name="customer_email"[^>]*required/);
  assert.match(pricingHtml, /"name": "ThumbGate Managed Workflow Diagnostic"/);
  assert.match(pricingHtml, /"price": "499"/);
  assert.match(pricingHtml, /"name": "ThumbGate Pro monthly"/);
  assert.match(pricingHtml, /"price": "19"/);
  assert.match(pricingHtml, /"name": "ThumbGate Pro annual"/);
  assert.match(pricingHtml, /"price": "149"/);
  const jsonLdBlocks = [...pricingHtml.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g)]
    .map((match) => JSON.parse(match[1]));
  const offerGraph = jsonLdBlocks.find((block) => Array.isArray(block['@graph']))['@graph'];
  const diagnostic = offerGraph.find((node) => node['@type'] === 'Service');
  const pro = offerGraph.find((node) => node['@type'] === 'SoftwareApplication');
  assert.equal(diagnostic.offers.price, '499');
  assert.equal(diagnostic.offers.name, 'Managed workflow diagnostic');
  assert.deepEqual(pro.offers.map((offer) => offer.price), ['19', '149']);
  assert.match(pricingHtml, /\/checkout\/pro/);
  assert.match(pricingHtml, />Start Pro<\/a>/);
  assert.match(pricingHtml, /\$19/);
  assert.match(pricingHtml, /\$149/);
  assert.doesNotMatch(pricingHtml, /\/go\/sprint|workflow-sprint-intake/);
  assert.doesNotMatch(pricingHtml, /\$1,500|\$3,000|\$10,000|\$15,000/);
});

test('pricing segments buyers by value and keeps public fences explicit', () => {
  assert.match(pricingHtml, /Price from your exposure/);
  assert.match(pricingHtml, /Repeat incidents/);
  assert.match(pricingHtml, /Recovery hours/);
  assert.match(pricingHtml, /Loaded hourly cost/);
  assert.match(pricingHtml, /Solo operator/);
  assert.match(pricingHtml, /Engineering or platform team/);
  assert.match(pricingHtml, /Regulated or multi-workflow team/);
  assert.match(pricingHtml, /Hosted team features, SSO, and SIEM are not general availability/);
  assert.doesNotMatch(pricingHtml, /\$15k\+ loaded|Never reliable/);
});
