'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateHotdataToolCall } = require('../scripts/demo-hotdata-eddie');

test('Hotdata Diode: allows read-only HotSQL exploration in sub-millisecond latency', () => {
  const history = [];
  const res = evaluateHotdataToolCall({
    step: 1,
    toolName: 'hotdata_query',
    commandOrSql: 'SELECT neighbourhood, COUNT(*) FROM airbnb.public.listings GROUP BY 1 LIMIT 5',
    history,
  });
  assert.equal(res.decision, 'ALLOW');
  assert.equal(res.gateId, 'gate:hotdata:read_exploration_pass');
  assert.ok(res.latencyMs < 5);
});

test('Hotdata Diode: blocks unbounded DELETE at the Write Boundary', () => {
  const history = [];
  const res = evaluateHotdataToolCall({
    step: 2,
    toolName: 'prod_postgres_write',
    commandOrSql: 'DELETE FROM customer_invoices;',
    history,
  });
  assert.equal(res.decision, 'BLOCK');
  assert.equal(res.gateId, 'gate:hotdata:destructive_write_boundary');
});

test('Hotdata Diode: interdicts runaway 5x HotSQL retry loops', () => {
  const history = [];
  const q = 'SELECT bad_col FROM airbnb.public.listings';
  for (let i = 1; i <= 4; i++) {
    const ok = evaluateHotdataToolCall({ step: i, toolName: 'hotdata_query', commandOrSql: q, history });
    assert.equal(ok.decision, 'ALLOW');
  }
  const blocked = evaluateHotdataToolCall({ step: 5, toolName: 'hotdata_query', commandOrSql: q, history });
  assert.equal(blocked.decision, 'BLOCK');
  assert.equal(blocked.gateId, 'gate:hotdata:runaway_query_loop');
});
