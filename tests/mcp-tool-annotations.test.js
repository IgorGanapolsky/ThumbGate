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
  const missingHint = tools.filter((t) => {
    const a = t.annotations || {};
    return a.readOnlyHint !== true && a.destructiveHint !== true;
  });
  assert.equal(
    missingHint.length,
    0,
    `${label}: ${missingHint.length} tool(s) missing a readOnlyHint/destructiveHint annotation: ${missingHint.map((t) => t.name).join(', ')}`,
  );
  // Connectors Directory requires a title on every tool, in addition to a hint.
  const missingTitle = tools.filter((t) => !t.title || typeof t.title !== 'string');
  assert.equal(
    missingTitle.length,
    0,
    `${label}: ${missingTitle.length} tool(s) missing a title: ${missingTitle.map((t) => t.name).join(', ')}`,
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
