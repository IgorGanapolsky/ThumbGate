'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyProduct,
  TIER_IMAGE_MAP,
  run,
} = require('../scripts/stripe-sync-product-images');

test('TIER_IMAGE_MAP exposes exactly three entries (free, pro, team) with distinct URLs', () => {
  const tiers = TIER_IMAGE_MAP.map((entry) => entry.tier).sort();
  assert.deepEqual(tiers, ['free', 'pro', 'team']);
  const urls = new Set(TIER_IMAGE_MAP.map((entry) => entry.imageUrl));
  assert.equal(urls.size, 3, 'every tier must have a distinct image URL');
});

test('classifyProduct matches Pro products by name prefix', () => {
  const match = classifyProduct({ name: 'ThumbGate Pro — Stop burning tokens on the same AI mistake' });
  assert.ok(match, 'expected a tier match for Pro product');
  assert.equal(match.tier, 'pro');
  assert.match(match.imageUrl, /thumbgate-icon-pro-512\.png$/);
});

test('classifyProduct matches Team products including org-wide variant', () => {
  const match = classifyProduct({ name: 'ThumbGate Team — Org-wide AI agent immunity' });
  assert.ok(match, 'expected a tier match for Team product');
  assert.equal(match.tier, 'team');
  assert.match(match.imageUrl, /thumbgate-icon-team-512\.png$/);
});

test('classifyProduct matches Free products to the base icon URL', () => {
  const match = classifyProduct({ name: 'ThumbGate Free — Agent guardrails' });
  assert.ok(match, 'expected a tier match for Free product');
  assert.equal(match.tier, 'free');
  assert.match(match.imageUrl, /thumbgate-icon-512\.png$/);
  assert.doesNotMatch(match.imageUrl, /thumbgate-icon-(pro|team)-512\.png$/);
});

test('classifyProduct returns null for unrelated products', () => {
  assert.equal(classifyProduct({ name: 'ThumbGate Credit Pack' }), null);
  assert.equal(classifyProduct({ name: 'SaaS Growth Audit' }), null);
  assert.equal(classifyProduct({ name: '' }), null);
  assert.equal(classifyProduct({}), null);
});

test('classifyProduct is case-insensitive on the tier keyword', () => {
  assert.equal(classifyProduct({ name: 'thumbgate pro plan' }).tier, 'pro');
  assert.equal(classifyProduct({ name: 'THUMBGATE TEAM seats' }).tier, 'team');
});

test('run aborts with exit code 2 when STRIPE_SECRET_KEY is absent', async () => {
  const originalKey = process.env.STRIPE_SECRET_KEY;
  const originalExitCode = process.exitCode;
  delete process.env.STRIPE_SECRET_KEY;
  const originalError = console.error;
  const messages = [];
  console.error = (...args) => { messages.push(args.join(' ')); };
  try {
    await run({ dryRun: true });
    assert.equal(process.exitCode, 2);
    assert.ok(messages.some((m) => m.includes('STRIPE_SECRET_KEY')));
  } finally {
    console.error = originalError;
    process.exitCode = originalExitCode;
    if (originalKey !== undefined) process.env.STRIPE_SECRET_KEY = originalKey;
  }
});
