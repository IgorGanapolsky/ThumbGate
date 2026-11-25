'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pagePath = path.join(__dirname, '..', 'public', 'peter.html');
const content = fs.readFileSync(pagePath, 'utf8');

test('public/peter.html renders co-branded partner hero, comparison table, and request-only CTAs', () => {
  assert.match(content, /ThumbGate Partner Template for Autonomous AI Creators/);
  assert.match(content, /Partner Co-Branded Case Study/);
  assert.match(content, /How ThumbGate Stacks Up/);
  assert.match(content, /<50ms \(Local PreToolUse\)/);
  assert.match(content, /Install free CLI/);
  assert.match(content, /<a href="\/pilot" class="btn-primary">Request a team pilot<\/a>/);
  assert.match(content, /FAQPage/);
  // The $499 diagnostic is retired (its routes return 410): no paid CTA, checkout form or link to /diagnostic.
  assert.doesNotMatch(content, /\$499|\/go\/diagnostic-pay|name="customer_email"|href="\/diagnostic/);
  // Honesty: not a claimed third-party endorsement.
  assert.match(content, /not a (claimed )?third-party endorsement|not a claimed personal endorsement/i);
  assert.doesNotMatch(content, /Peter Yang trusts ThumbGate/);
});
