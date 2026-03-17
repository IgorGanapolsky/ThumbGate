const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const strategyPath = path.join(__dirname, '..', 'docs', 'ANTHROPIC_MARKETPLACE_STRATEGY.md');
const xThreadPath = path.join(__dirname, '..', 'docs', 'marketing', 'x-launch-thread.md');

test('Anthropic partner strategy stays proof-backed and avoids false membership claims', () => {
  const strategy = fs.readFileSync(strategyPath, 'utf8');

  assert.match(strategy, /Claude workflow hardening/i);
  assert.match(strategy, /code modernization/i);
  assert.match(strategy, /VERIFICATION_EVIDENCE\.md/);
  assert.match(strategy, /COMMERCIAL_TRUTH\.md/);
  assert.match(strategy, /Do not say:/);
  assert.match(strategy, /official Anthropic partner/i);
  assert.doesNotMatch(strategy, /^We are an official Anthropic partner\b/m);
  assert.doesNotMatch(strategy, /^We are in Anthropic's partner network\b/m);
});

test('X launch thread aligns the public story with workflow hardening instead of AI employee hype', () => {
  const thread = fs.readFileSync(xThreadPath, 'utf8');

  assert.match(thread, /Claude workflow hardening/i);
  assert.match(thread, /Not an "AI employee\."/i);
  assert.match(thread, /Code modernization partners/i);
  assert.match(thread, /VERIFICATION_EVIDENCE\.md/);
});
