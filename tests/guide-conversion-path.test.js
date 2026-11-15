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

test('guide explains free installation and self-serve Pro without retired service paths', () => {
  assert.match(GUIDE_HTML, /Free:.*?npx thumbgate init/s);
  assert.match(GUIDE_HTML, /self-serve Pro/i);
  assert.match(GUIDE_HTML, /recall, dashboard, adapters, and exports/i);
  assert.match(GUIDE_HTML, /href="\/pricing\?utm_source=guide/);
  assert.doesNotMatch(GUIDE_HTML, /\$499|\$1,?500|Setup Sprint|\/diagnostic|\/go\/sprint|#workflow-sprint-intake/i);
  assert.doesNotMatch(GUIDE_HTML, /CHECKOUT_URL__|buy\.stripe\.com|paypal\.com\/ncp\/payment/);
});

test('guide loads shared buyer intent conversion assist', () => {
  assert.match(GUIDE_HTML, /\/js\/buyer-intent\.js/);
});
