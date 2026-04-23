'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyProduct,
  TIER_IMAGE_MAP,
  buildUpdatePlan,
  run,
} = require('../scripts/stripe-sync-product-images');

function silentLogger() {
  const logs = [];
  return {
    log: (...args) => { logs.push({ level: 'log', message: args.join(' ') }); },
    error: (...args) => { logs.push({ level: 'error', message: args.join(' ') }); },
    entries: logs,
  };
}

async function* asyncIter(items) {
  for (const item of items) yield item;
}

function makeStripeMock(products, updateLog) {
  return (secret, options) => {
    updateLog.factoryCalls.push({ secret, options });
    return {
      products: {
        list: () => asyncIter(products),
        update: async (id, payload) => {
          updateLog.updates.push({ id, payload });
          return { id, ...payload };
        },
      },
    };
  };
}

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
  const logger = silentLogger();
  try {
    await run({ dryRun: true, logger });
    assert.equal(process.exitCode, 2);
    assert.ok(logger.entries.some((e) => e.level === 'error' && e.message.includes('STRIPE_SECRET_KEY')));
  } finally {
    process.exitCode = originalExitCode;
    if (originalKey !== undefined) process.env.STRIPE_SECRET_KEY = originalKey;
  }
});

test('run aborts with exit code 2 when stripe factory cannot be loaded', async () => {
  const originalKey = process.env.STRIPE_SECRET_KEY;
  const originalExitCode = process.exitCode;
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  const logger = silentLogger();
  try {
    // Force the "stripe package not installed" branch by supplying a factory
    // that is explicitly null.
    await run({ dryRun: true, stripeFactory: null, logger: logger });
  } finally {
    process.exitCode = originalExitCode;
    if (originalKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = originalKey;
  }
});

test('buildUpdatePlan marks Team/Pro as needing update and skips already-correct entries', async () => {
  const products = [
    { id: 'prod_team_1', name: 'ThumbGate Team — Org-wide AI agent immunity', images: [] },
    { id: 'prod_pro_1', name: 'ThumbGate Pro — Stop burning tokens', images: ['https://old.example.com/icon.png'] },
    { id: 'prod_pro_2', name: 'ThumbGate Pro — pre-patched row', images: [TIER_IMAGE_MAP.find((e) => e.tier === 'pro').imageUrl] },
    { id: 'prod_audit', name: 'SaaS Growth Audit', images: ['https://unrelated.example.com/rocket.png'] },
  ];
  const plan = await buildUpdatePlan(asyncIter(products));
  assert.equal(plan.length, 3, 'unrelated products must be dropped from the plan');
  const byId = Object.fromEntries(plan.map((entry) => [entry.productId, entry]));
  assert.equal(byId.prod_team_1.needsUpdate, true);
  assert.equal(byId.prod_team_1.tier, 'team');
  assert.equal(byId.prod_pro_1.needsUpdate, true);
  assert.equal(byId.prod_pro_2.needsUpdate, false, 'pre-patched rows must be skipped');
  assert.equal(byId.prod_pro_2.tier, 'pro');
});

test('run patches every product that needs updating and returns the updated ids', async () => {
  const originalKey = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  const logger = silentLogger();
  const updateLog = { factoryCalls: [], updates: [] };
  const products = [
    { id: 'prod_team_1', name: 'ThumbGate Team tier', images: [] },
    { id: 'prod_pro_1', name: 'ThumbGate Pro tier', images: ['https://old.example.com/icon.png'] },
    { id: 'prod_unrelated', name: 'SaaS Growth Audit', images: [] },
  ];
  try {
    const result = await run({
      dryRun: false,
      stripeFactory: makeStripeMock(products, updateLog),
      logger,
    });
    assert.equal(updateLog.factoryCalls.length, 1);
    assert.equal(updateLog.factoryCalls[0].secret, 'sk_test_mock');
    assert.equal(updateLog.factoryCalls[0].options.apiVersion, '2024-06-20');
    assert.equal(updateLog.updates.length, 2);
    const patchedIds = updateLog.updates.map((entry) => entry.id).sort();
    assert.deepEqual(patchedIds, ['prod_pro_1', 'prod_team_1']);
    const proUpdate = updateLog.updates.find((entry) => entry.id === 'prod_pro_1');
    assert.match(proUpdate.payload.images[0], /thumbgate-icon-pro-512\.png$/);
    const teamUpdate = updateLog.updates.find((entry) => entry.id === 'prod_team_1');
    assert.match(teamUpdate.payload.images[0], /thumbgate-icon-team-512\.png$/);
    assert.deepEqual(result.updatedIds.sort(), ['prod_pro_1', 'prod_team_1']);
  } finally {
    if (originalKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = originalKey;
  }
});

test('run in dry-run mode builds the plan but issues zero Stripe writes', async () => {
  const originalKey = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
  const logger = silentLogger();
  const updateLog = { factoryCalls: [], updates: [] };
  const products = [
    { id: 'prod_team_1', name: 'ThumbGate Team tier', images: [] },
    { id: 'prod_pro_1', name: 'ThumbGate Pro tier', images: [] },
  ];
  try {
    const result = await run({
      dryRun: true,
      stripeFactory: makeStripeMock(products, updateLog),
      logger,
    });
    assert.equal(updateLog.updates.length, 0, 'dry run must issue zero writes');
    assert.equal(result.plan.length, 2);
    assert.deepEqual(result.updatedIds, []);
    assert.ok(logger.entries.some((e) => e.message.includes('Dry run')));
  } finally {
    if (originalKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = originalKey;
  }
});
