/**
 * Tests for Universal Agent Adapter & Verify-and-Repair Loop (Dan Kornas Steal)
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { UniversalAgentAdapter } = require('../src/universal-agent-adapter');

test('UniversalAgentAdapter - performs verify-and-repair loop and self-heals after failure', async () => {
  let attemptCount = 0;
  const mockExecutor = async (agentType, prompt) => {
    attemptCount++;
    return {
      status: 'completed',
      hasUnindexedQuery: prompt.includes('ATTEMPT REPAIR REQUIRED') ? false : true
    };
  };

  const verifierDiode = {
    async verify(result) {
      if (result.hasUnindexedQuery) {
        return {
          passed: false,
          violations: [{ code: 'UNINDEXED_QUERY_DETECTED', message: 'Migration has table scan lock' }]
        };
      }
      return { passed: true, violations: [] };
    }
  };

  const adapter = new UniversalAgentAdapter({
    agentType: 'claude-code',
    maxRepairAttempts: 3,
    verifierDiode
  });

  const outcome = await adapter.executeWithVerifyAndRepair({
    taskPrompt: 'Create user migration table',
    workdir: '/tmp',
    mockExecutor
  });

  assert.equal(outcome.success, true);
  assert.equal(outcome.attemptsRequired, 2);
  assert.equal(outcome.repairHistory.length, 1);
  assert.equal(outcome.repairHistory[0].violations[0].code, 'UNINDEXED_QUERY_DETECTED');
});

test('UniversalAgentAdapter - rejects unsupported agent type', () => {
  assert.throws(() => {
    new UniversalAgentAdapter({ agentType: 'unsupported-bot' });
  }, /Unsupported agent type/);
});
