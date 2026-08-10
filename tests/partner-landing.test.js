'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pagePath = path.join(__dirname, '..', 'public', 'peter.html');
const content = fs.readFileSync(pagePath, 'utf8');

test('public/peter.html renders co-branded partner hero, comparison table, and paid CTAs', () => {
  assert.match(content, /ThumbGate Partner Template for Autonomous AI Creators/);
  assert.match(content, /Partner Co-Branded Case Study/);
  assert.match(content, /How ThumbGate Stacks Up/);
  assert.match(content, /<50ms \(Local PreToolUse\)/);
  assert.match(content, /Start Pro — \$19\/mo/);
  assert.match(content, /Get \$499 Diagnostic Gate/);
  assert.match(content, /FAQPage/);
  // Diagnostic checkout requires email-backed POST (GET /go/diagnostic-pay is 405).
  assert.match(content, /action="\/go\/diagnostic-pay"[^>]*method="POST"/);
  assert.match(content, /name="customer_email"/);
  // Honesty: not a claimed third-party endorsement.
  assert.match(content, /not a (claimed )?third-party endorsement|not a claimed personal endorsement/i);
  assert.doesNotMatch(content, /Peter Yang trusts ThumbGate/);
});
