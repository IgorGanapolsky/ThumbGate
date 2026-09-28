'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('os');
const path = require('path');

const { classifyGateIntent, lexicalGateApplies } = require('../scripts/gate-intent-route');
const { evaluateGates, runHardFloor } = require('../scripts/gates-engine');
const { buildRemediations } = require('../scripts/workflow-sentinel');
const { catalogIds, executeRemediation } = require('../scripts/remediation-exec');
const { computePerGateFalsePositives } = require('../scripts/gate-stats');

test('read-only git diff does not reach a transaction lexical gate', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-intent-'));
  const configPath = path.join(dir, 'gates.json');
  fs.writeFileSync(configPath, JSON.stringify({
    gates: [{
      id: 'production-deploy-approval',
      pattern: 'deploy',
      action: 'block',
      message: 'deploy blocked',
      severity: 'high',
    }],
  }));
  const read = evaluateGates('Bash', {
    command: 'git diff -- docs/purchase-policy.md deploy-notes.txt',
  }, configPath);
  assert.equal(read, null);
  const transact = evaluateGates('Bash', { command: 'railway deploy' }, configPath);
  assert.equal(transact && transact.decision, 'deny');
  assert.equal(transact.gate, 'production-deploy-approval');
});

test('a finance word in a read-only diff does not trip the financial hard floor', () => {
  const output = runHardFloor({
    tool_name: 'Bash',
    tool_input: { command: 'git diff -- docs/purchase-policy.md' },
  });
  assert.equal(output, null);
});

test('a paid checkout url is still an economic action', () => {
  const { detectEconomicAction } = require('../scripts/financial-control-plane');
  assert.equal(detectEconomicAction('Bash', {
    command: 'curl -s https://app.apollo.io/#/settings/plans/upgrade',
  }), true);
  assert.equal(detectEconomicAction('Bash', {
    command: 'git diff -- docs/purchase-policy.md',
  }), false);
});

test('a payment url stays transact', () => {
  const route = classifyGateIntent('Bash', {
    command: 'curl -s https://checkout.stripe.com/c/pay/cs_test',
  });
  assert.equal(route.intent, 'transact');
  assert.equal(lexicalGateApplies({ id: 'style-violation-log', route: 'always' }, route), true);
  assert.equal(lexicalGateApplies({ id: 'production-deploy-approval' }, { intent: 'read' }), false);
  assert.equal(lexicalGateApplies({ id: 'force-push' }, { intent: 'read' }), true);
});

test('every advertised remediation executes without a schema error', () => {
  const remediations = buildRemediations({
    toolName: 'Bash',
    command: 'git push origin main',
    actionContext: 'git push origin main',
    taskScopeViolation: { reasonCode: 'missing_task_scope' },
    protectedSurface: { unapprovedProtectedFiles: ['AGENTS.md'] },
    integrity: {
      baseBranch: 'main',
      blockers: [
        { code: 'missing_branch_governance' },
        { code: 'merge_requires_pr_context' },
        { code: 'missing_workflow_dispatch_evidence' },
        { code: 'missing_release_version' },
        { code: 'publish_requires_base_branch' },
      ],
    },
    actionProfile: { backgroundAgent: true, economicAction: true, customerSystemAction: true },
    memoryGuard: { mode: 'block', reason: 'prior failure' },
    learnedPolicy: { enabled: true, prediction: { label: 'verify', confidence: 0.9 } },
    blastRadius: { fileCount: 5, surfaceCount: 4 },
    executionSurface: {
      shouldSandbox: true,
      launchers: { standalone: 'echo sandbox', dockerDesktop: 'echo desktop' },
    },
    costControl: { mode: 'block' },
    financialControl: { mode: 'block', reasonCodes: ['zero_spend_budget'] },
    workflowContract: {
      active: true,
      violations: [
        { code: 'missing_required_evidence' },
        { code: 'branch_outside_contract' },
        { code: 'blocked_action' },
      ],
    },
    workflowControl: { mode: 'warn', workflow: { pattern: 'agent' } },
  });

  const emitted = remediations.map((entry) => entry.id).sort();
  assert.deepEqual(emitted, catalogIds().slice().sort());
  for (const entry of remediations) {
    assert.equal(typeof entry.executable.tool, 'string');
    if (entry.id === 'retrieve_lessons') {
      assert.equal(entry.executable.arguments.toolName, 'Bash');
      assert.ok(entry.executable.arguments.actionContext);
    }
    const result = executeRemediation(entry.id, { executable: entry.executable });
    assert.equal(result.ok, true, entry.id);
  }
});

test('per-gate false positive rate counts a later allow of the same command', () => {
  const rows = computePerGateFalsePositives([
    {
      timestamp: '2026-09-22T12:00:00.000Z',
      gateId: 'production-deploy-approval',
      decision: 'deny',
      toolName: 'Bash',
      toolInput: { command: 'git diff -- docs/deploy.md' },
    },
    {
      timestamp: '2026-09-22T12:05:00.000Z',
      gateId: 'production-deploy-approval',
      decision: 'allow',
      toolName: 'Bash',
      toolInput: { command: 'git diff -- docs/deploy.md' },
    },
    {
      timestamp: '2026-09-22T12:10:00.000Z',
      gateId: 'force-push',
      decision: 'deny',
      toolName: 'Bash',
      toolInput: { command: 'git push --force origin main' },
    },
  ]);
  const deploy = rows.find((row) => row.gateId === 'production-deploy-approval');
  const force = rows.find((row) => row.gateId === 'force-push');
  assert.equal(deploy.candidateFalsePositives, 1);
  assert.equal(deploy.falsePositiveRate, 1);
  assert.equal(force.candidateFalsePositives, 0);
  assert.equal(force.falsePositiveRate, 0);
});
