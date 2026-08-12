'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  checkIdempotencyKey,
  computeActionDigest,
  extractIdempotencyKey,
  resetDefaultStore,
} = require('../scripts/mcp-idempotency-guard');

test.afterEach(() => {
  resetDefaultStore();
});

test('MCP Idempotency Guard', async (t) => {
  await t.test('allows the first side-effect request with a key', () => {
    const store = new Map();
    const result = checkIdempotencyKey({
      idempotencyKey: 'create-widget-1',
      toolName: 'create_widget',
      toolInput: { name: 'Widget A' },
      sideEffect: true,
      agentId: 'agent-1',
      store,
    });
    assert.equal(result.allowed, true);
    assert.equal(result.code, 'IDEMPOTENCY_KEY_STORED');
    assert.equal(result.isDuplicate, false);
  });

  await t.test('rejects duplicate side-effect requests with the same key', () => {
    const store = new Map();
    checkIdempotencyKey({
      idempotencyKey: 'create-widget-1',
      toolName: 'create_widget',
      toolInput: { name: 'Widget A' },
      sideEffect: true,
      store,
    });

    const result = checkIdempotencyKey({
      idempotencyKey: 'create-widget-1',
      toolName: 'create_widget',
      toolInput: { name: 'Widget A' },
      sideEffect: true,
      store,
    });
    assert.equal(result.allowed, false);
    assert.equal(result.code, 'DUPLICATE_SIDE_EFFECT');
  });

  await t.test('allows idempotent read-only requests with the same key', () => {
    const store = new Map();
    checkIdempotencyKey({
      idempotencyKey: 'read-widget-1',
      toolName: 'get_widget',
      toolInput: { id: 'widget-1' },
      sideEffect: false,
      store,
    });

    const result = checkIdempotencyKey({
      idempotencyKey: 'read-widget-1',
      toolName: 'get_widget',
      toolInput: { id: 'widget-1' },
      sideEffect: false,
      store,
    });
    assert.equal(result.allowed, true);
    assert.equal(result.isDuplicate, true);
    assert.equal(result.code, 'IDEMPOTENCY_KEY_REUSED');
  });

  await t.test('rejects the same key used with different arguments', () => {
    const store = new Map();
    checkIdempotencyKey({
      idempotencyKey: 'update-widget-1',
      toolName: 'update_widget',
      toolInput: { id: 'widget-1', name: 'A' },
      sideEffect: true,
      store,
    });

    const result = checkIdempotencyKey({
      idempotencyKey: 'update-widget-1',
      toolName: 'update_widget',
      toolInput: { id: 'widget-1', name: 'B' },
      sideEffect: true,
      store,
    });
    assert.equal(result.allowed, false);
    assert.equal(result.code, 'IDEMPOTENCY_KEY_CONFLICT');
  });

  await t.test('ignores metadata fields when computing action digest', () => {
    const store = new Map();
    checkIdempotencyKey({
      idempotencyKey: 'retry-widget-1',
      toolName: 'create_widget',
      toolInput: { name: 'Widget A', idempotencyKey: 'retry-widget-1', mcpSessionHandle: 'old-handle', turnDepth: 5 },
      sideEffect: true,
      store,
    });

    const result = checkIdempotencyKey({
      idempotencyKey: 'retry-widget-1',
      toolName: 'create_widget',
      toolInput: { name: 'Widget A', idempotencyKey: 'retry-widget-1', mcpSessionHandle: 'new-handle', turnDepth: 6 },
      sideEffect: true,
      store,
    });
    assert.equal(result.allowed, false, 'duplicate side effect should be rejected even if metadata changed');
    assert.equal(result.code, 'DUPLICATE_SIDE_EFFECT');
  });

  await t.test('requires idempotency keys for side-effect calls when required=true', () => {
    const result = checkIdempotencyKey({
      toolName: 'create_widget',
      toolInput: { name: 'Widget A' },
      sideEffect: true,
      required: true,
    });
    assert.equal(result.allowed, false);
    assert.equal(result.code, 'IDEMPOTENCY_KEY_REQUIRED');
  });

  await t.test('extracts idempotency key from multiple field names', () => {
    assert.equal(extractIdempotencyKey({ idempotencyKey: 'k1' }), 'k1');
    assert.equal(extractIdempotencyKey({ idempotency_key: 'k2' }), 'k2');
    assert.equal(extractIdempotencyKey({ idempotencyId: 'k3' }), 'k3');
  });

  await t.test('computes stable action digest for identical inputs', () => {
    const d1 = computeActionDigest('create_widget', { name: 'A', idempotencyKey: 'k' });
    const d2 = computeActionDigest('create_widget', { idempotencyKey: 'k', name: 'A' });
    assert.equal(d1, d2);
    const d3 = computeActionDigest('create_widget', { name: 'B', idempotencyKey: 'k' });
    assert.notEqual(d1, d3);
  });
});
