'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  ACTION_TYPES,
  PRESETS,
  CONFIG_PATH,
  normalizeAction,
  evaluateAction,
  createAuditEntry,
  evaluateBatch,
  loadConfig,
  attachExecutionSurface,
} = require('../scripts/computer-use-firewall');

// ---------------------------------------------------------------------------
// normalizeAction
// ---------------------------------------------------------------------------

test('normalizeAction converts raw browser.open action correctly', () => {
  const raw = { type: 'browser.open', url: 'https://example.com' };
  const result = normalizeAction(raw);
  assert.equal(result.type, 'browser.open');
  assert.equal(result.category, 'browser');
  assert.equal(result.riskLevel, 'low');
  assert.equal(result.target, 'https://example.com');
  assert.ok(result.timestamp);
});

test('normalizeAction converts raw shell.exec action correctly', () => {
  const raw = { type: 'shell.exec', command: 'ls -la' };
  const result = normalizeAction(raw);
  assert.equal(result.type, 'shell.exec');
  assert.equal(result.category, 'shell');
  assert.equal(result.riskLevel, 'high');
  assert.equal(result.target, 'ls -la');
});

test('normalizeAction handles unknown action types (defaults to high risk)', () => {
  const raw = { type: 'screen.capture', target: '/tmp/shot.png' };
  const result = normalizeAction(raw);
  assert.equal(result.type, 'screen.capture');
  assert.equal(result.category, 'unknown');
  assert.equal(result.riskLevel, 'high');
});

test('normalizeAction handles null/undefined input', () => {
  const result = normalizeAction(null);
  assert.equal(result.type, 'unknown');
  assert.equal(result.riskLevel, 'high');
});

// ---------------------------------------------------------------------------
// evaluateAction — safe-readonly preset
// ---------------------------------------------------------------------------

test('evaluateAction allows browser.open in safe-readonly preset', () => {
  const action = normalizeAction({ type: 'browser.open', url: 'https://docs.example.com' });
  const result = evaluateAction(action, 'safe-readonly');
  assert.equal(result.decision, 'allow');
  assert.equal(result.preset, 'safe-readonly');
});

test('evaluateAction denies shell.exec in safe-readonly preset', () => {
  const action = normalizeAction({ type: 'shell.exec', command: 'whoami' });
  const result = evaluateAction(action, 'safe-readonly');
  assert.equal(result.decision, 'deny');
});

test('evaluateAction requires approval for browser.type in safe-readonly preset', () => {
  const action = normalizeAction({ type: 'browser.type', target: 'search box' });
  const result = evaluateAction(action, 'safe-readonly');
  assert.equal(result.decision, 'require-approval');
});

// ---------------------------------------------------------------------------
// evaluateAction — dev-sandbox preset
// ---------------------------------------------------------------------------

test('evaluateAction allows file.write in dev-sandbox preset', () => {
  const action = normalizeAction({ type: 'file.write', path: '/tmp/test.js' });
  const result = evaluateAction(action, 'dev-sandbox');
  assert.equal(result.decision, 'allow');
});

test('evaluateAction denies upload in dev-sandbox preset', () => {
  const action = normalizeAction({ type: 'upload', target: 'https://external.com/upload' });
  const result = evaluateAction(action, 'dev-sandbox');
  assert.equal(result.decision, 'deny');
});

test('evaluateAction requires approval for shell.exec in dev-sandbox preset', () => {
  const action = normalizeAction({ type: 'shell.exec', command: 'npm test' });
  const result = evaluateAction(action, 'dev-sandbox');
  assert.equal(result.decision, 'require-approval');
  assert.equal(result.executionSurface.shouldSandbox, true);
  assert.equal(result.executionSurface.recommendation, 'recommended');
});

// ---------------------------------------------------------------------------
// Dangerous pattern detection
// ---------------------------------------------------------------------------

test('evaluateAction denies shell.exec matching dangerous pattern (rm -rf /)', () => {
  const action = normalizeAction({ type: 'shell.exec', command: 'rm -rf /' });
  const result = evaluateAction(action, 'dev-sandbox');
  assert.equal(result.decision, 'deny');
  assert.ok(result.reason.includes('Dangerous shell pattern'));
  assert.equal(result.executionSurface.shouldSandbox, true);
  assert.equal(result.executionSurface.recommendation, 'required');
});

// ---------------------------------------------------------------------------
// Secret detection
// ---------------------------------------------------------------------------

