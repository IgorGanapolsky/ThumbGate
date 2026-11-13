'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE_PATH = path.resolve(__dirname, '../public/enterprise-governance.html');

test('enterprise-governance: HTML file exists and is valid', () => {
  assert.ok(fs.existsSync(PAGE_PATH), 'public/enterprise-governance.html must exist');
  const html = fs.readFileSync(PAGE_PATH, 'utf8');
  assert.ok(html.length > 1000);
  assert.doesNotMatch(html, /__GOOGLE_SITE_VERIFICATION_META__|__GA_BOOTSTRAP__/);
});

test('enterprise-governance: accurately bounds the approved local-workflow offer', () => {
 const html = fs.readFileSync(PAGE_PATH, 'utf8');
 assert.match(html, /supported hook integrations/);
 assert.match(html, /No enterprise rollout, SSO, hosted team sync or org-wide audit dashboard/);
 assert.match(html, /Matching destructive actions warn by default/);
 assert.doesNotMatch(html, /100%|Runaway Loop Exposure|PII Egress|NIST SP 800-53|fleet|Google Cloud Partner Ready/);
 const schemas = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
 assert.equal(schemas.length, 1);
 const schema = JSON.parse(schemas[0][1]);
 assert.equal(schema.offers.price, '499.00');
 assert.equal(schema.offers.name, 'Setup Sprint');
});
