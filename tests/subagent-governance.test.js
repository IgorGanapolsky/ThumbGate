const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  listRoleTemplates,
  evaluateSubagentRunPlan,
  buildPrSheriffFanout,
  appendSubagentRunLedger,
  loadSubagentRunLedger,
  summarizeSubagentLedger,
} = require('../scripts/subagent-governance');

test('role templates include high-ROI operating roles', () => {
  const roles = listRoleTemplates();
  assert.ok(roles.includes('pr_ci_checker'));
  assert.ok(roles.includes('social_reply_drafter'));
  assert.ok(roles.includes('revenue_ops'));
});

test('PR sheriff fanout builds bounded read-only subagent plans', () => {
  const fanout = buildPrSheriffFanout(1831);
  assert.equal(fanout.pattern, 'fan_out_with_wait');
  assert.equal(fanout.plans.length, 4);
  assert.ok(fanout.plans.every((plan) => plan.mcpProfile === 'readonly'));
  assert.ok(fanout.plans.every((plan) => plan.writeScope.length === 0));
});

test('subagent evaluation blocks unknown or ownerless roles', () => {
  const result = evaluateSubagentRunPlan({ role: 'unknown', task: 'x' });
  assert.equal(result.allowed, false);
  assert.match(result.blockers.join('\n'), /Unknown subagent role/);
  assert.match(result.blockers.join('\n'), /owner/);
});

test('subagent evaluation blocks conflicting write scopes', () => {
  const result = evaluateSubagentRunPlan({
    role: 'ci_debugger',
    owner: 'codex',
    task: 'fix failing tests',
    writeScope: ['scripts/foo.js'],
    activeRuns: [{ runId: 'other', role: 'ci_debugger', status: 'running', writeScope: ['scripts'] }],
  });
  assert.equal(result.allowed, false);
  assert.match(result.blockers.join('\n'), /Write scope conflicts/);
});

test('agent-to-agent messaging is opt-in only', () => {
  const blocked = evaluateSubagentRunPlan({
    role: 'ci_debugger',
    owner: 'codex',
    task: 'fix failing tests',
    agentToAgentMessaging: true,
  });
  assert.equal(blocked.allowed, false);
  const allowed = evaluateSubagentRunPlan({
    role: 'agent_team_experimental',
    owner: 'codex',
    task: 'run experimental team',
    agentToAgentMessaging: true,
  });
  assert.equal(allowed.allowed, true);
});

test('subagent run ledger writes and summarizes runs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-subagents-'));
  appendSubagentRunLedger({ runId: 'a', role: 'pr_ci_checker', status: 'completed' }, { feedbackDir: dir });
  appendSubagentRunLedger({ runId: 'b', role: 'ci_debugger', status: 'running', timestamp: '2026-05-08T00:00:00.000Z' }, { feedbackDir: dir });
  const entries = loadSubagentRunLedger({ feedbackDir: dir });
  const summary = summarizeSubagentLedger(entries, { now: '2026-05-08T02:00:00.000Z', staleAfterMinutes: 60 });
  assert.equal(summary.totalRuns, 2);
  assert.equal(summary.byStatus.completed, 1);
  assert.equal(summary.staleRuns.length, 1);
});
