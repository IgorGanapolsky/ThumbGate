'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  ExternalAiKillSwitch,
  AgentFlightRecorder,
  runDreadnodeRedTeamBattery,
  runDoctor,
} = require('../scripts/flight-recorder-and-killswitch.js');

describe('Falcon AI Kill Switch & Flight Recorder', () => {
  it('allows safe tool commands when armed', () => {
    const ks = new ExternalAiKillSwitch();
    const res = ks.evaluateToolCall({
      toolName: 'terminal',
      toolInput: { command: 'git status && npm test' },
    });
    assert.strictEqual(res.allowed, true);
    assert.strictEqual(res.verdict, 'ALLOW');
    assert.strictEqual(ks.status, 'ARMED');
  });

  it('triggers external kill switch immediately on catastrophic shell commands', () => {
    const ks = new ExternalAiKillSwitch();
    const res = ks.evaluateToolCall({
      toolName: 'terminal',
      toolInput: { command: 'rm -rf /' },
    });
    assert.strictEqual(res.allowed, false);
    assert.strictEqual(res.verdict, 'KILL_SWITCH_TRIGGERED');
    assert.strictEqual(ks.status, 'TRIGGERED');

    // Subsequent commands must be blocked immediately without evaluating contents
    const nextRes = ks.evaluateToolCall({
      toolName: 'terminal',
      toolInput: { command: 'echo hello' },
    });
    assert.strictEqual(nextRes.allowed, false);
    assert.strictEqual(nextRes.verdict, 'KILL_SWITCH_ACTIVE');
  });

  it('triggers kill switch when budget limit is exceeded (Denial of Wallet)', () => {
    const ks = new ExternalAiKillSwitch({ costBudgetUsd: 10.0 });
    const res1 = ks.evaluateToolCall({ toolName: 'llm_call', estimatedCostUsd: 4.0 });
    assert.strictEqual(res1.allowed, true);

    const res2 = ks.evaluateToolCall({ toolName: 'llm_call', estimatedCostUsd: 8.0 });
    assert.strictEqual(res2.allowed, false);
    assert.strictEqual(res2.verdict, 'KILL_SWITCH_TRIGGERED');
    assert.match(res2.reason, /cost budget/i);
  });

  it('triggers kill switch after consecutive failure threshold', () => {
    const ks = new ExternalAiKillSwitch({ maxConsecutiveFailures: 2 });
    ks.recordFailure();
    assert.strictEqual(ks.status, 'ARMED');
    ks.recordFailure();
    assert.strictEqual(ks.status, 'TRIGGERED');
    assert.match(ks.triggerReason, /consecutive failure/i);
  });

  it('requires verified operator auth token to disarm', () => {
    const ks = new ExternalAiKillSwitch();
    ks.trigger('Manual panic');
    const unauthorized = ks.disarm('bad_token');
    assert.strictEqual(unauthorized.ok, false);
    assert.strictEqual(ks.status, 'TRIGGERED');

    const authorized = ks.disarm('OPERATOR_OVERRIDE_CONFIRMED');
    assert.strictEqual(authorized.ok, true);
    assert.strictEqual(ks.status, 'DISARMED');
  });

  it('records immutable audit timeline via Agent Flight Recorder', () => {
    const recorder = new AgentFlightRecorder({ agentId: 'test-agent' });
    const entry = recorder.recordEntry({
      eventType: 'DECISION_TRACE',
      intent: 'Analyze customer churn',
      toolName: 'sql_query',
      toolInput: { query: 'SELECT count(*) FROM users' },
      toolOutput: { rows: 42 },
      verificationReceipt: { receiptHash: 'hash_123' },
    });

    assert.strictEqual(entry.agentId, 'test-agent');
    assert.ok(entry.inputDigest);
    assert.ok(entry.outputDigest);

    const audit = recorder.generateAuditReport();
    assert.strictEqual(audit.totalRecordedEvents, 1);
    assert.strictEqual(audit.eventsByType.DECISION_TRACE, 1);
    assert.ok(audit.complianceStatement);
  });

  it('blocks 100% of Dreadnode OWASP LLM red-team attack vectors', () => {
    const report = runDreadnodeRedTeamBattery();
    assert.strictEqual(report.allPassed, true);
    assert.strictEqual(report.verdict, 'PASS');
    assert.strictEqual(report.blockedAttacks, report.totalAttacks);
  });

  it('passes full doctor health check', () => {
    const doctor = runDoctor();
    assert.strictEqual(doctor.ok, true);
    assert.strictEqual(doctor.verdict, 'PASS');
  });
});
