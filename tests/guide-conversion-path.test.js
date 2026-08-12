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

test('guide points paid buyers at Pro self-serve rather than managed diagnostic', () => {
  assert.match(GUIDE_HTML, /Get Pro — \$19\/mo or \$149\/yr|Start Pro/i);
  assert.match(GUIDE_HTML, /\/checkout\/pro/);
  assert.doesNotMatch(GUIDE_HTML, /action="\/go\/diagnostic-pay"/);
  assert.doesNotMatch(GUIDE_HTML, /\$499/);
  assert.doesNotMatch(GUIDE_HTML, /CHECKOUT_URL__|buy\.stripe\.com|paypal\.com\/ncp\/payment/);
});

test('guide loads shared buyer intent conversion assist', () => {
  assert.match(GUIDE_HTML, /\/js\/buyer-intent\.js/);
});
