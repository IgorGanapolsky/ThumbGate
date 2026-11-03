'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  NODE_TYPES,
  ingestUnifiedContextNode,
  discoverCanonicalPath,
  compileSkillToGraphYaml,
  executeProceduralGraph,
  recommendModelDowngrade,
  auditGraphGovernance,
} = require('../src/procedural-graph-engine');

test('Procedural Graph Engineering (Zachary Blumenfeld) 6-pillar workflow executes deterministically end-to-end', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-proc-graph-'));
  const graphFile = path.join(tmpDir, 'context-graph.json');

  // 1. Unified 3-Layer Context Graph (short-term conversation, long-term domain entities + SoR, decision traces)
  const ingest1 = ingestUnifiedContextNode(
    {
      shortTermTurn: {
        sessionId: 'sess_loan_1',
        role: 'user',
        content: 'Evaluate policy compliance and checkout recovery for enterprise buyer',
      },
      longTermEntity: {
        id: 'ent_policy_soc2',
        entityType: 'compliance_policy',
        name: 'SOC2 Pre-Tool Verification Policy',
        systemOfRecord: 'snowflake',
        attributes: { maxRiskScore: 0.7, requireIsolatedVerifier: true },
      },
      decisionTrace: {
        id: 'trace_run_1_noisy',
        taskType: 'policy_compliance',
        outcome: 'PASS',
        entityIds: ['ent_policy_soc2'],
        steps: [
          { action: 'query_snowflake_policy', tool: 'execute_sql_readonly' },
          { action: 'query_snowflake_policy', tool: 'execute_sql_readonly' }, // redundant retry in unconstrained agent
          { action: 'validate_isolated_verifier', tool: 'run_verifier' },
          { action: 'validate_isolated_verifier', tool: 'run_verifier' },
          { action: 'route_approval_gate', tool: 'gate_router' },
        ],
      },
    },
    graphFile
  );
  assert.equal(ingest1.ok, true);
  assert.equal(ingest1.counts.shortTermMemory, 1);
  assert.equal(ingest1.counts.longTermMemory, 1);
  assert.equal(ingest1.counts.decisionTraces, 1);

  // Add a second clean successful trace and one failed trace to test canonical path discovery
  ingestUnifiedContextNode(
    {
      decisionTrace: {
        id: 'trace_run_2_clean',
        taskType: 'policy_compliance',
        outcome: 'PASS',
        entityIds: ['ent_policy_soc2'],
        steps: [
          { action: 'query_snowflake_policy', tool: 'execute_sql_readonly' },
          { action: 'validate_isolated_verifier', tool: 'run_verifier' },
          { action: 'route_approval_gate', tool: 'gate_router' },
        ],
      },
    },
    graphFile
  );

  ingestUnifiedContextNode(
    {
      decisionTrace: {
        id: 'trace_run_3_failed',
        taskType: 'policy_compliance',
        outcome: 'FAIL',
        steps: [{ action: 'random_hallucinated_step' }],
      },
    },
    graphFile
  );

  // 2. Discover Canonical Working Path across inconsistent unconstrained runs
  const discovery = discoverCanonicalPath('policy_compliance', graphFile);
  assert.equal(discovery.ok, true);
  assert.equal(discovery.totalRuns, 3);
  assert.equal(discovery.successfulRuns, 2);
  assert.equal(discovery.canonicalPath.stepCount, 3);
  assert.deepEqual(discovery.canonicalPath.steps, [
    'query_snowflake_policy',
    'validate_isolated_verifier',
    'route_approval_gate',
  ]);
  assert.ok(discovery.canonicalPath.varianceReductionPct > 0);

  // 3. Compile Unstructured SKILL.md + Traces into a Deterministic Graph YAML
  const sampleSkillMd = `---
name: enterprise-policy-gate
description: Deterministic compliance & risk gate
---
# Enterprise Policy Gate
1. Run hard-rule preflight script \`bin/agent-loop --health --json\` before any mutation.
2. Validate schema and test suite with \`npm run verify:isolated\`.
3. If risk score >= 0.7 or policy check fails, refuse and escalate to human reviewer.
4. Classify residual edge-case intent using calibrated rubric model.
`;

  const compiled = compileSkillToGraphYaml(
    {
      skillMarkdown: sampleSkillMd,
      skillPath: 'skills/enterprise-policy-gate/SKILL.md',
      taskType: 'policy_compliance',
    },
    graphFile
  );
  assert.equal(compiled.ok, true);
  assert.equal(compiled.graphId, 'graph_enterprise-policy-gate');
  assert.match(compiled.yaml, /schema_version: "1\.0"/);
  assert.match(compiled.yaml, /graph_id: "graph_enterprise-policy-gate"/);
  assert.match(compiled.yaml, /recommended_execution_model: "claude-haiku-4-5"/);

  const nodeTypes = compiled.compiledGraph.nodes.map((n) => n.type);
  assert.ok(nodeTypes.includes(NODE_TYPES.HARD_RULE_SCRIPT));
  assert.ok(nodeTypes.includes(NODE_TYPES.VALIDATION_LINT_LOOP));
  assert.ok(nodeTypes.includes(NODE_TYPES.ESCALATION_ROUTER));

  // 5. Verify Small Model (SLM / Haiku) Execution Downgrade calculation
  const downgrade = recommendModelDowngrade(compiled.compiledGraph.nodes);
  assert.equal(downgrade.canDowngradeToSlm, true);
  assert.equal(downgrade.recommendedExecutionModel, 'claude-haiku-4-5');
  assert.equal(downgrade.fallbackLocalModel, 'nace-ai/drex-max-v1-local');
  assert.ok(downgrade.estimatedCostReductionPct >= 80);

  // 4. Execute Procedural Graph Deterministically (PASS path + BLOCK path)
  const passRun = executeProceduralGraph(
    {
      graphId: compiled.graphId,
      context: { policyCompliant: true, riskScore: 0.15, validationPassed: true },
      entityIds: ['ent_policy_soc2'],
    },
    graphFile
  );
  assert.equal(passRun.ok, true);
  assert.equal(passRun.run.verdict, 'ALLOW');
  assert.ok(passRun.run.visitedNodes.includes('terminal_allow'));

  const blockRun = executeProceduralGraph(
    {
      graphId: compiled.graphId,
      context: { policyCompliant: false, riskScore: 0.92 },
      entityIds: ['ent_policy_soc2'],
    },
    graphFile
  );
  assert.equal(blockRun.ok, true);
  assert.equal(blockRun.run.verdict, 'BLOCK');
  assert.ok(blockRun.run.visitedNodes.includes('terminal_block_or_escalate'));

  // 6. Audit Persisted Skill Runs for Governance, Branch Coverage, and Drift
  const audit = auditGraphGovernance({ graphId: compiled.graphId }, graphFile);
  assert.equal(audit.ok, true);
  assert.equal(audit.totalPersistedRuns, 2);
  assert.ok(audit.branchTelemetry.triggeredBranchesCount > 0);
  assert.ok(audit.branchTelemetry.branchCoveragePct > 0);

  // Verify Lightweight CLI wrapper (Pillar 4)
  const cliOut = execFileSync(
    process.execPath,
    [
      path.join(__dirname, '..', 'scripts', 'procedural-graph-cli.js'),
      'audit',
      '--graph-id',
      compiled.graphId,
      '--graph-store',
      graphFile,
      '--json',
    ],
    { encoding: 'utf8' }
  );
  const cliParsed = JSON.parse(cliOut);
  assert.equal(cliParsed.ok, true);
  assert.equal(cliParsed.graphId, compiled.graphId);
});
