'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

// Isolate feedback storage so tests don't read real lesson data
const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-suggest-fix-test-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpFeedbackDir;

test.after(() => {
  fs.rmSync(tmpFeedbackDir, { recursive: true, force: true });
});

const { handleRequest, TOOLS, buildSuggestFixResponse } = require('../adapters/mcp/server-stdio');

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

test('suggest_fix tool is registered in TOOLS array', () => {
  const tool = TOOLS.find((t) => t.name === 'suggest_fix');
  assert.ok(tool, 'suggest_fix should be in TOOLS array');
  assert.ok(tool.inputSchema, 'should have inputSchema');
  assert.deepEqual(tool.inputSchema.required, ['context'], 'context is required');
  assert.ok(tool.inputSchema.properties.context, 'context property should exist');
  assert.ok(tool.inputSchema.properties.limit, 'limit property should exist');
});

test('suggest_fix appears in tools/list', async () => {
  const result = await handleRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
  });
  const names = result.tools.map((t) => t.name);
  assert.ok(names.includes('suggest_fix'), 'suggest_fix should appear in tools/list');
});

// ---------------------------------------------------------------------------
// Handler function: buildSuggestFixResponse
// ---------------------------------------------------------------------------

test('buildSuggestFixResponse returns suggestions array', () => {
  const result = buildSuggestFixResponse({ context: 'deployment failed with missing dependency' });
  assert.ok(result, 'should return a result object');
  assert.ok(result.content, 'result should have content');
  const parsed = JSON.parse(result.content[0].text);
  assert.ok(Array.isArray(parsed.suggestions), 'suggestions should be an array');
  assert.ok(parsed.suggestions.length > 0, 'should return at least one suggestion');
});

test('buildSuggestFixResponse: each suggestion has action and source fields', () => {
  const result = buildSuggestFixResponse({ context: 'git push failed' });
  const parsed = JSON.parse(result.content[0].text);
  for (const suggestion of parsed.suggestions) {
    assert.ok(typeof suggestion.action === 'string', 'action should be a string');
    assert.ok(typeof suggestion.source === 'string', 'source should be a string');
    assert.ok(suggestion.action.length > 0, 'action should not be empty');
    assert.ok(suggestion.source.length > 0, 'source should not be empty');
  }
});

test('buildSuggestFixResponse: handles empty context gracefully', () => {
  const result = buildSuggestFixResponse({ context: '' });
  assert.ok(result, 'should return a result even for empty context');
  const parsed = JSON.parse(result.content[0].text);
  assert.ok(Array.isArray(parsed.suggestions), 'suggestions should be an array');
  assert.ok(parsed.suggestions.length > 0, 'should include generic fallback suggestion');
  assert.equal(parsed.suggestions[0].source, 'generic', 'fallback should use generic source');
});

test('buildSuggestFixResponse: handles missing context argument gracefully', () => {
  const result = buildSuggestFixResponse({});
  const parsed = JSON.parse(result.content[0].text);
  assert.ok(Array.isArray(parsed.suggestions), 'suggestions should be an array');
  assert.ok(parsed.suggestions.length >= 1, 'should include at least a generic fallback');
});

test('buildSuggestFixResponse: respects limit parameter', () => {
  const result = buildSuggestFixResponse({ context: 'test failure context', limit: 1 });
  const parsed = JSON.parse(result.content[0].text);
  assert.ok(parsed.suggestions.length <= 1, 'should not exceed requested limit');
});

test('buildSuggestFixResponse: caps at 5 suggestions even when limit is higher', () => {
  const result = buildSuggestFixResponse({ context: 'production deploy failure', limit: 100 });
  const parsed = JSON.parse(result.content[0].text);
  assert.ok(parsed.suggestions.length <= 5, 'should cap at 5 suggestions maximum');
});

test('buildSuggestFixResponse: returns query and totalFound fields', () => {
  const context = 'ci check failed';
  const result = buildSuggestFixResponse({ context });
  const parsed = JSON.parse(result.content[0].text);
  assert.ok('query' in parsed, 'result should include query field');
  assert.ok('totalFound' in parsed, 'result should include totalFound field');
  assert.equal(parsed.query, context, 'query should match input context');
  assert.ok(typeof parsed.totalFound === 'number', 'totalFound should be a number');
});

// ---------------------------------------------------------------------------
// MCP JSON-RPC integration
// ---------------------------------------------------------------------------

test('suggest_fix tool callable via handleRequest', async () => {
  const result = await handleRequest({
    jsonrpc: '2.0',
    id: 10,
    method: 'tools/call',
    params: {
      name: 'suggest_fix',
      arguments: { context: 'tests failed unexpectedly' },
    },
  });
  assert.ok(result.content, 'should return content');
  const parsed = JSON.parse(result.content[0].text);
  assert.ok(Array.isArray(parsed.suggestions), 'should return suggestions array');
  for (const suggestion of parsed.suggestions) {
    assert.ok(typeof suggestion.action === 'string', 'action should be a string');
    assert.ok(typeof suggestion.source === 'string', 'source should be a string');
  }
});

test('suggest_fix returns generic suggestion when no lessons exist', async () => {
  // Empty feedback dir means no lessons — should still return graceful fallback
  const result = await handleRequest({
    jsonrpc: '2.0',
    id: 11,
    method: 'tools/call',
    params: {
      name: 'suggest_fix',
      arguments: { context: 'completely unknown error xyz123' },
    },
  });
  const parsed = JSON.parse(result.content[0].text);
  assert.ok(parsed.suggestions.length >= 1, 'should always return at least one suggestion');
  assert.ok(
    parsed.suggestions.every((s) => typeof s.action === 'string' && s.action.length > 0),
    'all suggestions must have non-empty action',
  );
});
