'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  buildAgentRegister,
  updateAgentRegisterEntry,
  resolveDefaultOwner,
  UNREGISTERED_AGENT_FLAG,
} = require('../scripts/agent-action-inventory');
const { generateDashboard } = require('../scripts/dashboard');

const CLI_PATH = path.join(__dirname, '..', 'bin', 'cli.js');

function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-agent-reg-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeJsonl(dir, name, rows) {
  fs.writeFileSync(
    path.join(dir, name),
    rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''),
  );
}

test('buildAgentRegister lists 30d agents, models, MCP servers, hook sources and flags unregistered callers', (t) => {
  const dir = makeTempDir(t);
  const now = '2026-11-12T18:00:00.000Z';
  const twoDaysAgo = '2026-11-10T12:00:00.000Z';
  const oneHourAgo = '2026-11-12T17:00:00.000Z';
  const fortyDaysAgo = '2026-10-01T10:00:00.000Z';

  writeJsonl(dir, 'agent-registry.jsonl', [
    { id: 'claude-code', registeredAt: twoDaysAgo, lastSeenAt: twoDaysAgo, source: 'pre-tool-use', toolCalls: 1, metadata: { lifecycleStatus: 'retired' } },
    { id: 'claude-code', registeredAt: twoDaysAgo, lastSeenAt: oneHourAgo, source: 'pre-tool-use', toolCalls: 2, metadata: { lifecycleStatus: 'active' } },
  ]);
  const allowlistsPath = path.join(dir, 'mcp-allowlists.json');
  fs.writeFileSync(allowlistsPath, JSON.stringify({ version: 3, agents: ['ci-allowlisted-agent'], profiles: { default: ['gate_check', 'capture_feedback'] } }));

  writeJsonl(dir, 'audit-trail.jsonl', [
    { id: 'a1', timestamp: twoDaysAgo, agentId: 'claude-code', toolName: 'gate_check', model: 'claude-sonnet-4-5', decision: 'allow', source: 'gates-engine' },
    { id: 'a2', timestamp: oneHourAgo, agentId: 'claude-code', toolName: 'Bash', model: 'claude-sonnet-4-5', decision: 'deny', source: 'secret-guard' },
    { id: 'a3', timestamp: oneHourAgo, agentId: 'ci-allowlisted-agent', toolName: 'capture_feedback', decision: 'allow', source: 'mcp-policy' },
    { id: 'a4', timestamp: oneHourAgo, agentId: 'rogue-shadow-bot', toolName: 'mcp__unlisted_srv__gate_check', model: 'gpt-shadow-mini', decision: 'warn', source: 'gates-engine' },
    { id: 'a_unattr', timestamp: oneHourAgo, toolName: 'Bash', decision: 'allow', source: 'gates-engine' },
    { id: 'a5', timestamp: fortyDaysAgo, agentId: 'ancient-agent', toolName: 'Bash', model: 'old-model', decision: 'allow', source: 'legacy-hook' },
  ]);
  writeJsonl(dir, 'tool-kpi.jsonl', [
    { id: 'k1', timestamp: oneHourAgo, agentId: 'claude-code', toolName: 'gate_check', serverName: 'thumbgate', success: true, metadata: { model: 'claude-sonnet-4-5', hookSource: 'mcp-stdio' } },
  ]);

  const report = buildAgentRegister({ dataDir: dir, allowlistsPath, now, windowDays: 30 });
  const expectedDefaultOwner = resolveDefaultOwner();
  assert.equal(report.defaultOwner, expectedDefaultOwner);
  assert.equal(report.summary.totalAgents, 3);
  assert.equal(report.summary.registeredAgents, 2);
  assert.equal(report.summary.unregisteredAgents, 1);
  assert.equal(report.summary.unregisteredMcpServers, 1);
  assert.equal(report.summary.unattributedCalls, 1);
  const claude = report.agents.find((a) => a.id === 'claude-code');
  assert.ok(claude);
  assert.equal(claude.registered, true);
  assert.equal(claude.status, 'registered');
  assert.equal(claude.flag, null);
  assert.equal(claude.callCount, 3);
  assert.equal(claude.firstSeen, twoDaysAgo);
  assert.equal(claude.lastSeen, oneHourAgo);
  assert.equal(claude.owner, expectedDefaultOwner);

  const allowlisted = report.agents.find((a) => a.id === 'ci-allowlisted-agent');
  assert.ok(allowlisted);
  assert.equal(allowlisted.registered, true);
  assert.equal(allowlisted.status, 'registered');

  const shadow = report.agents.find((a) => a.id === 'rogue-shadow-bot');
  assert.ok(shadow);
  assert.equal(shadow.registered, false);
  assert.equal(shadow.status, UNREGISTERED_AGENT_FLAG);
  assert.equal(shadow.flag, UNREGISTERED_AGENT_FLAG);
  assert.equal(shadow.callCount, 1);

  assert.equal(report.agents.some((a) => a.id === 'ancient-agent'), false);

  const modelIds = report.models.map((m) => m.id).sort();
  assert.deepEqual(modelIds, ['claude-sonnet-4-5', 'gpt-shadow-mini']);

  const unlistedSrv = report.mcpServers.find((s) => s.id === 'unlisted_srv');
  assert.ok(unlistedSrv);
  assert.equal(unlistedSrv.registered, false);
  assert.equal(unlistedSrv.status, UNREGISTERED_AGENT_FLAG);

  const tgSrv = report.mcpServers.find((s) => s.id === 'thumbgate');
  assert.ok(tgSrv);
  assert.equal(tgSrv.registered, true);

  const hookIds = report.hookSources.map((h) => h.id).sort();
  assert.deepEqual(hookIds, ['gates-engine', 'mcp-policy', 'mcp-stdio', 'pre-tool-use', 'secret-guard']);

  // Editable owner persists and overrides default machine user
  updateAgentRegisterEntry({ dataDir: dir, id: 'claude-code', owner: 'secops-lead' });
  updateAgentRegisterEntry({ dataDir: dir, id: 'rogue-shadow-bot', owner: 'sandbox-owner', registered: true });

  const updated = buildAgentRegister({ dataDir: dir, allowlistsPath, now, windowDays: 30 });
  assert.equal(updated.agents.find((a) => a.id === 'claude-code').owner, 'secops-lead');
  const promoted = updated.agents.find((a) => a.id === 'rogue-shadow-bot');
  assert.equal(promoted.owner, 'sandbox-owner');
  assert.equal(promoted.registered, true);
  assert.equal(promoted.status, 'registered');
});

