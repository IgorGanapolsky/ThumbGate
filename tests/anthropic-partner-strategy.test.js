const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const strategyPath = path.join(__dirname, '..', 'docs', 'ANTHROPIC_MARKETPLACE_STRATEGY.md');
// xThreadPath retired 2026-06-06: docs/marketing/x-launch-thread.md was deleted
// in the post-Reddit credibility cleanup. The strategy-doc check below still
// pins the workflow-hardening positioning that the X thread test duplicated.

test('Anthropic partner strategy stays proof-backed and avoids false membership claims', () => {
  const strategy = fs.readFileSync(strategyPath, 'utf8');

  assert.match(strategy, /Claude workflow hardening/i);
  assert.match(strategy, /self-serve ThumbGate Pro/i);
  assert.match(strategy, /Neither plan includes a managed implementation, pilot delivery, or a proof review performed by ThumbGate/);
  assert.doesNotMatch(strategy, /Setup Sprint|one workflow, one pilot, one proof review|implementation-led delivery/i);
  assert.match(strategy, /founder-led outbound/i);
  assert.match(strategy, /attributable self-serve Pro subscriptions/i);
  assert.match(strategy, /code modernization/i);
  assert.match(strategy, /VERIFICATION_EVIDENCE\.md/);
  assert.match(strategy, /COMMERCIAL_TRUTH\.md/);
  assert.match(strategy, /Do not say:/);
  assert.match(strategy, /official Anthropic partner/i);
  assert.doesNotMatch(strategy, /^We are an official Anthropic partner\b/m);
  assert.doesNotMatch(strategy, /^We are in Anthropic's partner network\b/m);
});

// REMOVED 2026-06-06: this test pinned docs/marketing/x-launch-thread.md,
// deleted in the post-Reddit credibility cleanup.
