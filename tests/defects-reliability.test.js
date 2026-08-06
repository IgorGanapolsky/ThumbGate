/**
 * Regression & Reliability Test Suite for 6 Production Defects:
 *
 * 1. Multi-slot task scope (taskScopes) does not stomp concurrent task scopes.
 * 2. Multi-slot branch governance (branchGovernances) preserves per-branch governance.
 * 3. Tracked actions (track_action, check_operational_integrity) are exempt from self-blocking.
 * 4. list_human_escalations accepts taskId, escalationId, repoPath, feedbackDir without schema error.
 * 5. Ordinary words like "paid" and "free" in conversation/code do not trigger economic action matches.
 * 6. Read-only inspection tools (view_file, grep_search, get_business_metrics) never fire spend gates.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  setTaskScope,
  getScopeState,
  setBranchGovernance,
  getBranchGovernanceState,
  evaluateGates,
} = require('../scripts/gates-engine');

const {
  detectEconomicAction,
} = require('../scripts/financial-control-plane');

const {
  listEscalations,
  requestEscalation,
} = require('../scripts/human-escalation');

const { TOOLS } = require('../scripts/tool-registry');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-defect-test-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// -----------------------------------------------------------------------------
// Defect 1: Multi-slot task scope
// -----------------------------------------------------------------------------
test('Defect 1: setTaskScope stores scopes per taskId and getScopeState retrieves them without stomping', () => {
  setTaskScope({ taskId: 'task-alpha', allowedPaths: ['src/alpha/*'] });
  setTaskScope({ taskId: 'task-beta', allowedPaths: ['src/beta/*'] });

  const alphaState = getScopeState({ taskId: 'task-alpha' });
  assert.equal(alphaState.taskScope.taskId, 'task-alpha');
  assert.deepEqual(alphaState.taskScope.allowedPaths, ['src/alpha/*']);

  const betaState = getScopeState({ taskId: 'task-beta' });
  assert.equal(betaState.taskScope.taskId, 'task-beta');
  assert.deepEqual(betaState.taskScope.allowedPaths, ['src/beta/*']);
});

// -----------------------------------------------------------------------------
// Defect 2: Multi-slot branch governance
// -----------------------------------------------------------------------------
test('Defect 2: setBranchGovernance stores governance per branchName without stomping', () => {
  setBranchGovernance({ branchName: 'main', prRequired: true });
  setBranchGovernance({ branchName: 'feature/login', prRequired: false });

  const mainGov = getBranchGovernanceState({ branchName: 'main' });
  assert.equal(mainGov.branchName, 'main');
  assert.equal(mainGov.prRequired, true);

  const featureGov = getBranchGovernanceState({ branchName: 'feature/login' });
  assert.equal(featureGov.branchName, 'feature/login');
  assert.equal(featureGov.prRequired, false);
});

// -----------------------------------------------------------------------------
// Defect 3: Self-blocking tracked action
// -----------------------------------------------------------------------------
test('Defect 3: track_action and check_operational_integrity are exempt from self-blocking pre-action gates', () => {
  const trackResult = evaluateGates('track_action', { actionId: 'test_action' });
  assert.ok(trackResult === null || trackResult.blocked === false, 'track_action must never be blocked by pre-action gates');

  const checkResult = evaluateGates('check_operational_integrity', {});
  assert.ok(checkResult === null || checkResult.blocked === false, 'check_operational_integrity must never be blocked');
});

// -----------------------------------------------------------------------------
// Defect 4: list_human_escalations schema & filtering
// -----------------------------------------------------------------------------
test('Defect 4: list_human_escalations schema accepts taskId, escalationId, repoPath, and feedbackDir', () => {
  const tool = TOOLS.find((t) => t.name === 'list_human_escalations');
  assert.ok(tool, 'list_human_escalations must exist in tool registry');
  const props = tool.inputSchema.properties;
  assert.ok(props.taskId, 'taskId must be allowed in list_human_escalations schema');
  assert.ok(props.escalationId, 'escalationId must be allowed in list_human_escalations schema');
  assert.ok(props.repoPath, 'repoPath must be allowed in list_human_escalations schema');
  assert.ok(props.feedbackDir, 'feedbackDir must be allowed in list_human_escalations schema');

  // Test functional filtering
  const listResult = listEscalations({ taskId: 'non-existent-task-123' });
  assert.ok(Array.isArray(listResult));
  assert.equal(listResult.length, 0);
});

// -----------------------------------------------------------------------------
// Defect 5 & 6: Spend gate & ordinary words matching
// -----------------------------------------------------------------------------
test('Defect 5 & 6: Read-only inspection tools and ordinary words like "paid" or "free" never trigger economic action spend gates', () => {
  // Ordinary text containing "paid" or "free"
  const viewResult = detectEconomicAction('view_file', {
    path: '/docs/pricing.md',
    content: 'We offer free tier and paid orders for team users.',
  });
  assert.equal(viewResult, false, 'view_file on text with paid/free must return false');

  const grepResult = detectEconomicAction('grep_search', {
    Query: 'is this fix published live for paid accounts?',
    SearchPath: '/src',
  });
  assert.equal(grepResult, false, 'grep_search with paid query must return false');

  const metricsResult = detectEconomicAction('get_business_metrics', {
    metric: 'paidCustomers',
  });
  assert.equal(metricsResult, false, 'get_business_metrics must return false for economic action check');

  const escalationsResult = detectEconomicAction('list_human_escalations', {
    status: 'pending',
  });
  assert.equal(escalationsResult, false, 'list_human_escalations must return false');
});
