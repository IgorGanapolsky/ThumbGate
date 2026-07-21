'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BUYER_INTENT = fs.readFileSync(path.join(ROOT, 'public', 'js', 'buyer-intent.js'), 'utf8');

const HIGH_TRAFFIC_PAGES = [
  'public/guide.html',
  'public/ai-malpractice-prevention.html',
  'public/dashboard.html',
  'public/learn.html',
  'public/lessons.html',
  'public/learn/ai-agent-persistent-memory.html',
  'public/learn/agent-harness-pattern.html',
];

test('buyer intent script exposes paid CTA and abandon reason observability', () => {
  assert.match(BUYER_INTENT, /initializeRevenueAssist/);
  assert.match(BUYER_INTENT, /assist_cta_impression/);
  assert.match(BUYER_INTENT, /assist_cta_click/);
  assert.match(BUYER_INTENT, /checkout_abandon_prompt/);
  assert.match(BUYER_INTENT, /checkout_abandon_reason/);
  assert.match(BUYER_INTENT, /plausible\.q/);
  assert.match(BUYER_INTENT, /fit_unclear/);
  assert.match(BUYER_INTENT, /need_proof/);
  assert.match(BUYER_INTENT, /price_scope_unclear/);
  assert.match(BUYER_INTENT, /researching/);
});

test('abandon survey requires a prior checkout visit and never fires on generic dwell or exit intent', () => {
  assert.match(BUYER_INTENT, /wasSurveyShown\(\) \|\| !checkoutWasSeen\(\)/);
  assert.match(BUYER_INTENT, /showAbandonSurvey\('checkout_return'\)/);
  assert.match(BUYER_INTENT, /What stopped you from completing checkout\?/);
  assert.doesNotMatch(BUYER_INTENT, /showAbandonSurvey\('dwell_45s'\)/);
  assert.doesNotMatch(BUYER_INTENT, /showAbandonSurvey\('exit_intent'\)/);
  assert.doesNotMatch(BUYER_INTENT, /showAbandonSurvey\('cta_dismiss'\)/);
});

test('revenue assist routes workflow help through intake, not blind diagnostic checkout', () => {
  const intakeLinkTemplate = BUYER_INTENT.match(/<a data-assist-cta="assist_workflow_intake"[^;]+Send workflow first<\/a>/);

  assert.ok(intakeLinkTemplate, 'workflow intake CTA template should exist');
  assert.match(intakeLinkTemplate[0], /href="'\s*\+\s*intakeHref\s*\+\s*'"/);
  assert.doesNotMatch(BUYER_INTENT, /Pay \$499 diagnostic/);
  assert.doesNotMatch(BUYER_INTENT, /assist_workflow_diagnostic/);
  assert.doesNotMatch(BUYER_INTENT, /https:\/\/buy\.stripe\.com\/00w14neyUcXA5pL5e33sI0e/);
});

test('paid revenue assist does not inject on checkout routes', () => {
  assert.match(BUYER_INTENT, /path === '\/checkout\/pro'/);
  assert.match(BUYER_INTENT, /path\.indexOf\('\/go\/pro'\) === 0/);
});

test('high traffic pages load buyer intent conversion assist', () => {
  for (const relativePath of HIGH_TRAFFIC_PAGES) {
    const html = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
    assert.match(html, /<script src="\/js\/buyer-intent\.js"><\/script>/, relativePath);
  }
});
