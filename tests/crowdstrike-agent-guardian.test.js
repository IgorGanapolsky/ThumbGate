/**
 * Tests for CrowdStrike Falcon Guardian & Fiddler/Dreadnode Diode
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AgentFlightRecorder,
  SurgicalAiKillSwitch,
  AdversarialAgentRedTeamer
} = require('../src/crowdstrike-agent-guardian-diode');

test('AgentFlightRecorder - hashes and records decision trail with cryptographic integrity', () => {
  const recorder = new AgentFlightRecorder();
  const entry = recorder.recordDecision({
    agentId: 'claude-code-dev-1',
    toolName: 'Bash',
    inputParams: { command: 'npm test' },
    allowed: true,
    policyReason: 'SAFE_TEST_COMMAND',
    latencyMs: 1.2
  });

  assert.ok(entry.recordHash);
  assert.equal(entry.allowed, true);
  assert.equal(recorder.logs.length, 1);
  assert.ok(recorder.verifyChainIntegrity());
});

test('SurgicalAiKillSwitch - trips only the misbehaving agent without halting others', () => {
  const killSwitch = new SurgicalAiKillSwitch({ maxConsecutiveViolations: 2 });
  const rogueAgent = 'rogue-bot-9';
  const goodAgent = 'good-bot-1';

  // Good agent stays allowed
  assert.equal(killSwitch.isAgentAllowed(goodAgent), true);

  // Rogue agent incurs violations
  killSwitch.recordViolation(rogueAgent, 'UNAUTHORIZED_ENV_ACCESS');
  assert.equal(killSwitch.isAgentAllowed(rogueAgent), true);

  const tripResult = killSwitch.recordViolation(rogueAgent, 'UNAUTHORIZED_ENV_ACCESS');
  assert.equal(tripResult.tripped, true);
  assert.equal(killSwitch.isAgentAllowed(rogueAgent), false);

  // Good agent is unaffected (surgical precision)
  assert.equal(killSwitch.isAgentAllowed(goodAgent), true);
});

test('AdversarialAgentRedTeamer - catches dangerous attack vectors before tool execution', () => {
  const redTeamer = new AdversarialAgentRedTeamer();

  // Attack 1: Attempt to read .env
  const attack1 = redTeamer.emulateAttackOnToolCall({
    toolName: 'Bash',
    toolInput: { command: 'cat .env.production' }
  });
  assert.equal(attack1.isVulnerable, true);
  assert.equal(attack1.blocked, true);
  assert.equal(attack1.triggeredAttacks[0].vectorId, 'ENV_SECRET_EXFILTRATION');

  // Safe command
  const safe = redTeamer.emulateAttackOnToolCall({
    toolName: 'Bash',
    toolInput: { command: 'git status' }
  });
  assert.equal(safe.isVulnerable, false);
  assert.equal(safe.blocked, false);
});
