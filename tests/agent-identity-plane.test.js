'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Isolate all identity-plane state before any module resolves a feedback dir.
const FEEDBACK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-identity-plane-'));
process.env.THUMBGATE_FEEDBACK_DIR = FEEDBACK_DIR;

const ENV_KEYS = ['THUMBGATE_SESSION_AGENT', 'THUMBGATE_AGENT_ID', 'THUMBGATE_STRICT_ENFORCEMENT'];
const savedEnv = {};
for (const key of ENV_KEYS) savedEnv[key] = process.env[key];

function resetEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

test.beforeEach(() => resetEnv());
test.after(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

const {
  registerAgent,
  retireAgent,
  recordObservedAgent,
  loadObservedAgents,
  loadAgentRegistry,
  buildAgentIdentitySecurityReport,
  getRegistryPath,
  getObservedAgentsPath,
} = require('../scripts/org-dashboard');
const { recordAuditEvent } = require('../scripts/audit-trail');
const { evaluateAgentIdentityLifecycleGate } = require('../scripts/gates-engine');

function readAuditRecords() {
  const auditPath = path.join(FEEDBACK_DIR, 'audit-trail.jsonl');
  if (!fs.existsSync(auditPath)) return [];
  return fs.readFileSync(auditPath, 'utf-8').trim().split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test('registerAgent defaults lifecycleStatus to active and retireAgent retires it', () => {
  registerAgent({ agentId: 'aip-reg-1', source: 'test' });
  let row = loadAgentRegistry().find((agent) => agent.id === 'aip-reg-1');
  assert.equal(row.metadata.lifecycleStatus, 'active');

  assert.equal(retireAgent('aip-reg-1', 'test retirement'), true);
  row = loadAgentRegistry().find((agent) => agent.id === 'aip-reg-1');
  assert.equal(row.metadata.lifecycleStatus, 'retired');
  assert.ok(row.metadata.retiredAt);
  assert.equal(row.metadata.retireReason, 'test retirement');
  assert.equal(retireAgent('aip-missing-agent'), false);
});

test('recordObservedAgent appends and loadObservedAgents aggregates per id', () => {
  recordObservedAgent('aip-obs-1');
  recordObservedAgent('aip-obs-1');
  recordObservedAgent('aip-obs-2');
  const rows = loadObservedAgents();
  const one = rows.find((row) => row.id === 'aip-obs-1');
  const two = rows.find((row) => row.id === 'aip-obs-2');
  assert.equal(one.observations, 2);
  assert.ok(one.firstSeenAt <= one.lastSeenAt);
  assert.equal(two.observations, 1);
  assert.equal(recordObservedAgent(''), null);
});

test('recordAuditEvent stamps agentId from THUMBGATE_SESSION_AGENT', () => {
  process.env.THUMBGATE_SESSION_AGENT = 'aip-audit-agent';
  const record = recordAuditEvent({ toolName: 'TestTool', decision: 'allow' });
  assert.equal(record.agentId, 'aip-audit-agent');

  resetEnv();
  const anonymous = recordAuditEvent({ toolName: 'TestTool', decision: 'allow' });
  assert.equal(anonymous.agentId, null);

  const explicit = recordAuditEvent({ toolName: 'TestTool', decision: 'allow', agentId: 'aip-explicit' });
  assert.equal(explicit.agentId, 'aip-explicit');
});

test('unattributed calls skip the identity gate entirely', () => {
  const before = fs.existsSync(getObservedAgentsPath())
    ? fs.readFileSync(getObservedAgentsPath(), 'utf-8')
    : '';
  assert.equal(evaluateAgentIdentityLifecycleGate('Bash', {}), null);
  const after = fs.existsSync(getObservedAgentsPath())
    ? fs.readFileSync(getObservedAgentsPath(), 'utf-8')
    : '';
  assert.equal(after, before);
});

test('shadow agent is observed and warned, never denied — even under strict', () => {
  process.env.THUMBGATE_SESSION_AGENT = 'aip-shadow-1';
  process.env.THUMBGATE_STRICT_ENFORCEMENT = '1';
  assert.equal(evaluateAgentIdentityLifecycleGate('Bash', { command: 'ls' }), null);

  assert.ok(loadObservedAgents().some((row) => row.id === 'aip-shadow-1'));
  const warns = readAuditRecords().filter((record) => (
    record.gateId === 'agent-identity-shadow' && record.agentId === 'aip-shadow-1'
  ));
  assert.equal(warns.length, 1);
  assert.equal(warns[0].decision, 'warn');

  // Warn dedup: a second call must not add another shadow warning.
  assert.equal(evaluateAgentIdentityLifecycleGate('Bash', { command: 'ls' }), null);
  const warnsAfter = readAuditRecords().filter((record) => (
    record.gateId === 'agent-identity-shadow' && record.agentId === 'aip-shadow-1'
  ));
  assert.equal(warnsAfter.length, 1);
});

test('registered active agent passes under strict enforcement', () => {
  registerAgent({ agentId: 'aip-active-1', source: 'test' });
  process.env.THUMBGATE_SESSION_AGENT = 'aip-active-1';
  process.env.THUMBGATE_STRICT_ENFORCEMENT = '1';
  assert.equal(evaluateAgentIdentityLifecycleGate('Bash', { command: 'ls' }), null);
});

test('retired agent still acting is denied under strict enforcement', () => {
  registerAgent({ agentId: 'aip-retired-1', source: 'test' });
  retireAgent('aip-retired-1');
  process.env.THUMBGATE_SESSION_AGENT = 'aip-retired-1';
  process.env.THUMBGATE_STRICT_ENFORCEMENT = '1';
  const verdict = evaluateAgentIdentityLifecycleGate('Bash', { command: 'ls' });
  assert.equal(verdict.gate, 'agent-identity-lifecycle');
  assert.equal(verdict.decision, 'deny');
  assert.equal(verdict.severity, 'critical');
  assert.match(verdict.message, /retired/);
});

test('retired agent warns (once) without strict enforcement', () => {
  registerAgent({ agentId: 'aip-retired-2', source: 'test' });
  retireAgent('aip-retired-2');
  process.env.THUMBGATE_SESSION_AGENT = 'aip-retired-2';
  assert.equal(evaluateAgentIdentityLifecycleGate('Bash', { command: 'ls' }), null);
  assert.equal(evaluateAgentIdentityLifecycleGate('Bash', { command: 'ls' }), null);
  const warns = readAuditRecords().filter((record) => (
    record.gateId === 'agent-identity-lifecycle' && record.agentId === 'aip-retired-2'
  ));
  assert.equal(warns.length, 1);
  assert.equal(warns[0].decision, 'warn');
});

test('identity gate fails open when the registry is corrupt', () => {
  fs.appendFileSync(getRegistryPath(), 'not-json at all{{{\n');
  process.env.THUMBGATE_SESSION_AGENT = 'aip-corrupt-probe';
  process.env.THUMBGATE_STRICT_ENFORCEMENT = '1';
  assert.equal(evaluateAgentIdentityLifecycleGate('Bash', { command: 'ls' }), null);
});

test('identity security report flags observed-but-unregistered agents as shadow', () => {
  recordObservedAgent('aip-shadow-report-1');
  const report = buildAgentIdentitySecurityReport(
    loadAgentRegistry(),
    loadObservedAgents().map((row) => row.id),
  );
  assert.ok(report.shadowAgents.includes('aip-shadow-report-1'));
});
