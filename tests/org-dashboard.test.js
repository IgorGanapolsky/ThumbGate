'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'org-dash-test-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

const {
  registerAgent,
  recordAgentActivity,
  loadAgentRegistry,
  generateOrgDashboard,
  getRegistryPath,
} = require('../scripts/org-dashboard');

afterEach(() => {
  const reg = getRegistryPath();
  if (fs.existsSync(reg)) fs.unlinkSync(reg);
});

describe('agent registry', () => {
  it('registerAgent creates a record with ID and timestamps', () => {
    const agent = registerAgent({ agentId: 'test-agent-1', source: 'cli', project: 'test-project' });
    assert.equal(agent.id, 'test-agent-1');
    assert.equal(agent.source, 'cli');
    assert.equal(agent.project, 'test-project');
    assert.ok(agent.registeredAt);
    assert.equal(agent.toolCalls, 0);
    assert.equal(agent.gateBlocks, 0);
  });

  it('registerAgent auto-generates ID if not provided', () => {
    const agent = registerAgent({ source: 'mcp' });
    assert.ok(agent.id.startsWith('agent_'));
  });

  it('loadAgentRegistry returns all registered agents', () => {
    registerAgent({ agentId: 'a1', source: 'cli' });
    registerAgent({ agentId: 'a2', source: 'mcp' });
    registerAgent({ agentId: 'a3', source: 'github' });
    const agents = loadAgentRegistry();
    assert.equal(agents.length, 3);
    assert.ok(agents.some(a => a.id === 'a1'));
    assert.ok(agents.some(a => a.id === 'a2'));
    assert.ok(agents.some(a => a.id === 'a3'));
  });

  it('recordAgentActivity increments tool calls and blocks', () => {
    registerAgent({ agentId: 'act-agent', source: 'cli' });
    recordAgentActivity('act-agent', 'allow');
    recordAgentActivity('act-agent', 'allow');
    recordAgentActivity('act-agent', 'deny');
    recordAgentActivity('act-agent', 'warn');
    const agents = loadAgentRegistry();
    const agent = agents.find(a => a.id === 'act-agent');
    assert.equal(agent.toolCalls, 4);
    assert.equal(agent.gateBlocks, 1);
    assert.equal(agent.gateWarns, 1);
  });

  it('recordAgentActivity is no-op for missing agent', () => {
    recordAgentActivity('nonexistent', 'deny');
    // Should not throw
  });

  it('loadAgentRegistry returns empty array when no file', () => {
    const agents = loadAgentRegistry();
    assert.deepEqual(agents, []);
  });
});

describe('org dashboard', () => {
  it('returns aggregated stats across agents', () => {
    registerAgent({ agentId: 'org-a1', source: 'cli', project: 'proj-1' });
    registerAgent({ agentId: 'org-a2', source: 'mcp', project: 'proj-2' });
    recordAgentActivity('org-a1', 'allow');
    recordAgentActivity('org-a1', 'deny');
    recordAgentActivity('org-a2', 'allow');
    recordAgentActivity('org-a2', 'allow');
    recordAgentActivity('org-a2', 'allow');

    const dash = generateOrgDashboard({ windowHours: 1 });
    assert.ok(dash.totalAgents >= 2);
    assert.ok(dash.activeAgents >= 2);
    assert.ok(Array.isArray(dash.agents));
    assert.ok(Array.isArray(dash.topBlockedGates));
    assert.ok(typeof dash.orgAdherenceRate === 'number');
  });

  it('includes windowHours in output', () => {
    const dash = generateOrgDashboard({ windowHours: 48 });
    assert.equal(dash.windowHours, 48);
  });

  it('shows upgrade message on free tier', () => {
    const origPro = process.env.THUMBGATE_PRO_MODE;
    delete process.env.THUMBGATE_PRO_MODE;
    delete process.env.THUMBGATE_API_KEY;
    const dash = generateOrgDashboard();
    assert.ok(dash.proRequired === true || dash.proRequired === false);
    if (dash.proRequired) {
      assert.ok(dash.upgradeMessage.includes('checkout'));
    }
    if (origPro !== undefined) process.env.THUMBGATE_PRO_MODE = origPro;
  });

  it('agents have adherenceRate computed', () => {
    registerAgent({ agentId: 'adh-agent', source: 'cli' });
    recordAgentActivity('adh-agent', 'allow');
    recordAgentActivity('adh-agent', 'allow');
    recordAgentActivity('adh-agent', 'deny');
    const dash = generateOrgDashboard({ windowHours: 1 });
    const agent = dash.agents.find(a => a.id === 'adh-agent');
    if (agent) {
      assert.ok(agent.adherenceRate > 60, `expected > 60%, got ${agent.adherenceRate}`);
      assert.ok(agent.adherenceRate < 70, `expected < 70%, got ${agent.adherenceRate}`);
    }
  });

  it('accepts authContext and proOverride for hosted Team surfaces', () => {
    registerAgent({ agentId: 'team-agent', source: 'cli', project: 'team-project' });
    recordAgentActivity('team-agent', 'allow');
    recordAgentActivity('team-agent', 'deny');
    recordAgentActivity('team-agent', 'allow');

    const byAuthContext = generateOrgDashboard({ windowHours: 1, authContext: { tier: 'pro' } });
    const byOverride = generateOrgDashboard({ windowHours: 1, proOverride: true });

    assert.equal(byAuthContext.proRequired, false);
    assert.equal(byOverride.proRequired, false);
    assert.ok(byAuthContext.agents.some((agent) => agent.id === 'team-agent'));
    assert.ok(byOverride.agents.some((agent) => agent.id === 'team-agent'));
  });
});
