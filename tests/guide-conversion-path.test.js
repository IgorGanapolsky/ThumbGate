'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const GUIDE_HTML = fs.readFileSync(path.join(ROOT, 'public', 'guide.html'), 'utf8');

test('guide keeps proof-backed conversion links close to the install path', () => {
  assert.match(GUIDE_HTML, /Commercial Truth/);
  assert.match(GUIDE_HTML, /docs\/COMMERCIAL_TRUTH\.md/);
  assert.match(GUIDE_HTML, /Verification Evidence/);
});

test('guide offers free local enforcement and self-serve Pro without retired services', () => {
  assert.match(GUIDE_HTML, /Two honest next steps/);
  assert.match(GUIDE_HTML, /personal local dashboard/);
  assert.match(GUIDE_HTML, /__PRO_PRICE_LABEL__/);
  assert.match(GUIDE_HTML, /href="\/checkout\/pro\?utm_source=guide&amp;utm_medium=cta_button&amp;utm_campaign=pro_upgrade"/);
  assert.match(GUIDE_HTML, /href="\/install\?utm_source=guide&amp;utm_medium=cta_button&amp;utm_campaign=free_cli"/);
  assert.match(GUIDE_HTML, /hosted team sync and a hosted org dashboard are not generally available/i);
  assert.doesNotMatch(GUIDE_HTML, /\$499|Setup Sprint|Workflow Sprint|done-with-you|proof-ready workflow review/i);
  assert.doesNotMatch(GUIDE_HTML, /\/diagnostic|workflow-sprint-intake|\/go\/sprint/);
  assert.doesNotMatch(GUIDE_HTML, /CHECKOUT_URL__|buy\.stripe\.com|paypal\.com\/ncp\/payment/);
});

test('platform page offers free and Pro software without invented reseller tiers', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'platform-partners.html'), 'utf8');
  assert.match(html, /href="\/install">Install free/);
  assert.match(html, /href="\/checkout\/pro">Get Pro/);
  assert.match(html, /href="\/pricing">Current pricing/);
  assert.match(html, /hosted org dashboard are not generally available/i);
  assert.match(html, /partner-intake\.html/);
  assert.match(html, /POST \/v1\/decisions\/evaluate/);
  assert.match(html, /POST \/v1\/feedback\/capture/);
  assert.doesNotMatch(html, /\$499|500,000|30%|Resell the|Custom commit|Pay-per-usage platform tiers/i);
  const jsonLd = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(jsonLd.offers.map((offer) => [offer.name, offer.price]), [
    ['Free CLI', '0'], ['ThumbGate Pro', undefined],
  ]);
  assert.equal(jsonLd.offers[1].url, '__APP_ORIGIN__/pricing');
});

test('YouTube campaign stays free and does not route visitors to retired checkout', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'yt.html'), 'utf8');
  assert.doesNotMatch(html, /\$499|Setup Sprint|Workflow Sprint|href="[^"\n]*(?:\/diagnostic|\/go\/sprint|workflow-sprint-intake)/i);
  for (const destination of ['github', 'npm', 'marketplace']) {
    assert.match(html, new RegExp('href="/go/' + destination + '\\?utm_source=youtube'));
  }
});

test('guide loads shared buyer intent conversion assist', () => {
  assert.match(GUIDE_HTML, /\/js\/buyer-intent\.js/);
});
