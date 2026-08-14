'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  advanceResearchStep,
  runResearchCycle,
} = require('../scripts/research-agent-harness');

test('full cycle succeeds and ratchets difficulty (harder next round)', () => {
  const cycle = runResearchCycle(
    [
      { step: 'hypothesis', payload: { hypothesis: 'latency drops with caching' } },
      { step: 'experiment', payload: { method: 'A/B cache on/off', experimentId: 'exp1' } },
      { step: 'verify', payload: { evidence: 'p95 120ms→80ms', passed: true } },
      { step: 'claim', payload: { claim: 'cache reduces p95 latency by 33%' } },
    ],
    { difficulty: 1 }
  );
  assert.equal(cycle.success, true);
  assert.equal(cycle.finalDifficulty, 2);
  assert.ok(cycle.outcomes[3].harderNextRound);
});

test('claim without verify is denied', () => {
  const out = advanceResearchStep({
    step: 'claim',
    payload: { claim: 'we fixed everything' },
    state: { difficulty: 1, completed: ['hypothesis', 'experiment'], evidence: [] },
  });
  assert.equal(out.allowed, false);
  assert.equal(out.code, 'CLAIM_WITHOUT_VERIFY');
});

test('strict ordering at difficulty ≥2', () => {
  const out = advanceResearchStep({
    step: 'experiment',
    payload: { method: 'run bench' },
    state: { difficulty: 2, completed: [] },
  });
  assert.equal(out.allowed, false);
  assert.equal(out.code, 'ORDER_VIOLATION');
});

test('destructive tool during research is interdicted', () => {
  const out = advanceResearchStep({
    step: 'experiment',
    payload: { method: 'cleanup' },
    toolCall: { toolName: 'Bash', params: { command: 'rm -rf /' } },
    state: {
      difficulty: 1,
      completed: ['hypothesis'],
    },
  });
  assert.equal(out.allowed, false);
  assert.equal(out.code, 'TOOL_INTERDICTED');
});

test('difficulty ≥4 forbids claim after failed verify', () => {
  const out = advanceResearchStep({
    step: 'claim',
    payload: { claim: 'still shipping despite red tests' },
    state: {
      difficulty: 4,
      completed: ['hypothesis', 'experiment', 'verify'],
      evidence: [{ passed: false, evidence: 'tests failed' }],
    },
  });
  assert.equal(out.allowed, false);
  assert.equal(out.code, 'CLAIM_ON_FAILED_VERIFY');
});
