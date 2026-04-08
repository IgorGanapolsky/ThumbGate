const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const proPagePath = path.join(__dirname, '..', 'public', 'pro.html');

function readProPage() {
  return fs.readFileSync(proPagePath, 'utf8');
}

test('pro landing page positions ThumbGate Pro as the paid operator lane', () => {
  const proPage = readProPage();

  assert.match(proPage, /ThumbGate Pro/i);
  assert.match(proPage, /paid lane for individual operators/i);
  assert.match(proPage, /personal local dashboard/i);
  assert.match(proPage, /DPO export/i);
  assert.match(proPage, /review-ready evidence/i);
  assert.match(proPage, /Founder support/i);
  assert.match(proPage, /stay on Free/i);
});

test('pro landing page uses checkout routes for monthly and annual conversions', () => {
  const proPage = readProPage();

  assert.match(proPage, /Start 7-Day Free Trial/i);
  assert.match(proPage, /\/checkout\/pro\?/);
  assert.match(proPage, /billing_cycle=annual/);
  assert.match(proPage, /\$19\/mo/);
  assert.match(proPage, /\$149\/yr/);
});

test('pro landing page links to proof assets and live demo surfaces', () => {
  const proPage = readProPage();

  assert.match(proPage, /__VERIFICATION_URL__/);
  assert.match(proPage, /__COMPATIBILITY_REPORT_URL__/);
  assert.match(proPage, /__AUTOMATION_REPORT_URL__/);
  assert.match(proPage, /\/dashboard/);
  assert.match(proPage, /Live dashboard demo/i);
});

test('pro landing page keeps JSON-LD and FAQ structure for SEO and GEO', () => {
  const proPage = readProPage();

  assert.match(proPage, /"@type": "SoftwareApplication"/);
  assert.match(proPage, /"@type": "FAQPage"/);
  assert.match(proPage, /How is Pro different from the free install\?/);
  assert.match(proPage, /Does Pro require a cloud account\?/);
  assert.match(proPage, /What happens after checkout\?/);
  assert.match(proPage, /When should I choose Team instead of Pro\?/);
});

test('pro landing page tracks paid CTAs without unsupported claims', () => {
  const proPage = readProPage();

  assert.match(proPage, /trackClick\('.btn-pro-checkout', 'pro_checkout_start'/);
  assert.match(proPage, /trackClick\('.btn-demo', 'pro_demo_click'/);
  assert.match(proPage, /trackClick\('.proof-links a', 'pro_proof_click'/);
  assert.doesNotMatch(proPage, /official Anthropic partner/i);
  assert.doesNotMatch(proPage, /no credit card/i);
});
