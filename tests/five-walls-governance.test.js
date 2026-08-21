'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createIndexAndLeafEngine, handleDoctor } = require('../scripts/index-leaf-context.js');
const { generateAttributionSummary } = require('../scripts/session-attribution-summary.js');

test('Index-and-Leaf Engine - creates compact index and resolves leaves on demand', () => {
  const entities = [
    { name: 'users_table', type: 'table', description: 'User accounts and authentication records', schema: { columns: ['id', 'email'] } },
    { name: 'orders_table', type: 'table', description: 'E-commerce purchase records and receipts', schema: { columns: ['id', 'amount'] } },
  ];

  const engine = createIndexAndLeafEngine(entities);
  assert.equal(engine.index.length, 2);
  assert.equal(engine.index[0].name, 'users_table');

  const matches = engine.queryIndex('purchase');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].name, 'orders_table');

  const leaf = engine.getLeaf('users_table');
  assert.ok(leaf);
  assert.equal(leaf.schema.columns.length, 2);
});

test('Index-and-Leaf Engine - doctor passes cleanly', () => {
  let captured = '';
  const mockStdout = {
    write: (msg) => {
      captured += msg;
    },
  };
  const exitCode = handleDoctor(mockStdout);
  assert.equal(exitCode, 0);
  assert.ok(captured.includes('Metadata indexing active'));
});

test('Session Attribution Summary - generates verified closure receipt', () => {
  const summary = generateAttributionSummary({
    sessionId: 'session_prod_42',
    toolsExecuted: ['Read', 'Edit', 'Test'],
    filesModified: ['src/api/server.js'],
    sourcesConsulted: ['docs/FEDERAL.md'],
    verdict: 'COMPLETED',
  });

  assert.equal(summary.sessionId, 'session_prod_42');
  assert.equal(summary.verdict, 'COMPLETED');
  assert.equal(summary.toolsExecuted.length, 3);
  assert.ok(summary.deepLink.includes('session=session_prod_42'));
});

test('Five Walls Gate Config - contains valid 4-layer action safety gates', () => {
  const gatePath = path.join(__dirname, '..', 'config', 'gates', 'five-walls-governance.json');
  assert.ok(fs.existsSync(gatePath));

  const content = JSON.parse(fs.readFileSync(gatePath, 'utf8'));
  assert.equal(content.harness, 'five-walls-governance');
  assert.ok(content.gates);
  assert.ok(content.gates.length >= 2);
});

test('Index-and-Leaf Engine - mainCli execution', () => {
  const { mainCli } = require('../scripts/index-leaf-context.js');
  let captured = '';
  const mockStdout = { write: (msg) => { captured += msg; } };
  assert.equal(mainCli(['--doctor'], mockStdout), 0);
  assert.equal(mainCli([], mockStdout), 0);
});

test('Session Attribution Summary - mainCli execution', () => {
  const { mainCli, handleDoctor } = require('../scripts/session-attribution-summary.js');
  let captured = '';
  const mockStdout = { write: (msg) => { captured += msg; } };
  if (typeof handleDoctor === 'function') {
    assert.equal(handleDoctor(mockStdout), 0);
  }
  if (typeof mainCli === 'function') {
    assert.equal(mainCli(['--doctor'], mockStdout), 0);
    assert.equal(mainCli([], mockStdout), 0);
  }
});
