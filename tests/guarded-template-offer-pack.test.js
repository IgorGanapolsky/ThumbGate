'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('guarded template pack keeps ThumbGate positioned as the trust layer', () => {
  const markdown = read('docs/marketing/guarded-automation-template-pack.md');

  assert.match(markdown, /n8n/i);
  assert.match(markdown, /Make\.com/i);
  assert.match(markdown, /Lindy\.ai/i);
  assert.match(markdown, /Gumroad/i);
  assert.match(markdown, /GoHighLevel/i);
  assert.match(markdown, /Do not sell commodity templates/i);
  assert.match(markdown, /ThumbGate as the trust layer/i);
  assert.match(markdown, /Workflow Hardening Sprint/i);
  assert.match(markdown, /Pro at \$19\/mo or \$149\/yr/i);
  assert.match(markdown, /COMMERCIAL_TRUTH\.md/);
  assert.match(markdown, /VERIFICATION_EVIDENCE\.md/);
  assert.doesNotMatch(markdown, /published marketplace listing is live|guaranteed installs|guaranteed revenue/i);
});

test('guarded template pack json stays machine-readable and claim-safe', () => {
  const raw = read('docs/marketing/guarded-automation-template-pack.json');
  const pack = JSON.parse(raw);

  assert.equal(pack.measurementPlan.northStar, 'guarded_template_to_paid_intent');
  assert.equal(pack.followOnOffers.length, 2);
  assert.equal(pack.distributionSurfaces.length, 3);
  assert.equal(pack.platformPackaging.length, 3);
  assert.equal(pack.operatorQueue.length, 4);
  assert.ok(pack.templateCategories.includes('AI lead qualification before CRM write'));
  assert.ok(pack.channelMatches.some((entry) => /Gumroad/i.test(entry)));
  assert.ok(pack.measurementPlan.metrics.includes('lindy_template_clicks'));
  assert.ok(pack.measurementPlan.metrics.includes('ghl_snapshot_inquiries'));
  assert.ok(pack.measurementPlan.guardrails.some((entry) => /Lindy templates, Gumroad sales, or published GoHighLevel snapshots/i.test(entry)));
  assert.ok(pack.measurementPlan.guardrails.some((entry) => /Do not claim published n8n marketplace listings/i.test(entry)));
  assert.ok(pack.outreachDrafts.every((entry) => !/guaranteed installs|guaranteed revenue|approved marketplace/i.test(entry.draft)));
});
