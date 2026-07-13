'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'src', 'api', 'server.js'), 'utf8');
const {
  DEFAULT_SPRINT_DIAGNOSTIC_CHECKOUT_URL,
  DEFAULT_WORKFLOW_SPRINT_CHECKOUT_URL,
  DEFAULT_SPRINT_DIAGNOSTIC_PRICE_DOLLARS,
  DEFAULT_WORKFLOW_SPRINT_PRICE_DOLLARS,
} = require('../scripts/hosted-config');

function extractConstUrl(name) {
  const match = serverSrc.match(new RegExp(`const ${name} = '([^']+)'`));
  assert.ok(match, `missing const ${name}`);
  return match[1];
}

test('service checkout defaults keep diagnostic and sprint price-aligned and distinct', () => {
  const diagnosticUrl = extractConstUrl('SPRINT_DIAGNOSTIC_CHECKOUT_URL');
  const sprintUrl = extractConstUrl('WORKFLOW_SPRINT_CHECKOUT_URL');

  assert.equal(DEFAULT_SPRINT_DIAGNOSTIC_PRICE_DOLLARS, 499);
  assert.equal(DEFAULT_WORKFLOW_SPRINT_PRICE_DOLLARS, 1500);
  assert.equal(diagnosticUrl, DEFAULT_SPRINT_DIAGNOSTIC_CHECKOUT_URL);
  assert.equal(sprintUrl, DEFAULT_WORKFLOW_SPRINT_CHECKOUT_URL);
  assert.notEqual(diagnosticUrl, sprintUrl);

  // Known-bad fallback that previously charged $499 under a $1500 label.
  assert.notEqual(sprintUrl, 'https://buy.stripe.com/6oU00j8aw2iWdWh9uj3sI2K');
  assert.match(sprintUrl, /paypal\.com\/ncp\/payment\/LTQFR7P9AR3QG/);
  assert.match(diagnosticUrl, /buy\.stripe\.com\/9B69ATbmI4r4aK5eOD3sI3k/);
});
