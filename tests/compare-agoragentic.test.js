'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'public', 'compare', 'agoragentic.html'), 'utf8');
const HUB = fs.readFileSync(path.join(ROOT, 'public', 'compare.html'), 'utf8');
const PROOF = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'public-proof.json'), 'utf8'));
const SCHEMA = fs.readFileSync(
  path.join(ROOT, 'config', 'schemas', 'broker-execution-receipt.schema.json'),
  'utf8',
);
const { RECEIPT_PROOF_BOUNDARY } = require('../scripts/broker-execution-receipts');

test('compare page states adjacent not substitute and links the live Agora site', () => {
  assert.match(PAGE, /Adjacent, not a substitute|adjacent, not a substitute|not a clone/i);
  assert.match(PAGE, /https:\/\/agoragentic\.com\//);
  assert.match(PAGE, /PreToolUse/);
  assert.match(PAGE, /Triptych OS|agent OS/i);
  assert.doesNotMatch(PAGE, /we power Agoragentic|we are Agoragentic/i);
});

test('compare page does not claim default hard-block of rm -rf', () => {
  assert.doesNotMatch(PAGE, /hard-block(?:s)?\s+.*rm\s+-rf/i);
  assert.match(PAGE, /warn unless STRICT/i);
});

test('hub links the Agora compare page', () => {
  assert.match(HUB, /href="\/compare\/agoragentic"/);
});

test('compare page exposes FAQPage JSON-LD for GEO parsers', () => {
  assert.match(PAGE, /"@type":\s*"FAQPage"/);
  assert.match(PAGE, /Is Agoragentic a ThumbGate competitor/);
});

test('filesystem catalog includes agoragentic.html so sitemap auto-include cannot miss it', () => {
  const compareDir = path.join(ROOT, 'public', 'compare');
  assert.ok(fs.existsSync(path.join(compareDir, 'agoragentic.html')));
  const catalog = fs.readdirSync(compareDir).filter((name) => name.endsWith('.html'));
  assert.ok(catalog.includes('agoragentic.html'));
});

test('public-proof.json does not hardcode live counts and names the receipt boundary', () => {
  assert.equal(PROOF.schema, 'thumbgate.public-proof.v1');
  assert.equal(PROOF.live_values_policy.counts_are_not_duplicated_here, true);
  assert.ok(PROOF.live_values_policy.fetch_order.includes('/health'));
  assert.equal(PROOF.live_values_policy.fetch_order.includes('/v1/billing/summary'), false);
  assert.match(PROOF.live_values_policy.authenticated_sources['/v1/billing/summary'], /401/i);
  assert.match(JSON.stringify(PROOF), /not independent world-state proof/i);
  assert.doesNotMatch(JSON.stringify(PROOF), /"visitors":\s*[1-9]/);
  assert.doesNotMatch(JSON.stringify(PROOF), /"paidOrders":\s*[1-9]/);
});

test('receipt proof boundary refuses world-state and invocable-listing claims', () => {
  assert.ok(RECEIPT_PROOF_BOUNDARY.doesNotProve.some((line) => /world-state/i.test(line)));
  assert.ok(RECEIPT_PROOF_BOUNDARY.doesNotProve.some((line) => /invocable/i.test(line)));
  assert.ok(RECEIPT_PROOF_BOUNDARY.doesNotProve.some((line) => /deny decision is an execution receipt/i.test(line)));
  assert.match(SCHEMA, /not independent world-state proof/i);
});
