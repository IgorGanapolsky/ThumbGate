'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { __test__ } = require('../src/api/server');
const { getPublicMcpTools, getServerCardTools } = __test__;

// The Claude Connectors Directory requires every tool to declare either
// readOnlyHint:true or destructiveHint:true (missing annotations is the #1
// rejection cause). The remote /mcp tools/list (getPublicMcpTools) was dropping
// the tool-registry annotations entirely; this test pins them back on.

function assertEveryToolAnnotated(tools, label) {
  assert.ok(Array.isArray(tools) && tools.length > 0, `${label}: non-empty tool list`);
  const missing = tools.filter((t) => {
    const a = t.annotations || {};
    return a.readOnlyHint !== true && a.destructiveHint !== true;
  });
  assert.equal(
    missing.length,
    0,
    `${label}: ${missing.length} tool(s) missing a readOnlyHint/destructiveHint annotation: ${missing.map((t) => t.name).join(', ')}`,
  );
}

test('getPublicMcpTools (remote /mcp tools/list) annotates every tool', () => {
  assertEveryToolAnnotated(getPublicMcpTools(), 'getPublicMcpTools');
});

test('getServerCardTools (discovery) annotates every tool', () => {
  assertEveryToolAnnotated(getServerCardTools(), 'getServerCardTools');
});

test('served tools keep name + inputSchema alongside annotations', () => {
  const tools = getPublicMcpTools();
  for (const t of tools) {
    assert.equal(typeof t.name, 'string');
    assert.ok(t.inputSchema, `${t.name} keeps its inputSchema`);
  }
});
