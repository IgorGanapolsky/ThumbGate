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

test('guide explains when to use Pro versus the workflow hardening sprint', () => {
  assert.match(GUIDE_HTML, /Workflow Hardening Sprint/i);
  assert.match(GUIDE_HTML, /one workflow, one owner, and one repeated failure/i);
  assert.match(GUIDE_HTML, /Get Pro — \$19\/mo or \$149\/yr/);
  assert.match(GUIDE_HTML, /\/diagnostic\?utm_source=guide/);
  assert.match(GUIDE_HTML, /Start \$499 diagnostic/);
  assert.match(GUIDE_HTML, /\/go\/sprint\?utm_source=guide/);
  assert.match(GUIDE_HTML, /Scope \$1500 sprint/);
  assert.match(GUIDE_HTML, /Send workflow first/);
  assert.match(GUIDE_HTML, /#workflow-sprint-intake/);
  assert.doesNotMatch(GUIDE_HTML, /CHECKOUT_URL__|buy\.stripe\.com|paypal\.com\/ncp\/payment/);
});

test('guide loads shared buyer intent conversion assist', () => {
  assert.match(GUIDE_HTML, /\/js\/buyer-intent\.js/);
});
