'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  recordTaskOutcome,
  readTaskOutcomes,
  calculateTaskOutcomeMetrics,
} = require('../scripts/task-outcomes');
const gatesEngine = require('../scripts/gates-engine');
const { generateDashboard } = require('../scripts/dashboard');

function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-task-cost-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('task-outcomes records tool calls, reported tokens, and computes cost per finished task', (t) => {
  const dir = makeTempDir(t);
  recordTaskOutcome({
    taskId: 'task-finished-with-tokens',
    goal: 'Fix retry loop',
    status: 'completed',
    verification: { performed: true, passed: true, evidence: ['node --test passed'] },
    toolCalls: [
      { name: 'Read', contractValid: true, allowed: true, succeeded: true, attempts: 1, inputTokens: 1200, outputTokens: 300, costUsd: 0.02 },
      { name: 'Edit', contractValid: true, allowed: true, succeeded: true, attempts: 2, totalTokens: 900, costUsd: 0.03 },
    ],
    efficiency: { latencyMs: 1800, costUsd: 0.12, firstAttempt: true },
  }, { feedbackDir: dir });

  recordTaskOutcome({
    taskId: 'task-finished-no-tokens',
    goal: 'Check CLI status',
    status: 'completed',
    verification: { performed: true, passed: true, evidence: ['exit 0'] },
    toolCallCount: 4,
    toolCalls: [
      { name: 'Bash', contractValid: true, allowed: true, succeeded: true, attempts: 1 },
    ],
    efficiency: { latencyMs: 500, costUsd: 0.04, firstAttempt: true },
  }, { feedbackDir: dir });

  recordTaskOutcome({
    taskId: 'task-failed-runaway',
    goal: 'Unfinished loop',
    status: 'failed',
    verification: { performed: false, passed: false, evidence: [] },
    toolCalls: [
      { name: 'Bash', contractValid: true, allowed: true, succeeded: false, attempts: 5 },
    ],
    efficiency: { latencyMs: 9000, costUsd: 0.50, totalTokens: 20000 },
  }, { feedbackDir: dir });

  const outcomes = readTaskOutcomes({ feedbackDir: dir });
  assert.equal(outcomes.length, 3);
  assert.equal(outcomes[0].efficiency.toolCallCount, 3);
  assert.equal(outcomes[0].efficiency.totalTokens, 2400);
  assert.equal(outcomes[1].efficiency.toolCallCount, 4);
  assert.equal(outcomes[1].efficiency.totalTokens, undefined);

  const metrics = calculateTaskOutcomeMetrics(outcomes);
  assert.equal(metrics.efficiency.finishedTaskCount, 2);
  assert.equal(metrics.efficiency.costPerFinishedTaskUsd, 0.08);
  assert.equal(metrics.efficiency.avgToolCallsPerFinishedTask, 3.5);
  assert.equal(metrics.efficiency.avgTokensPerFinishedTask, 2400);
  assert.equal(metrics.efficiency.totalTokens, 22400);
  assert.equal(metrics.efficiency.tokensReportedTasks, 2);

  const dash = generateDashboard(dir);
  assert.ok(dash.taskCost);
  assert.equal(dash.taskCost.finishedTaskCount, 2);
  assert.equal(dash.taskCost.costPerFinishedTaskUsd, 0.08);
  assert.equal(dash.taskCost.avgToolCallsPerFinishedTask, 3.5);
  assert.equal(dash.taskCost.avgTokensPerFinishedTask, 2400);
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.html'), 'utf8');
  assert.match(html, /id="taskCostCard"/);
});

