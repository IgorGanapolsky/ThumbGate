const test = require('node:test');
const assert = require('node:assert/strict');

const {
  handleRequest,
  getToolListWithCaching,
  invalidateToolCache,
  executeBatch,
  TOOLS,
} = require('../adapters/mcp/server-stdio');

// ---------------------------------------------------------------------------
// Prompt Caching — tool list with cache_control
// ---------------------------------------------------------------------------

test('getToolListWithCaching returns tools array', () => {
  invalidateToolCache();
  const tools = getToolListWithCaching();
  assert.ok(Array.isArray(tools));
  assert.ok(tools.length > 0);
});

test('last tool in cached list has cache_control', () => {
  invalidateToolCache();
  const tools = getToolListWithCaching();
  const last = tools[tools.length - 1];
  assert.ok(last.cache_control, 'Last tool should have cache_control');
  assert.equal(last.cache_control.type, 'ephemeral');
});

test('non-last tools do not have cache_control', () => {
  invalidateToolCache();
  const tools = getToolListWithCaching();
  for (let i = 0; i < tools.length - 1; i++) {
    assert.ok(!tools[i].cache_control, `Tool ${tools[i].name} should not have cache_control`);
  }
});

test('cached tool list is memoized', () => {
  invalidateToolCache();
  const first = getToolListWithCaching();
  const second = getToolListWithCaching();
  assert.strictEqual(first, second, 'Should return same reference');
});

test('invalidateToolCache clears memoized list', () => {
  const first = getToolListWithCaching();
  invalidateToolCache();
  const second = getToolListWithCaching();
  assert.notStrictEqual(first, second, 'Should return new reference after invalidation');
});

// ---------------------------------------------------------------------------
// Initialize response advertises caching and batch capabilities
// ---------------------------------------------------------------------------

test('initialize response includes caching capability', async () => {
  const result = await handleRequest({
    id: 'test-init-cache',
    method: 'initialize',
    params: {},
  });
  assert.ok(result.capabilities.caching, 'Should advertise caching capability');
  assert.equal(result.capabilities.caching.supported, true);
});

test('initialize response includes batchCalls capability', async () => {
  const result = await handleRequest({
    id: 'test-init-batch',
    method: 'initialize',
    params: {},
  });
  assert.ok(result.capabilities.batchCalls, 'Should advertise batch calls capability');
  assert.equal(result.capabilities.batchCalls.supported, true);
});

// ---------------------------------------------------------------------------
// tools/list returns cached tools
// ---------------------------------------------------------------------------

test('tools/list returns tools with cache_control on last entry', async () => {
  invalidateToolCache();
  const result = await handleRequest({
    id: 'test-list',
    method: 'tools/list',
    params: {},
  });
  assert.ok(Array.isArray(result.tools));
  const last = result.tools[result.tools.length - 1];
  assert.ok(last.cache_control);
});

// ---------------------------------------------------------------------------
// Parallel MCP batch calls
// ---------------------------------------------------------------------------

test('tools/call_batch rejects empty calls array', async () => {
  await assert.rejects(
    () => handleRequest({
      id: 'test-batch-empty',
      method: 'tools/call_batch',
      params: { calls: [] },
    }),
    /non-empty calls array/
  );
});

test('tools/call_batch executes multiple tools in parallel', async () => {
  const result = await handleRequest({
    id: 'test-batch',
    method: 'tools/call_batch',
    params: {
      calls: [
        { name: 'gate_stats', arguments: {} },
        { name: 'feedback_stats', arguments: {} },
      ],
    },
  });
  assert.ok(result.results);
  assert.equal(result.results.length, 2);
});

test('executeBatch handles errors gracefully', async () => {
  const results = await executeBatch([
    { name: 'nonexistent_tool_xyz', arguments: {} },
    { name: 'gate_stats', arguments: {} },
  ]);
  assert.equal(results.length, 2);
  // First call should have an error
  assert.ok(results[0].isError || results[0].content);
  // Second call should succeed
  assert.ok(results[1].content);
});

test('executeBatch preserves callId', async () => {
  const results = await executeBatch([
    { name: 'gate_stats', arguments: {}, callId: 'call-1' },
    { name: 'gate_stats', arguments: {}, callId: 'call-2' },
  ]);
  assert.equal(results[0].callId, 'call-1');
  assert.equal(results[1].callId, 'call-2');
});
