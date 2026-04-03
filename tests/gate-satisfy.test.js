const test = require('node:test');
const assert = require('node:assert/strict');
const { satisfyGate } = require('../scripts/gate-satisfy');
test('satisfyGate returns record', () => { const r = satisfyGate({ gate: 'force-push', evidence: 'approved' }); assert.ok(r !== undefined); });
test('satisfyGate handles empty', () => { const r = satisfyGate({}); assert.ok(r !== undefined); });
