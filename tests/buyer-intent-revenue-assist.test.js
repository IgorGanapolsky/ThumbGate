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

test('paid diagnostic assist opens checkout in the current tab', () => {
  const diagnosticLinkTemplate = BUYER_INTENT.match(/<a data-assist-cta="assist_workflow_diagnostic"[^;]+Pay \$499 diagnostic<\/a>/);

  assert.ok(diagnosticLinkTemplate, 'diagnostic CTA template should exist');
  assert.match(diagnosticLinkTemplate[0], /href="'\s*\+\s*diagnosticHref\s*\+\s*'"/);
  assert.doesNotMatch(diagnosticLinkTemplate[0], /target="_blank"/);
  assert.doesNotMatch(diagnosticLinkTemplate[0], /noopener|noreferrer/);
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
