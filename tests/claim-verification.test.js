const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  trackAction,
  hasAction,
  listSessionActions,
  clearSessionActions,
  loadClaimGates,
  registerClaimGate,
  verifyClaimEvidence,
  SESSION_ACTIONS_PATH,
  CLAIM_GATES_PATH,
} = require('../scripts/gates-engine');

// ---------------------------------------------------------------------------
// Helpers — save and restore state between tests
// ---------------------------------------------------------------------------
function backupAndClear() {
  const backups = {};
  for (const p of [SESSION_ACTIONS_PATH, CLAIM_GATES_PATH]) {
    if (fs.existsSync(p)) {
      backups[p] = fs.readFileSync(p, 'utf8');
    }
  }
  clearSessionActions();
  // Write empty claim gates so tests start clean
  fs.mkdirSync(path.dirname(CLAIM_GATES_PATH), { recursive: true });
  fs.writeFileSync(CLAIM_GATES_PATH, JSON.stringify({ claims: [] }));
  return backups;
}

function restore(backups) {
  clearSessionActions();
  for (const [p, content] of Object.entries(backups)) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  // Clean up test files that didn't exist before
  for (const p of [SESSION_ACTIONS_PATH, CLAIM_GATES_PATH]) {
    if (!backups[p] && fs.existsSync(p)) {
      fs.unlinkSync(p);
    }
  }
}

// ---------------------------------------------------------------------------
// Session Action Tracking
// ---------------------------------------------------------------------------

test('trackAction stores an action with timestamp', () => {
  const backups = backupAndClear();
  try {
    const result = trackAction('figma_verified', { nodeId: '1585:106967' });
    assert.ok(result.timestamp, 'action must have a timestamp');
    assert.deepStrictEqual(result.metadata, { nodeId: '1585:106967' });
  } finally {
    restore(backups);
  }
});

test('hasAction returns true for tracked actions, false for missing', () => {
  const backups = backupAndClear();
  try {
    trackAction('tests_passed');
    assert.ok(hasAction('tests_passed'), 'should find tracked action');
    assert.ok(!hasAction('nonexistent'), 'should not find untracked action');
  } finally {
    restore(backups);
  }
});

test('listSessionActions returns all tracked actions', () => {
  const backups = backupAndClear();
  try {
    trackAction('figma_verified');
    trackAction('tests_passed');
    const actions = listSessionActions();
    assert.ok(actions.figma_verified, 'should contain figma_verified');
    assert.ok(actions.tests_passed, 'should contain tests_passed');
  } finally {
    restore(backups);
  }
});

test('clearSessionActions removes all actions', () => {
  const backups = backupAndClear();
  try {
    trackAction('figma_verified');
    clearSessionActions();
    assert.ok(!hasAction('figma_verified'), 'should be cleared');
    const actions = listSessionActions();
    assert.equal(Object.keys(actions).length, 0, 'should be empty');
  } finally {
    restore(backups);
  }
});

test('expired actions are pruned on load (1 hour TTL)', () => {
  const backups = backupAndClear();
  try {
    // Write an action with an old timestamp directly
    const actions = {
      old_action: { timestamp: Date.now() - (2 * 60 * 60 * 1000), metadata: {} },
      fresh_action: { timestamp: Date.now(), metadata: {} },
    };
    fs.mkdirSync(path.dirname(SESSION_ACTIONS_PATH), { recursive: true });
    fs.writeFileSync(SESSION_ACTIONS_PATH, JSON.stringify(actions));

    assert.ok(!hasAction('old_action'), 'expired action should be pruned');
    assert.ok(hasAction('fresh_action'), 'fresh action should remain');
  } finally {
    restore(backups);
  }
});

// ---------------------------------------------------------------------------
// Claim Verification
// ---------------------------------------------------------------------------

test('verifyClaimEvidence returns verified:true when all evidence present', () => {
  const backups = backupAndClear();
  try {
    // Register a claim gate
    registerClaimGate('match.*figma', ['figma_verified'], 'Must verify Figma first');
    // Track the required action
    trackAction('figma_verified', { nodeId: '1585:106967' });
    // Verify the claim
    const result = verifyClaimEvidence('colors match Figma design');
    assert.ok(result.verified, 'should be verified when evidence present');
    assert.equal(result.checks.length, 1);
    assert.ok(result.checks[0].passed);
    assert.equal(result.checks[0].missing.length, 0);
  } finally {
    restore(backups);
  }
});

test('verifyClaimEvidence returns verified:false with missing actions', () => {
  const backups = backupAndClear();
  try {
    registerClaimGate('match.*figma', ['figma_verified'], 'Must verify Figma first');
    // Do NOT track figma_verified
    const result = verifyClaimEvidence('This matches the Figma design');
    assert.ok(!result.verified, 'should fail without evidence');
    assert.equal(result.checks.length, 1);
    assert.ok(!result.checks[0].passed);
    assert.deepStrictEqual(result.checks[0].missing, ['figma_verified']);
    assert.equal(result.checks[0].message, 'Must verify Figma first');
  } finally {
    restore(backups);
  }
});