test('CLI `thumbgate agents --json` outputs register JSON and supports --owner / --register', (t) => {
  const dir = makeTempDir(t);
  const ts = new Date().toISOString();
  writeJsonl(dir, 'audit-trail.jsonl', [
    { id: 'cli_a1', timestamp: ts, agentId: 'mystery-cli-agent', toolName: 'Bash', decision: 'allow', source: 'gates-engine' },
  ]);
  const before = JSON.parse(execFileSync(process.execPath, [CLI_PATH, 'agents', '--json', `--data-dir=${dir}`], { encoding: 'utf8' }));
  assert.equal(before.summary.totalAgents, 1);
  assert.equal(before.agents[0].id, 'mystery-cli-agent');
  assert.equal(before.agents[0].status, 'unregistered agent');

  const after = JSON.parse(execFileSync(
    process.execPath,
    [CLI_PATH, 'agents', '--json', `--data-dir=${dir}`, '--register=mystery-cli-agent', '--owner=mystery-cli-agent=alice'],
    { encoding: 'utf8' },
  ));
  assert.equal(after.agents[0].owner, 'alice');
  assert.equal(after.agents[0].registered, true);
  const helpOut = execFileSync(process.execPath, [CLI_PATH, 'agents', '--help'], { encoding: 'utf8' });
  assert.match(helpOut, /Usage: npx thumbgate agents/);
  assert.equal(after.agents[0].status, 'registered');
});

test('generateDashboard exposes agentRegister card payload and dashboard HTML renders #agentRegisterCard', (t) => {
  const dir = makeTempDir(t);
  writeJsonl(dir, 'audit-trail.jsonl', [
    { id: 'dash_a1', timestamp: new Date().toISOString(), agentId: 'unregistered-runner', toolName: 'Bash', decision: 'allow', source: 'gates-engine' },
  ]);
  const dashboard = generateDashboard(dir);
  assert.ok(dashboard.agentRegister);
  assert.equal(dashboard.agentRegister.summary.unregisteredAgents, 1);
  assert.equal(dashboard.agentRegister.agents[0].status, 'unregistered agent');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.html'), 'utf8');
  assert.match(html, /id="agentRegisterCard"/);
  assert.match(html, /function renderAgentRegister\(reg\)/);
});