test('evaluateAction detects secret patterns in file.write content', () => {
  const action = normalizeAction({
    type: 'file.write',
    path: '/tmp/config.env',
    args: { content: 'API_KEY=sk-1234567890abcdef' },
  });
  const result = evaluateAction(action, 'dev-sandbox');
  assert.equal(result.decision, 'deny');
  assert.ok(result.reason.includes('Secret pattern'));
});

// ---------------------------------------------------------------------------
// createAuditEntry
// ---------------------------------------------------------------------------

test('createAuditEntry includes all required fields', () => {
  const action = normalizeAction({ type: 'browser.open', url: 'https://example.com' });
  const decision = { decision: 'allow', reason: 'Allowed by preset', preset: 'dev-sandbox' };
  const entry = createAuditEntry(action, decision);

  assert.ok(entry.timestamp);
  assert.equal(entry.actionType, 'browser.open');
  assert.equal(entry.target, 'https://example.com');
  assert.equal(entry.decision, 'allow');
  assert.equal(entry.reason, 'Allowed by preset');
  assert.equal(entry.preset, 'dev-sandbox');
});

test('attachExecutionSurface leaves low-risk writes on the host path', () => {
  const result = attachExecutionSurface({
    decision: 'allow',
    preset: 'dev-sandbox',
    riskLevel: 'medium',
  }, normalizeAction({ type: 'file.write', path: '/tmp/test.js' }));

  assert.equal(result.executionSurface, undefined);
});

// ---------------------------------------------------------------------------
// evaluateBatch
// ---------------------------------------------------------------------------

test('evaluateBatch returns correct decisions for mixed actions', () => {
  const actions = [
    { type: 'browser.open', url: 'https://example.com' },
    { type: 'shell.exec', command: 'ls' },
    { type: 'upload', target: 'https://evil.com' },
  ];
  const results = evaluateBatch(actions, 'dev-sandbox');

  assert.equal(results.length, 3);
  assert.equal(results[0].decision, 'allow');
  assert.equal(results[1].decision, 'require-approval');
  assert.equal(results[2].decision, 'deny');
});

// ---------------------------------------------------------------------------
// Preset consistency
// ---------------------------------------------------------------------------

test('All presets are consistent (no action in both allow and deny)', () => {
  for (const [name, preset] of Object.entries(PRESETS)) {
    const allowSet = new Set(preset.allow);
    const denySet = new Set(preset.deny);
    for (const action of allowSet) {
      assert.ok(!denySet.has(action), `${name}: ${action} is in both allow and deny`);
    }
    for (const action of preset.requireApproval) {
      assert.ok(!allowSet.has(action), `${name}: ${action} is in both allow and requireApproval`);
      assert.ok(!denySet.has(action), `${name}: ${action} is in both deny and requireApproval`);
    }
  }
});

// ---------------------------------------------------------------------------
// Config file parity
// ---------------------------------------------------------------------------

test('Config file presets match code PRESETS', () => {
  const config = loadConfig();
  assert.ok(config, 'computer-use.json config should exist');

  for (const [name, codePreset] of Object.entries(PRESETS)) {
    const configPreset = config.presets[name];
    assert.ok(configPreset, `Config missing preset: ${name}`);
    assert.deepEqual(configPreset.allowedActions.sort(), [...codePreset.allow].sort());
    assert.deepEqual(configPreset.deniedActions.sort(), [...codePreset.deny].sort());
    assert.deepEqual(configPreset.approvalRequired.sort(), [...codePreset.requireApproval].sort());
  }
});

// ---------------------------------------------------------------------------
// Custom rules
// ---------------------------------------------------------------------------

test('Custom rules override preset defaults', () => {
  const action = normalizeAction({ type: 'browser.open', url: 'https://example.com' });
  const customRules = [{ action: 'browser.open', decision: 'deny', reason: 'Custom block' }];
  const result = evaluateAction(action, 'dev-sandbox', customRules);
  assert.equal(result.decision, 'deny');
  assert.ok(result.reason.includes('Custom'));
});

// ---------------------------------------------------------------------------
// human-approval-for-write preset
// ---------------------------------------------------------------------------

test('human-approval-for-write requires approval for all write actions', () => {
  const writeActions = ['browser.type', 'shell.exec', 'file.write', 'file.delete',
    'clipboard.write', 'download', 'upload', 'message.send'];

  for (const actionType of writeActions) {
    const action = normalizeAction({ type: actionType, target: 'test' });
    const result = evaluateAction(action, 'human-approval-for-write');
    assert.equal(result.decision, 'require-approval',
      `Expected require-approval for ${actionType} in human-approval-for-write, got ${result.decision}`);
  }
});
