const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-sec-'));
process.env.RLHF_FEEDBACK_DIR = tmpDir;

const sec = require('../scripts/agent-security-hardening');

test.after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

// === Credential Attestation ===
test('attestCredential records entry with truncated ID', () => {
  const r = sec.attestCredential({ agentId: 'a1', credentialType: 'api_key', credentialId: 'sk-ant-abc123456789', toolName: 'recall' });
  assert.ok(r.id.startsWith('cred_'));
  assert.ok(r.credentialId.endsWith('***'));
  assert.ok(!r.credentialId.includes('abc123456789'));
  assert.ok(fs.existsSync(sec.getCredLogPath()));
});

test('attestCredential defaults missing fields', () => {
  const r = sec.attestCredential({});
  assert.equal(r.agentId, 'unknown');
  assert.equal(r.credentialType, 'unknown');
});

test('getCredentialAudit aggregates by agent and cred type', () => {
  sec.attestCredential({ agentId: 'a1', credentialType: 'api_key', toolName: 'recall' });
  sec.attestCredential({ agentId: 'a1', credentialType: 'api_key', toolName: 'search_lessons' });
  sec.attestCredential({ agentId: 'a2', credentialType: 'oauth_token', toolName: 'recall' });
  const audit = sec.getCredentialAudit({ periodHours: 1 });
  assert.ok(audit.total >= 3);
  assert.ok(audit.agents.length >= 2);
  const a1 = audit.agents.find((a) => a.agentId === 'a1');
  assert.ok(a1.tools.length >= 2);
  assert.ok(audit.byCredType['api_key'] >= 2);
});

test('getCredLogPath returns correct path', () => { assert.ok(sec.getCredLogPath().endsWith('credential-attestations.jsonl')); });

// === Privilege Escalation Detection ===
test('detectPrivilegeEscalation allows in-scope tool', () => {
  const r = sec.detectPrivilegeEscalation({ agentId: 'a1', toolName: 'recall', mcpProfile: 'essential' });
  assert.equal(r.escalation, false);
});

test('detectPrivilegeEscalation detects out-of-scope tool', () => {
  const r = sec.detectPrivilegeEscalation({ agentId: 'rogue', toolName: 'export_dpo_pairs', mcpProfile: 'locked' });
  assert.equal(r.escalation, true);
  assert.ok(r.event.message.includes('outside'));
  assert.ok(fs.existsSync(sec.getEscalationLogPath()));
});

test('detectPrivilegeEscalation catches locked profile trying essential tools', () => {
  const r = sec.detectPrivilegeEscalation({ agentId: 'a1', toolName: 'capture_feedback', mcpProfile: 'locked' });
  assert.equal(r.escalation, true);
});

test('detectPrivilegeEscalation allows readonly profile reading', () => {
  const r = sec.detectPrivilegeEscalation({ agentId: 'a1', toolName: 'recall', mcpProfile: 'readonly' });
  assert.equal(r.escalation, false);
});

test('detectPrivilegeEscalation handles unknown profile', () => {
  const r = sec.detectPrivilegeEscalation({ agentId: 'a1', toolName: 'recall', mcpProfile: 'custom_unknown' });
  assert.equal(r.escalation, false);
  assert.equal(r.reason, 'unknown profile');
});

test('getEscalationStats returns counts', () => {
  const stats = sec.getEscalationStats({ periodHours: 1 });
  assert.ok(stats.total >= 2);
  assert.ok(stats.byAgent['rogue'] >= 1);
});

test('getEscalationLogPath returns correct path', () => { assert.ok(sec.getEscalationLogPath().endsWith('escalation-events.jsonl')); });

test('PROFILE_ALLOWLISTS has 4 profiles', () => {
  assert.ok(sec.PROFILE_ALLOWLISTS.essential);
  assert.ok(sec.PROFILE_ALLOWLISTS.readonly);
  assert.ok(sec.PROFILE_ALLOWLISTS.locked);
  assert.ok(sec.PROFILE_ALLOWLISTS.commerce);
});

// === Dependency Attestation ===
test('attestDependency allows safe package', () => {
  const r = sec.attestDependency({ packageName: 'express', version: '4.18.2', agentId: 'a1' });
  assert.equal(r.allowed, true);
  assert.equal(r.findings.length, 0);
});

test('attestDependency blocks known-compromised package', () => {
  const r = sec.attestDependency({ packageName: 'event-stream', version: '3.3.6', agentId: 'a1' });
  assert.equal(r.allowed, false);
  assert.ok(r.findings.some((f) => f.rule === 'blocked_package'));
});

test('attestDependency warns on unpinned version', () => {
  const r = sec.attestDependency({ packageName: 'lodash', version: '^4.17.0' });
  assert.ok(r.findings.some((f) => f.rule === 'unpinned_version'));
});

test('attestDependency detects suspicious path', () => {
  const r = sec.attestDependency({ packageName: '../malicious' });
  assert.equal(r.allowed, false);
  assert.ok(r.findings.some((f) => f.rule === 'suspicious_path'));
});

test('attestDependency identifies trusted scopes', () => {
  const r = sec.attestDependency({ packageName: '@anthropic-ai/sdk', version: '1.0.0' });
  assert.equal(r.isTrustedScope, true);
  assert.equal(r.allowed, true);
});

test('attestDependency logs to attestation file', () => {
  assert.ok(fs.existsSync(sec.getDepLogPath()));
});

test('getDepAttestationStats returns counts', () => {
  const stats = sec.getDepAttestationStats({ periodHours: 1 });
  assert.ok(stats.total >= 3);
  assert.ok(stats.blocked >= 1);
  assert.ok(stats.allowed >= 1);
});

test('getDepLogPath returns correct path', () => { assert.ok(sec.getDepLogPath().endsWith('dependency-attestations.jsonl')); });

test('BLOCKED_PACKAGES includes known supply chain attacks', () => {
  assert.ok(sec.BLOCKED_PACKAGES.has('event-stream'));
  assert.ok(sec.BLOCKED_PACKAGES.has('ua-parser-js'));
});

test('TRUSTED_SCOPES includes anthropic', () => {
  assert.ok(sec.TRUSTED_SCOPES.has('@anthropic-ai'));
});