test('task-cost-budget gate is off by default, warn-only on default preset, and warns then blocks on sync and async budgets', async (t) => {
  const dir = makeTempDir(t);
  const origStatePath = gatesEngine.STATE_PATH;
  const origStatsPath = gatesEngine.STATS_PATH;
  const origConstraintsPath = gatesEngine.CONSTRAINTS_PATH;
  gatesEngine.STATE_PATH = path.join(dir, 'gate-state.json');
  gatesEngine.STATS_PATH = path.join(dir, 'gate-stats.json');
  gatesEngine.CONSTRAINTS_PATH = path.join(dir, 'session-constraints.json');
  t.after(() => {
    gatesEngine.STATE_PATH = origStatePath;
    gatesEngine.STATS_PATH = origStatsPath;
    gatesEngine.CONSTRAINTS_PATH = origConstraintsPath;
  });

  // 1. Default config is off-by-default even after many calls.
  for (let i = 0; i < 5; i += 1) {
    const res = gatesEngine.evaluateGates('Read', { file_path: 'README.md', taskId: 'off-default' });
    assert.equal(res, null);
  }

  // 2. Default preset (enabled: true without custom max) stays warn-only.
  const presetCfg = path.join(dir, 'preset-gates.json');
  fs.writeFileSync(presetCfg, JSON.stringify({ version: 1, taskBudget: { enabled: true }, gates: [] }));
  gatesEngine.saveState({ taskBudgets: { 'preset-task': { taskId: 'preset-task', toolCalls: 80, totalTokens: 0, tokensReported: false, warned: true } } });
  const presetWarn = gatesEngine.evaluateGates('Read', { file_path: 'README.md', taskId: 'preset-task' }, presetCfg);
  assert.equal(presetWarn.decision, 'warn');
  assert.equal(presetWarn.gate, 'task-cost-budget');

  // 3. Configured call budget warns on first breach, then blocks on subsequent call (including via CLI run()).
  const callCfg = path.join(dir, 'call-budget-gates.json');
  fs.writeFileSync(callCfg, JSON.stringify({ version: 1, taskBudget: { maxToolCalls: 2 }, gates: [] }));
  assert.equal(gatesEngine.evaluateGates('Read', { file_path: 'a.js', taskId: 'loop-calls' }, callCfg), null);
  assert.equal(gatesEngine.evaluateGates('Read', { file_path: 'b.js', taskId: 'loop-calls' }, callCfg), null);
  const firstCallBreach = gatesEngine.evaluateGates('Read', { file_path: 'c.js', taskId: 'loop-calls' }, callCfg);
  assert.equal(firstCallBreach.decision, 'warn');
  assert.equal(firstCallBreach.gate, 'task-cost-budget');
  const secondCallBreach = gatesEngine.evaluateGates('Read', { file_path: 'd.js', taskId: 'loop-calls' }, callCfg);
  assert.equal(secondCallBreach.decision, 'deny');
  assert.equal(secondCallBreach.gate, 'task-cost-budget');
  assert.equal(gatesEngine.applyEnforcementPosture(secondCallBreach).decision, 'deny');

  // 4. Configured token budget warns first, then blocks when reported tokens exceed budget.
  const tokCfg = path.join(dir, 'tok-budget-gates.json');
  fs.writeFileSync(tokCfg, JSON.stringify({ version: 1, taskBudget: { maxTokens: 5000 }, gates: [] }));
  assert.equal(gatesEngine.evaluateGates('Read', { file_path: 'a.js', taskId: 'loop-tokens', inputTokens: 2000, outputTokens: 1000 }, tokCfg), null);
  const firstTokBreach = gatesEngine.evaluateGates('Read', { file_path: 'b.js', taskId: 'loop-tokens', totalTokens: 2500 }, tokCfg);
  assert.equal(firstTokBreach.decision, 'warn');
  assert.equal(firstTokBreach.totalTokens, 5500);
  const secondTokBreach = gatesEngine.evaluateGates('Read', { file_path: 'c.js', taskId: 'loop-tokens', totalTokens: 500 }, tokCfg);
  assert.equal(secondTokBreach.decision, 'deny');
  assert.equal(secondTokBreach.totalTokens, 6000);
  // 5. Async path (evaluateGatesAsync + runAsync) enforces warn-then-block and exempts remedy tools.
  assert.equal(await gatesEngine.evaluateGatesAsync('Read', { file_path: 'a.js', taskId: 'async-loop', totalTokens: 3000 }, tokCfg), null);
  const asyncWarn = await gatesEngine.evaluateGatesAsync('Read', { file_path: 'b.js', taskId: 'async-loop', totalTokens: 2500 }, tokCfg);
  assert.equal(asyncWarn.decision, 'warn');
  const asyncDeny = await gatesEngine.evaluateGatesAsync('Read', { file_path: 'c.js', taskId: 'async-loop', totalTokens: 500 }, tokCfg);
  assert.equal(asyncDeny.decision, 'deny');
  // Remedy tool (record_task_outcome) is never self-blocked even after budget exhaustion.
  assert.equal(await gatesEngine.evaluateGatesAsync('record_task_outcome', { taskId: 'async-loop' }, tokCfg), null);

  // 6. MCP tool contract validator accepts new token and toolCallCount fields on record_task_outcome.
  const { TOOLS } = require('../scripts/tool-registry');
  const { validateToolContract } = require('../scripts/tool-contract-validator');
  const toolDef = TOOLS.find((x) => x.name === 'record_task_outcome');
  const contractCheck = validateToolContract(toolDef, {
    taskId: 'mcp-t1',
    goal: 'Verify schema',
    status: 'completed',
    toolCallCount: 4,
    totalTokens: 2100,
    verification: { performed: true, passed: true, evidence: ['node --test'] },
    toolCalls: [{ name: 'Read', contractValid: true, allowed: true, succeeded: true, attempts: 1, inputTokens: 1500, outputTokens: 600 }],
    policy: { violations: 0, unsafeEscapes: 0, falseBlocks: 0 },
    efficiency: { latencyMs: 120, costUsd: 0.03, toolCallCount: 4, totalTokens: 2100 },
  });
  assert.equal(contractCheck.valid, true, JSON.stringify(contractCheck.errors || []));
});
