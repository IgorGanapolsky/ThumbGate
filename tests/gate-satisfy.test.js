const test = require('node:test');
const assert = require('node:assert/strict');
const { satisfyGate } = require('../scripts/gate-satisfy');
test('satisfyGate returns satisfaction record', () => {
  const r = satisfyGate({ gate: 'force-push', evidence: 'user approved' });
  assert.ok(r.gate || r.satisfied !== undefined);
});
test('satisfyGate handles missing gate name', () => {
  const r = satisfyGate({});
  assert.ok(r !== undefined);
});
