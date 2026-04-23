const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  trackAction,
  hasAction,
  listSessionActions,
  clearSessionActions,
  loadClaimGates,
  registerClaimGate,
  verifyClaimEvidence,
  SESSION_ACTIONS_PATH,
  CUSTOM_CLAIM_GATES_PATH,
  DEFAULT_CLAIM_GATES_PATH,
  SESSION_ACTION_TTL_MS,
} = require('../scripts/gates-engine');

function readIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
}

function backupRuntimeState() {
  return {
    sessionActions: readIfExists(SESSION_ACTIONS_PATH),
    customClaimGates: readIfExists(CUSTOM_CLAIM_GATES_PATH),
  };
}

function restoreRuntimeState(backups) {
  const restoreOne = (filePath, content) => {
    if (content === null) {
      fs.rmSync(filePath, { force: true });
      return;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  };

  restoreOne(SESSION_ACTIONS_PATH, backups.sessionActions);
  restoreOne(CUSTOM_CLAIM_GATES_PATH, backups.customClaimGates);
}

function resetRuntimeState() {
  clearSessionActions();
  fs.rmSync(CUSTOM_CLAIM_GATES_PATH, { force: true });
}

test('trackAction records metadata for the current session', () => {
  const backups = backupRuntimeState();
  try {
    resetRuntimeState();
    const entry = trackAction('figma_verified', { nodeId: '1585:106967' });
    assert.ok(entry.timestamp);
    assert.deepStrictEqual(entry.metadata, { nodeId: '1585:106967' });
    assert.equal(hasAction('figma_verified'), true);
  } finally {
    restoreRuntimeState(backups);
  }
});

test('loadSessionActions prunes expired actions from runtime state', () => {
  const backups = backupRuntimeState();
  try {
    resetRuntimeState();
    fs.mkdirSync(path.dirname(SESSION_ACTIONS_PATH), { recursive: true });
    fs.writeFileSync(SESSION_ACTIONS_PATH, JSON.stringify({
      old_action: { timestamp: Date.now() - SESSION_ACTION_TTL_MS - 1000, metadata: {} },
      fresh_action: { timestamp: Date.now(), metadata: { source: 'test' } },
    }));

    assert.equal(hasAction('old_action'), false);
    assert.equal(hasAction('fresh_action'), true);

    const persisted = JSON.parse(fs.readFileSync(SESSION_ACTIONS_PATH, 'utf8'));
    assert.deepStrictEqual(Object.keys(persisted), ['fresh_action']);
  } finally {
    restoreRuntimeState(backups);
  }
});

test('registerClaimGate writes custom checks to runtime state instead of tracked config', () => {
  const backups = backupRuntimeState();
  try {
    resetRuntimeState();
    const beforeDefault = fs.readFileSync(DEFAULT_CLAIM_GATES_PATH, 'utf8');
    const entry = registerClaimGate('ready to demo', ['tests_passed'], 'Run tests before demo claims');

    assert.equal(entry.pattern, 'ready to demo');
    assert.equal(fs.existsSync(CUSTOM_CLAIM_GATES_PATH), true);
    assert.equal(fs.readFileSync(DEFAULT_CLAIM_GATES_PATH, 'utf8'), beforeDefault);

    const runtimeConfig = JSON.parse(fs.readFileSync(CUSTOM_CLAIM_GATES_PATH, 'utf8'));
    assert.equal(runtimeConfig.claims.length, 1);
    assert.equal(runtimeConfig.claims[0].pattern, 'ready to demo');
  } finally {
    restoreRuntimeState(backups);
  }
});

test('loadClaimGates merges shipped defaults with custom runtime gates', () => {
  const backups = backupRuntimeState();
  try {
    resetRuntimeState();
    registerClaimGate('ready to demo', ['tests_passed'], 'Run tests before demo claims');
    const config = loadClaimGates();
    const patterns = config.claims.map((claim) => claim.pattern);

    assert.ok(patterns.some((pattern) => pattern.includes('figma')));
    assert.ok(patterns.includes('ready to demo'));
  } finally {
    restoreRuntimeState(backups);
  }
});

test('verifyClaimEvidence passes when default evidence has been tracked', () => {
  const backups = backupRuntimeState();
  try {
    resetRuntimeState();
    trackAction('figma_verified', { tool: 'mcp__figma__get_design_context' });
    const result = verifyClaimEvidence('colors match Figma design');
    assert.equal(result.verified, true);
    assert.equal(result.checks.length, 1);
    assert.equal(result.checks[0].passed, true);
  } finally {
    restoreRuntimeState(backups);
  }
});

test('verifyClaimEvidence reports missing actions for matching claims', () => {
  const backups = backupRuntimeState();
  try {
    resetRuntimeState();
    registerClaimGate('ready to demo', ['tests_passed', 'pr_threads_checked'], 'Not ready to demo');
    const result = verifyClaimEvidence('ready to demo');
    assert.equal(result.verified, false);
    assert.deepStrictEqual(result.checks[0].missing, ['tests_passed', 'pr_threads_checked']);
    assert.equal(result.checks[0].message, 'Not ready to demo');
  } finally {
    restoreRuntimeState(backups);
  }
});

test('verifyClaimEvidence ignores non-matching claims', () => {
  const backups = backupRuntimeState();
  try {
    resetRuntimeState();
    const result = verifyClaimEvidence('refactored the helper function');
    assert.equal(result.verified, true);
    assert.deepStrictEqual(result.checks, []);
  } finally {
    restoreRuntimeState(backups);
  }
});

test('default claim verification config ships expected gates', () => {
  const config = JSON.parse(fs.readFileSync(DEFAULT_CLAIM_GATES_PATH, 'utf8'));
  const patterns = config.claims.map((claim) => claim.pattern);
  assert.ok(patterns.some((pattern) => pattern.includes('figma')));
  assert.ok(patterns.some((pattern) => pattern.includes('tests? pass')));
  assert.ok(patterns.some((pattern) => pattern.includes('ready to merge')));
  assert.ok(patterns.some((pattern) => pattern.includes('verified on device')));
});
