const test = require('node:test');
const assert = require('node:assert/strict');

const { TOOLS } = require('../scripts/tool-registry');

test('TOOLS is a non-empty array of tool definitions', () => {
  assert.ok(Array.isArray(TOOLS));
  assert.ok(TOOLS.length > 5, `expected >5 tools, got ${TOOLS.length}`);
});

test('every tool has name, description, and inputSchema', () => {
  for (const tool of TOOLS) {
    assert.ok(tool.name, `tool missing name: ${JSON.stringify(tool)}`);
    assert.ok(tool.description, `tool ${tool.name} missing description`);
    assert.ok(tool.inputSchema, `tool ${tool.name} missing inputSchema`);
    assert.equal(tool.inputSchema.type, 'object', `tool ${tool.name} schema type must be object`);
  }
});

test('capture_feedback tool exists with required signal param', () => {
  const captureTool = TOOLS.find(t => t.name === 'capture_feedback');
  assert.ok(captureTool, 'capture_feedback tool must exist');
  assert.ok(captureTool.inputSchema.properties.signal, 'capture_feedback must have signal property');
});

test('recall tool exists', () => {
  const recallTool = TOOLS.find(t => t.name === 'recall');
  assert.ok(recallTool, 'recall tool must exist');
});

test('tool names are unique', () => {
  const names = TOOLS.map(t => t.name);
  const unique = new Set(names);
  assert.equal(names.length, unique.size, `duplicate tool names: ${names.filter((n, i) => names.indexOf(n) !== i)}`);
});