test('verifyClaimEvidence handles multiple required actions', () => {
  const backups = backupAndClear();
  try {
    registerClaimGate('ready to merge', ['tests_passed', 'pr_threads_checked'], 'PR not ready');
    trackAction('tests_passed');
    // Missing pr_threads_checked
    const result = verifyClaimEvidence('This PR is ready to merge');
    assert.ok(!result.verified);
    assert.deepStrictEqual(result.checks[0].missing, ['pr_threads_checked']);
  } finally {
    restore(backups);
  }
});

test('verifyClaimEvidence passes when no claim gates match', () => {
  const backups = backupAndClear();
  try {
    registerClaimGate('match.*figma', ['figma_verified'], 'Must verify Figma');
    // Claim that doesn't match any gate pattern
    const result = verifyClaimEvidence('refactored the helper function');
    assert.ok(result.verified, 'should pass when no gates match');
    assert.equal(result.checks.length, 0);
  } finally {
    restore(backups);
  }
});

test('verifyClaimEvidence is case-insensitive', () => {
  const backups = backupAndClear();
  try {
    registerClaimGate('match.*figma', ['figma_verified'], 'Must verify Figma');
    const result = verifyClaimEvidence('Colors MATCH the FIGMA design');
    assert.ok(!result.verified, 'should match case-insensitively');
  } finally {
    restore(backups);
  }
});

// ---------------------------------------------------------------------------
// Claim Gate Registration
// ---------------------------------------------------------------------------

test('registerClaimGate creates new entry', () => {
  const backups = backupAndClear();
  try {
    registerClaimGate('tests? pass', ['tests_passed'], 'Run tests first');
    const config = loadClaimGates();
    assert.ok(config.claims.length >= 1);
    const gate = config.claims.find(c => c.pattern === 'tests? pass');
    assert.ok(gate, 'should find registered gate');
    assert.deepStrictEqual(gate.requiredActions, ['tests_passed']);
  } finally {
    restore(backups);
  }
});

test('registerClaimGate updates existing entry with same pattern', () => {
  const backups = backupAndClear();
  try {
    registerClaimGate('tests? pass', ['tests_passed'], 'v1');
    registerClaimGate('tests? pass', ['tests_passed', 'lint_passed'], 'v2');
    const config = loadClaimGates();
    const gates = config.claims.filter(c => c.pattern === 'tests? pass');
    assert.equal(gates.length, 1, 'should not duplicate');
    assert.deepStrictEqual(gates[0].requiredActions, ['tests_passed', 'lint_passed']);
    assert.equal(gates[0].message, 'v2');
  } finally {
    restore(backups);
  }
});

// ---------------------------------------------------------------------------
// Tool Registry Validation
// ---------------------------------------------------------------------------

test('new tools are registered in tool-registry', () => {
  const { TOOLS } = require('../scripts/tool-registry');
  const toolNames = TOOLS.map(t => t.name);
  assert.ok(toolNames.includes('track_action'), 'track_action must be registered');
  assert.ok(toolNames.includes('verify_claim'), 'verify_claim must be registered');
  assert.ok(toolNames.includes('register_claim_gate'), 'register_claim_gate must be registered');
});

test('new tools have valid inputSchema', () => {
  const { TOOLS } = require('../scripts/tool-registry');
  for (const name of ['track_action', 'verify_claim', 'register_claim_gate']) {
    const tool = TOOLS.find(t => t.name === name);
    assert.ok(tool, `${name} must exist`);
    assert.equal(tool.inputSchema.type, 'object', `${name} schema type must be object`);
    assert.ok(tool.inputSchema.required, `${name} must have required fields`);
    assert.ok(tool.inputSchema.required.length > 0, `${name} must require at least one field`);
  }
});

// ---------------------------------------------------------------------------
// Default claim-verification.json config
// ---------------------------------------------------------------------------

test('default claim-verification.json loads with expected gates', () => {
  const configPath = path.join(__dirname, '..', 'config', 'gates', 'claim-verification.json');
  assert.ok(fs.existsSync(configPath), 'claim-verification.json must exist');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.ok(Array.isArray(config.claims), 'must have claims array');
  assert.ok(config.claims.length >= 4, 'must have at least 4 default claim gates');

  const patterns = config.claims.map(c => c.pattern);
  assert.ok(patterns.some(p => p.includes('figma')), 'must have Figma verification gate');
  assert.ok(patterns.some(p => p.includes('test')), 'must have test verification gate');
  assert.ok(patterns.some(p => p.includes('merge')), 'must have merge readiness gate');
  assert.ok(patterns.some(p => p.includes('device')), 'must have device verification gate');
});
