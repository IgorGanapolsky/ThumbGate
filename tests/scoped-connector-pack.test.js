'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  loadScopedConnectorPacks,
  evaluateScopedConnectorPack,
  applyScopedPack,
  SCOPED_PACK_MAX_TOOLS,
} = require('../scripts/mcp-policy');

test('revenue-read pack shows five tools and blocks a tool outside it', () => {
  const doc = loadScopedConnectorPacks();
  const listed = evaluateScopedConnectorPack('revenue-read', null, doc);
  assert.equal(listed.decision, 'allow');
  assert.equal(listed.reason, 'pack_visible');
  assert.deepEqual(listed.visibleTools, [
    'get_business_metrics',
    'feedback_summary',
    'gate_stats',
    'verify_claim',
    'recall',
  ]);
  assert.ok(listed.visibleTools.length <= SCOPED_PACK_MAX_TOOLS);

  const allowed = evaluateScopedConnectorPack('revenue-read', 'get_business_metrics', doc);
  assert.equal(allowed.decision, 'allow');
  assert.equal(allowed.reason, 'in_pack');

  const hidden = evaluateScopedConnectorPack('revenue-read', 'capture_feedback', doc);
  assert.equal(hidden.decision, 'deny');
  assert.equal(hidden.reason, 'tool_not_in_pack');
});

test('a pack wider than five tools, a spend tool, or a non-zero budget is refused', () => {
  const wide = evaluateScopedConnectorPack('wide', null, {
    maxTools: 5,
    packs: {
      wide: {
        outboundCashSpendUsd: 0,
        tools: ['a', 'b', 'c', 'd', 'e', 'f'],
      },
    },
  });
  assert.equal(wide.decision, 'deny');
  assert.equal(wide.reason, 'pack_too_wide');
  assert.deepEqual(applyScopedPack(['a', 'b'], 'wide', {
    maxTools: 5,
    packs: { wide: { outboundCashSpendUsd: 0, tools: ['a', 'b', 'c', 'd', 'e', 'f'] } },
  }).toolNames, []);

  const spend = evaluateScopedConnectorPack('spend', 'create_purchase_requisition', {
    maxTools: 5,
    packs: {
      spend: {
        outboundCashSpendUsd: 0,
        tools: ['create_purchase_requisition'],
      },
    },
  });
  assert.equal(spend.decision, 'deny');
  assert.equal(spend.reason, 'spend_tool_in_pack');

  const budget = evaluateScopedConnectorPack('budget', null, {
    maxTools: 5,
    packs: {
      budget: {
        outboundCashSpendUsd: 1,
        tools: ['recall'],
      },
    },
  });
  assert.equal(budget.decision, 'deny');
  assert.equal(budget.reason, 'outbound_spend_not_zero');

  const missing = evaluateScopedConnectorPack('missing', 'recall', { packs: {} });
  assert.equal(missing.decision, 'deny');
  assert.equal(missing.reason, 'unknown_pack');
});

test('the live tool list hides tools outside the pack when the pack is selected', () => {
  const previousPack = process.env.THUMBGATE_SCOPED_PACK;
  const previousProfile = process.env.THUMBGATE_MCP_PROFILE;
  process.env.THUMBGATE_SCOPED_PACK = 'revenue-read';
  process.env.THUMBGATE_MCP_PROFILE = 'default';
  try {
    const { getExposedTools } = require('../adapters/mcp/server-stdio');
    const names = getExposedTools('default', { scopedPack: 'revenue-read' }).map((tool) => tool.name);
    assert.ok(names.includes('get_business_metrics'));
    assert.equal(names.includes('capture_feedback'), false);
    assert.equal(names.includes('create_purchase_requisition'), false);
    assert.ok(names.length <= 5);
    delete process.env.THUMBGATE_SCOPED_PACK;
    const unscoped = getExposedTools('default').map((tool) => tool.name);
    assert.ok(unscoped.includes('capture_feedback'));
  } finally {
    if (previousPack === undefined) delete process.env.THUMBGATE_SCOPED_PACK;
    else process.env.THUMBGATE_SCOPED_PACK = previousPack;
    if (previousProfile === undefined) delete process.env.THUMBGATE_MCP_PROFILE;
    else process.env.THUMBGATE_MCP_PROFILE = previousProfile;
  }
});

test('without a scoped pack the tool list is unchanged', () => {
  const previous = process.env.THUMBGATE_SCOPED_PACK;
  delete process.env.THUMBGATE_SCOPED_PACK;
  try {
    const result = applyScopedPack(['capture_feedback', 'recall']);
    assert.equal(result.applied, false);
    assert.deepEqual(result.toolNames, ['capture_feedback', 'recall']);
  } finally {
    if (previous === undefined) delete process.env.THUMBGATE_SCOPED_PACK;
    else process.env.THUMBGATE_SCOPED_PACK = previous;
  }
});
