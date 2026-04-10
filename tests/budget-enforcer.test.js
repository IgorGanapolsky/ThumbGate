#!/usr/bin/env node
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-budget-home-'));
process.env.THUMBGATE_BUDGET_STATE_PATH = path.join(TEST_HOME, 'budget-state.json');

const {
  evaluateBudget,
  getBudgetStatus,
  loadBudgetConfig,
  loadBudgetState,
  saveBudgetState,
  resetBudget,
  BUDGET_STATE_PATH,
} = require('../scripts/budget-enforcer');

// Clean state before each test
beforeEach(() => {
  try { fs.unlinkSync(BUDGET_STATE_PATH); } catch { /* noop */ }
});

after(() => {
  delete process.env.THUMBGATE_BUDGET_STATE_PATH;
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('budget-enforcer', () => {
  it('exports all expected functions', () => {
    assert.equal(typeof evaluateBudget, 'function');
    assert.equal(typeof getBudgetStatus, 'function');
    assert.equal(typeof loadBudgetConfig, 'function');
    assert.equal(typeof loadBudgetState, 'function');
    assert.equal(typeof saveBudgetState, 'function');
    assert.equal(typeof resetBudget, 'function');
  });

  it('loadBudgetConfig returns defaults when no config file exists', () => {
    const config = loadBudgetConfig();
    assert.ok(config.max_actions > 0);
    assert.ok(config.max_time_minutes > 0);
    assert.ok(config.profiles);
    assert.ok(config.profiles.strict);
    assert.ok(config.profiles.guided);
    assert.ok(config.profiles.autonomous);
  });

  it('evaluateBudget returns null when within budget', () => {
    resetBudget();
    const result = evaluateBudget('Bash', 'ls -la');
    assert.equal(result, null);
  });

  it('evaluateBudget increments action_count on each call', () => {
    resetBudget();
    evaluateBudget('Bash', 'ls');
    evaluateBudget('Bash', 'pwd');
    evaluateBudget('Edit', 'file.js');
    const state = loadBudgetState();
    assert.equal(state.action_count, 3);
  });

  it('evaluateBudget denies when max_actions exceeded', () => {
    resetBudget();
    // Set state to just below limit
    const state = loadBudgetState();
    state.action_count = 1999; // Default max is 2000
    saveBudgetState(state);

    // This should be action 2000 — still OK
    const ok = evaluateBudget('Bash', 'ls');
    assert.equal(ok, null);

    // This should be action 2001 — DENIED
    const denied = evaluateBudget('Bash', 'ls');
    assert.ok(denied);
    assert.equal(denied.decision, 'deny');
    assert.equal(denied.gate, 'budget-action-limit');
    assert.match(denied.message, /Budget exceeded/);
  });

  it('evaluateBudget denies when max_time_minutes exceeded', () => {
    // Set session start to 11 hours ago (default limit is 600 min = 10 hours)
    const state = {
      action_count: 0,
      session_start: new Date(Date.now() - 11 * 60 * 60 * 1000).toISOString(),
    };
    saveBudgetState(state);

    const result = evaluateBudget('Bash', 'ls');
    assert.ok(result);
    assert.equal(result.decision, 'deny');
    assert.equal(result.gate, 'budget-time-limit');
    assert.match(result.message, /Budget exceeded/);
  });

  it('resetBudget clears action count and sets new session start', () => {
    saveBudgetState({ action_count: 500, session_start: '2020-01-01T00:00:00Z' });
    const fresh = resetBudget();
    assert.equal(fresh.action_count, 0);
    assert.ok(new Date(fresh.session_start).getTime() > Date.now() - 5000);
  });

  it('getBudgetStatus returns correct percentages', () => {
    resetBudget();
    saveBudgetState({ action_count: 1000, session_start: new Date().toISOString() });
    const status = getBudgetStatus();
    assert.equal(status.action_count, 1000);
    assert.equal(status.max_actions, 2000);
    assert.equal(status.actions_remaining, 1000);
    assert.equal(status.actions_pct, 50);
    assert.ok(status.elapsed_minutes >= 0);
    assert.equal(status.profile, 'guided');
  });

  it('profiles override max_actions and max_time_minutes', () => {
    const orig = process.env.THUMBGATE_BUDGET_PROFILE;
    process.env.THUMBGATE_BUDGET_PROFILE = 'strict';
    try {
      const config = loadBudgetConfig();
      assert.equal(config.max_actions, 500);
      assert.equal(config.max_time_minutes, 150);
    } finally {
      if (orig) process.env.THUMBGATE_BUDGET_PROFILE = orig;
      else delete process.env.THUMBGATE_BUDGET_PROFILE;
    }
  });

  it('env vars override config file and profiles', () => {
    const origA = process.env.THUMBGATE_MAX_ACTIONS;
    const origT = process.env.THUMBGATE_MAX_TIME_MINUTES;
    process.env.THUMBGATE_MAX_ACTIONS = '100';
    process.env.THUMBGATE_MAX_TIME_MINUTES = '30';
    try {
      const config = loadBudgetConfig();
      assert.equal(config.max_actions, 100);
      assert.equal(config.max_time_minutes, 30);
    } finally {
      if (origA) process.env.THUMBGATE_MAX_ACTIONS = origA;
      else delete process.env.THUMBGATE_MAX_ACTIONS;
      if (origT) process.env.THUMBGATE_MAX_TIME_MINUTES = origT;
      else delete process.env.THUMBGATE_MAX_TIME_MINUTES;
    }
  });
});

describe('self-protection gates in default.json', () => {
  it('default.json contains self-protection gates', () => {
    const configPath = path.join(__dirname, '..', 'config', 'gates', 'default.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const selfProtectGates = config.gates.filter((g) => g.id.startsWith('self-protect'));
    assert.ok(selfProtectGates.length >= 4, `Expected >= 4 self-protection gates, got ${selfProtectGates.length}`);

    const ids = selfProtectGates.map((g) => g.id);
    assert.ok(ids.includes('self-protect-config'));
    assert.ok(ids.includes('self-protect-kill'));
    assert.ok(ids.includes('self-protect-env-override'));
    assert.ok(ids.includes('self-protect-hooks-disable'));
  });

  it('all self-protection gates are block action with critical severity', () => {
    const configPath = path.join(__dirname, '..', 'config', 'gates', 'default.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const selfProtectGates = config.gates.filter((g) => g.id.startsWith('self-protect'));
    for (const gate of selfProtectGates) {
      assert.equal(gate.action, 'block', `${gate.id} should be block`);
      assert.equal(gate.severity, 'critical', `${gate.id} should be critical`);
    }
  });
});

describe('compliance tags in default.json', () => {
  it('critical gates have compliance tags', () => {
    const configPath = path.join(__dirname, '..', 'config', 'gates', 'default.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const gatesWithCompliance = config.gates.filter((g) => Array.isArray(g.compliance) && g.compliance.length > 0);
    assert.ok(gatesWithCompliance.length >= 7, `Expected >= 7 gates with compliance tags, got ${gatesWithCompliance.length}`);
  });

  it('compliance tags follow NIST/SOC2/OWASP/CWE format', () => {
    const configPath = path.join(__dirname, '..', 'config', 'gates', 'default.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const validPrefixes = ['NIST-', 'SOC2-', 'OWASP-', 'CWE-'];
    for (const gate of config.gates) {
      if (!gate.compliance) continue;
      for (const tag of gate.compliance) {
        const hasValidPrefix = validPrefixes.some((p) => tag.startsWith(p));
        assert.ok(hasValidPrefix, `${gate.id}: invalid compliance tag "${tag}"`);
      }
    }
  });

  it('self-protection gates have NIST-AC-3 tag', () => {
    const configPath = path.join(__dirname, '..', 'config', 'gates', 'default.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const selfProtectGates = config.gates.filter((g) => g.id.startsWith('self-protect'));
    for (const gate of selfProtectGates) {
      assert.ok(gate.compliance.includes('NIST-AC-3'), `${gate.id} should include NIST-AC-3`);
    }
  });

  it('SQL MCP destructive gates have compliance mappings', () => {
    const configPath = path.join(__dirname, '..', 'config', 'gates', 'default.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const deleteGate = config.gates.find((g) => g.id === 'mcp-sql-delete-block');
    const bulkUpdateGate = config.gates.find((g) => g.id === 'mcp-sql-bulk-update-warn');

    assert.deepEqual(deleteGate.compliance, ['NIST-AC-3', 'SOC2-CC6.1', 'CWE-89']);
    assert.deepEqual(bulkUpdateGate.compliance, ['NIST-AC-3', 'CWE-89']);
  });
});
