'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildEvidence,
  buildReasoning,
  buildRemediations,
  evaluateWorkflowSentinel,
  scoreRisk,
} = require('../scripts/workflow-sentinel');
const {
  evaluateGatesAsync,
  clearSessionActions,
  setTaskScope,
} = require('../scripts/gates-engine');
const {
  callTool,
} = require('../adapters/mcp/server-stdio');
const {
  buildCostControl,
  buildWorkflowControl,
  normalizeProviderAction,
} = require('../scripts/provider-action-normalizer');

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function writeJsonl(filePath, rows) {
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

function makeTempPath(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-sentinel-')), name);
}

test('workflow sentinel warns on multi-surface release-sensitive blast radius', () => {
  // Use an isolated empty feedbackDir so local learned policy data does not
  // inflate the risk score beyond the warn threshold in this deterministic test.
  const isolatedFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-sentinel-fb-'));
  const report = evaluateWorkflowSentinel('Bash', {
    command: 'node scripts/deploy-policy.js --dry-run',
    changed_files: [
      'src/api/server.js',
      'adapters/mcp/server-stdio.js',
      'config/mcp-allowlists.json',
      'tests/mcp-server.test.js',
    ],
  }, {
    repoPath: process.cwd(),
    feedbackDir: isolatedFeedbackDir,
    feedbackOptions: { feedbackDir: isolatedFeedbackDir },
    governanceState: {
      taskScope: {
        summary: 'sentinel dry run',
        allowedPaths: ['src/**', 'adapters/**', 'config/**', 'tests/**'],
        protectedPaths: [],
      },
      protectedApprovals: [],
      branchGovernance: {
        baseBranch: 'main',
        prRequired: true,
      },
    },
  });

  assert.equal(report.decision, 'warn');
  assert.equal(report.blastRadius.surfaceCount >= 3, true);
  assert.equal(report.blastRadius.releaseSensitiveFiles.includes('config/mcp-allowlists.json'), true);
  assert.equal(report.decisionControl.executionMode, 'checkpoint_required');
  assert.equal(report.decisionControl.decisionOwner, 'human');
  assert.equal(report.decisionControl.reversibility, 'one_way_door');
  assert.equal(report.decisionControl.deliberation.required, true);
  assert.equal(report.decisionControl.deliberation.mode, 'reason_then_consistency_check');
  assert.equal(report.decisionControl.deliberation.consistencyCheck.required, true);
  assert.equal(report.decisionControl.deliberation.consistencyCheck.variants.length, 3);
  assert.equal(report.decisionControl.deliberation.consistencyCheck.onDisagreement, 'checkpoint_required');
  assert.ok(report.remediations.some((entry) => entry.id === 'split_blast_radius'));
  assert.match(report.reasoning.join('\n'), /Blast radius:/);
  assert.match(report.reasoning.join('\n'), /Decision control:/);
  assert.match(report.reasoning.join('\n'), /Deliberation policy:/);
});

test('workflow sentinel denies recurring destructive pattern with high blast radius', () => {
  const feedbackLogPath = makeTempPath('feedback-log.jsonl');
  const attributedFeedbackPath = makeTempPath('attributed-feedback.jsonl');
  writeJsonl(feedbackLogPath, []);
  writeJsonl(attributedFeedbackPath, [
    { id: 'fb_1', signal: 'negative', tool_name: 'Bash', context: 'rm -rf generated-cache removed runtime files', timestamp: new Date().toISOString() },
    { id: 'fb_2', signal: 'negative', tool_name: 'Bash', context: 'rm -rf generated-cache removed runtime files', timestamp: new Date().toISOString() },
    { id: 'fb_3', signal: 'negative', tool_name: 'Bash', context: 'rm -rf generated-cache removed runtime files', timestamp: new Date().toISOString() },
  ]);

  const report = evaluateWorkflowSentinel('Bash', {
    command: 'rm -rf generated-cache',
    changed_files: [
      'scripts/tool-registry.js',
      'src/api/server.js',
      'adapters/mcp/server-stdio.js',
    ],
  }, {
    repoPath: process.cwd(),
    governanceState: {
      taskScope: {
        summary: 'cache cleanup',
        allowedPaths: ['scripts/**', 'src/**', 'adapters/**'],
        protectedPaths: [],
      },
      protectedApprovals: [],
      branchGovernance: {
        baseBranch: 'main',
        prRequired: true,
      },
    },
    feedbackOptions: {
      feedbackLogPath,
      attributedFeedbackPath,
      guardArtifactPath: path.join(path.dirname(feedbackLogPath), 'missing-guards.json'),
    },
  });

  assert.equal(report.decision, 'deny');
  assert.equal(report.memoryGuard.mode, 'block');
  assert.equal(report.executionSurface.shouldSandbox, true);
  assert.equal(report.executionSurface.recommendation, 'required');
  assert.equal(report.decisionControl.executionMode, 'blocked');
  assert.equal(report.decisionControl.recommendedAction, 'halt');
  assert.ok(report.remediations.some((entry) => entry.id === 'retrieve_lessons'));
  assert.ok(report.remediations.some((entry) => entry.id === 'route_to_docker_sandbox'));
  assert.match(report.evidence.join('\n'), /Memory guard predicted block/);
});

test('workflow sentinel checkpoints economic actions even before code changes land', () => {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-sentinel-economic-'));
  const report = evaluateWorkflowSentinel('Bash', {
    command: 'stripe refunds create re_123 --reason requested_by_customer',
  }, {
    feedbackDir,
    repoPath: process.cwd(),
    governanceState: {
      taskScope: {
        summary: 'finance ops',
        allowedPaths: ['scripts/**'],
        protectedPaths: [],
      },
      protectedApprovals: [],
      branchGovernance: {
        baseBranch: 'main',
        prRequired: true,
      },
    },
  });

  assert.equal(report.decision, 'warn');
  assert.equal(report.actionProfile.economicAction, true);
  assert.equal(report.decisionControl.executionMode, 'checkpoint_required');
  assert.equal(report.decisionControl.reversibility, 'one_way_door');
  assert.ok(report.remediations.some((entry) => entry.id === 'economic_action_approval'));
  assert.match(report.reasoning.join('\n'), /economic action/i);
});

test('workflow sentinel checkpoints background customer-system actions', () => {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-sentinel-background-'));
  const report = evaluateWorkflowSentinel('Bash', {
    command: 'node scripts/async-job-runner.js --task "resend customer invoice email"',
    metadata: {
      source: 'scheduled',
      runType: 'invoice-send',
    },
  }, {
    feedbackDir,
    repoPath: process.cwd(),
    governanceState: {
      taskScope: {
        summary: 'background invoicing',
        allowedPaths: ['scripts/**'],
        protectedPaths: [],
      },
      protectedApprovals: [],
      branchGovernance: {
        baseBranch: 'main',
        prRequired: true,
      },
    },
  });

  assert.equal(report.decision, 'warn');
  assert.equal(report.actionProfile.backgroundAgent, true);
  assert.equal(report.actionProfile.customerSystemAction, true);
  assert.equal(report.decisionControl.executionMode, 'checkpoint_required');
  assert.ok(report.remediations.some((entry) => entry.id === 'background_agent_checkpoint'));
  assert.ok(report.remediations.some((entry) => entry.id === 'customer_system_guardrail'));
});

test('workflow sentinel treats explicit changed files as authoritative for PR handoff', () => {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-sentinel-empty-'));
  const report = evaluateWorkflowSentinel('Bash', {
    command: 'gh pr create --title "test"',
    changed_files: ['README.md'],
  }, {
    feedbackDir,
    repoPath: process.cwd(),
    governanceState: {
      taskScope: {
        summary: 'Allow README.md for PR prep.',
        allowedPaths: ['README.md'],
        protectedPaths: [],
      },
      protectedApprovals: [],
      branchGovernance: {
        branchName: 'feat/thumbgate-hardening',
        baseBranch: 'main',
        prRequired: true,
        releaseVersion: '0.9.11',
      },
    },
    memoryGuard: {
      mode: 'block',
      reason: 'Tool "Bash" has 3 attributed negative(s), 0 total negative(s)',
      source: 'state',
    },
  });

  assert.equal(report.decision, 'allow');
  assert.deepEqual(report.blastRadius.affectedFiles, ['README.md']);
  assert.equal(report.decisionControl.executionMode, 'auto_execute');
  assert.equal(report.decisionControl.decisionOwner, 'agent');
  assert.equal(report.decisionControl.deliberation.required, true);
  assert.equal(report.decisionControl.deliberation.mode, 'reason_then_decide');
  assert.equal(report.decisionControl.deliberation.consistencyCheck.required, false);
});

test('workflow sentinel blocks mismatched GitHub Actions release dispatch', () => {
  const isolatedFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-sentinel-fb-'));
  const report = evaluateWorkflowSentinel('Bash', {
    command: 'gh workflow run deploy-dev.yml --ref develop',
    changed_files: ['mobile/app/build.gradle'],
  }, {
    repoPath: process.cwd(),
    headSha: '1111111111111111111111111111111111111111',
    feedbackDir: isolatedFeedbackDir,
    feedbackOptions: { feedbackDir: isolatedFeedbackDir },
    governanceState: {
      taskScope: {
        summary: 'Release mobile build.',
        allowedPaths: ['mobile/**'],
        protectedPaths: [],
      },
      protectedApprovals: [],
      branchGovernance: {
        branchName: 'release/mobile-2026-04-24',
        baseBranch: 'main',
        prRequired: true,
        workflowDispatch: {
          environment: 'release',
          workflow: 'deploy-release.yml',
          ref: 'main',
          sha: '0000000000000000000000000000000000000000',
          job: 'mobile-release',
        },
      },
    },
  });

  assert.equal(report.decision, 'deny');
  assert.equal(report.decisionControl.executionMode, 'blocked');
  assert.equal(report.decisionControl.deliberation.mode, 'reason_then_consistency_check');
  assert.equal(report.operationalIntegrity.commandInfo.isWorkflowRun, true);
  assert.equal(report.operationalIntegrity.commandInfo.workflowName, 'deploy-dev.yml');
  assert.ok(report.operationalIntegrity.blockers.some((entry) => entry.code === 'workflow_name_mismatch'));
  assert.ok(report.operationalIntegrity.blockers.some((entry) => entry.code === 'workflow_ref_mismatch'));
  assert.ok(report.operationalIntegrity.blockers.some((entry) => entry.code === 'workflow_sha_mismatch'));
  assert.ok(report.remediations.some((entry) => entry.id === 'verify_workflow_dispatch'));
  assert.match(report.evidence.join('\n'), /workflow_name_mismatch/);
});

test('provider action normalizer maps Anthropic tool_use blocks into sentinel actions', () => {
  const normalized = normalizeProviderAction({
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    content: [{
      type: 'tool_use',
      id: 'toolu_01',
      name: 'Bash',
      input: {
        command: 'npm test',
        changedFiles: ['tests/workflow-sentinel.test.js'],
      },
    }],
    usage: {
      input_tokens: 1000,
      output_tokens: 250,
    },
  });

  assert.equal(normalized.provider, 'anthropic');
  assert.equal(normalized.model, 'claude-sonnet-4-5');
  assert.equal(normalized.toolName, 'Bash');
  assert.equal(normalized.command, 'npm test');
  assert.equal(normalized.intent, 'verify');
  assert.deepEqual(normalized.affectedFiles, ['tests/workflow-sentinel.test.js']);
  assert.equal(normalized.usage.totalTokens, 1250);
  assert.equal(normalized.rawShape.hasAnthropicToolUse, true);
});

test('provider action normalizer maps MCP tools/call into sentinel actions', () => {
  const normalized = normalizeProviderAction({
    method: 'tools/call',
    params: {
      server: 'filesystem',
      name: 'run_command',
      arguments: {
        command: 'git push origin codex/mcp-control-plane',
        changed_files: ['scripts/provider-action-normalizer.js'],
      },
    },
  });

  assert.equal(normalized.provider, 'mcp');
  assert.equal(normalized.mcpServer, 'filesystem');
  assert.equal(normalized.toolName, 'run_command');
  assert.equal(normalized.actionType, 'shell.exec');
  assert.equal(normalized.intent, 'release-workflow');
  assert.deepEqual(normalized.affectedFiles, ['scripts/provider-action-normalizer.js']);
  assert.equal(normalized.rawShape.hasMcpToolCall, true);
});

test('provider action normalizer parses OpenAI function tool calls', () => {
  const normalized = normalizeProviderAction({
    provider: 'openai',
    toolCall: {
      id: 'call_123',
      function: {
        name: 'Bash',
        arguments: JSON.stringify({
          command: 'npm test',
          changedFiles: ['tests/workflow-sentinel.test.js'],
        }),
      },
    },
    usage: {
      prompt_tokens: 1200,
      completion_tokens: 200,
    },
  });

  assert.equal(normalized.provider, 'openai');
  assert.equal(normalized.providerCallId, 'call_123');
  assert.equal(normalized.toolName, 'Bash');
  assert.equal(normalized.command, 'npm test');
  assert.deepEqual(normalized.affectedFiles, ['tests/workflow-sentinel.test.js']);
  assert.equal(normalized.usage.totalTokens, 1400);
  assert.equal(normalized.rawShape.hasOpenAiToolCall, true);
});

test('provider action normalizer preserves MCP resource and prompt primitives', () => {
  const resource = normalizeProviderAction({
    method: 'resources/read',
    params: {
      server: 'docs',
      uri: 'file:///workspace/README.md',
    },
  });
  const prompt = normalizeProviderAction({
    method: 'prompts/get',
    params: {
      server: 'playbooks',
      name: 'format_document',
      arguments: {
        style: 'concise',
      },
    },
  });

  assert.equal(resource.provider, 'mcp');
  assert.equal(resource.mcpPrimitive, 'resource');
  assert.equal(resource.actionType, 'context.read');
  assert.equal(resource.intent, 'read-context');
  assert.deepEqual(resource.toolInput, { uri: 'file:///workspace/README.md' });
  assert.equal(prompt.provider, 'mcp');
  assert.equal(prompt.mcpPrimitive, 'prompt');
  assert.equal(prompt.actionType, 'prompt.get');
  assert.equal(prompt.intent, 'load-prompt-template');
  assert.deepEqual(prompt.toolInput, { style: 'concise' });
});

test('workflow sentinel denies provider actions that exceed explicit model budget', () => {
  const normalized = normalizeProviderAction({
    provider: 'anthropic',
    content: [{
      type: 'tool_use',
      id: 'toolu_budget',
      name: 'Bash',
      input: {
        command: 'npm test',
        changedFiles: ['tests/workflow-sentinel.test.js'],
      },
    }],
    usage: {
      input_tokens: 9000,
      output_tokens: 500,
    },
  });
  const costControl = buildCostControl(normalized, { maxTokensPerAction: 5000 });
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-provider-budget-'));
  const report = evaluateWorkflowSentinel(normalized.toolName, {
    repoPath: process.cwd(),
  }, {
    normalizedAction: normalized,
    budget: { maxTokensPerAction: 5000 },
    feedbackDir,
    feedbackOptions: { feedbackDir },
    governanceState: {
      taskScope: {
        summary: 'provider action budget test',
        allowedPaths: ['tests/**'],
        protectedPaths: [],
      },
      protectedApprovals: [],
      branchGovernance: {
        baseBranch: 'main',
        prRequired: true,
      },
    },
  });

  assert.equal(costControl.mode, 'block');
  assert.equal(report.normalizedAction.provider, 'anthropic');
  assert.equal(report.costControl.mode, 'block');
  assert.equal(report.decision, 'deny');
  assert.equal(report.decisionControl.executionMode, 'blocked');
  assert.ok(report.remediations.some((entry) => entry.id === 'reduce_model_budget'));
  assert.match(report.evidence.join('\n'), /Cost control block/);
});

test('provider action normalizer detects open-ended agent workflows and inspection evidence', () => {
  const missingInspection = normalizeProviderAction({
    provider: 'anthropic',
    workflowPattern: 'agent',
    goal: 'Create and publish a product video.',
    tools: ['bash', 'generate_image', 'text_to_speech', 'post_media'],
    content: [{
      type: 'tool_use',
      id: 'toolu_agent',
      name: 'post_media',
      input: {
        platform: 'threads',
      },
    }],
  });
  const withInspection = normalizeProviderAction({
    provider: 'anthropic',
    workflowPattern: 'agent',
    goal: 'Create and publish a product video.',
    tools: ['bash', 'generate_image', 'text_to_speech', 'post_media'],
    workflow: {
      inspection: {
        required: true,
        expectedObservation: 'Screenshot preview and upload API response confirm the media matches requirements.',
      },
    },
    content: [{
      type: 'tool_use',
      id: 'toolu_agent_verified',
      name: 'post_media',
      input: {
        platform: 'threads',
      },
    }],
  });

  assert.equal(missingInspection.workflow.pattern, 'agent');
  assert.equal(missingInspection.workflow.toolCount, 4);
  assert.equal(missingInspection.workflow.hasInspectionEvidence, false);
  assert.equal(buildWorkflowControl(missingInspection).mode, 'block');
  assert.equal(withInspection.workflow.hasInspectionEvidence, true);
  assert.equal(buildWorkflowControl(withInspection).mode, 'allow');
});

test('workflow sentinel blocks open-ended agents without environment inspection', () => {
  const normalized = normalizeProviderAction({
    provider: 'anthropic',
    workflowPattern: 'agent',
    goal: 'Investigate and fix an unknown production issue.',
    tools: ['read', 'grep', 'bash', 'edit'],
    content: [{
      type: 'tool_use',
      id: 'toolu_agent_no_inspection',
      name: 'Bash',
      input: {
        command: 'node scripts/deploy-policy.js --dry-run',
        changedFiles: ['src/api/server.js'],
      },
    }],
  });
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-agent-workflow-'));
  const report = evaluateWorkflowSentinel(normalized.toolName, {}, {
    normalizedAction: normalized,
    feedbackDir,
    feedbackOptions: { feedbackDir },
    governanceState: {
      taskScope: {
        summary: 'agent workflow inspection test',
        allowedPaths: ['src/**'],
        protectedPaths: [],
      },
      protectedApprovals: [],
      branchGovernance: {
        baseBranch: 'main',
        prRequired: true,
      },
    },
  });

  assert.equal(report.workflowControl.mode, 'block');
  assert.equal(report.decision, 'deny');
  assert.equal(report.decisionControl.executionMode, 'blocked');
  assert.ok(report.drivers.some((entry) => entry.key === 'missing_environment_inspection'));
  assert.ok(report.remediations.some((entry) => entry.id === 'add_environment_inspection'));
  assert.ok(report.remediations.some((entry) => entry.id === 'prefer_workflow_when_possible'));
  assert.match(report.evidence.join('\n'), /Workflow pattern agent/);
});

test('workflow sentinel allows inspected predefined workflows but records fan-out risk', () => {
  const normalized = normalizeProviderAction({
    provider: 'anthropic',
    workflowPattern: 'parallelization',
    branches: ['security', 'product', 'copy'],
    workflow: {
      inspection: {
        required: true,
        expectedObservation: 'Aggregator compares branch findings and emits acceptance criteria.',
      },
    },
    content: [{
      type: 'tool_use',
      id: 'toolu_parallel',
      name: 'Bash',
      input: {
        command: 'npm test',
        changedFiles: ['tests/workflow-sentinel.test.js'],
      },
    }],
  });
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-parallel-workflow-'));
  const report = evaluateWorkflowSentinel(normalized.toolName, {}, {
    normalizedAction: normalized,
    budget: { maxParallelBranches: 4 },
    feedbackDir,
    feedbackOptions: { feedbackDir },
    governanceState: {
      taskScope: {
        summary: 'parallel workflow inspection test',
        allowedPaths: ['tests/**'],
        protectedPaths: [],
      },
      protectedApprovals: [],
      branchGovernance: {
        baseBranch: 'main',
        prRequired: true,
      },
    },
  });

  assert.equal(report.workflowControl.mode, 'allow');
  assert.equal(report.normalizedAction.workflow.pattern, 'parallelization');
  assert.equal(report.normalizedAction.workflow.branchCount, 3);
  assert.ok(report.drivers.some((entry) => entry.key === 'parallel_workflow'));
  assert.match(report.reasoning.join('\n'), /Workflow control: allow for parallelization/);
});

test('workflow sentinel blocks parallel fan-out beyond branch budget', () => {
  const normalized = normalizeProviderAction({
    provider: 'anthropic',
    workflowPattern: 'parallelization',
    branches: ['a', 'b', 'c', 'd', 'e'],
    workflow: {
      inspection: {
        required: true,
        expectedObservation: 'Aggregator validates each branch.',
      },
    },
    content: [{
      type: 'tool_use',
      id: 'toolu_parallel_budget',
      name: 'Bash',
      input: {
        command: 'npm test',
        changedFiles: ['tests/workflow-sentinel.test.js'],
      },
    }],
  });
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-parallel-budget-'));
  const report = evaluateWorkflowSentinel(normalized.toolName, {}, {
    normalizedAction: normalized,
    budget: { maxParallelBranches: 3 },
    feedbackDir,
    feedbackOptions: { feedbackDir },
    governanceState: {
      taskScope: {
        summary: 'parallel budget test',
        allowedPaths: ['tests/**'],
        protectedPaths: [],
      },
      protectedApprovals: [],
      branchGovernance: {
        baseBranch: 'main',
        prRequired: true,
      },
    },
  });

  assert.equal(report.costControl.mode, 'block');
  assert.equal(report.workflowControl.mode, 'block');
  assert.equal(report.decision, 'deny');
  assert.match(report.evidence.join('\n'), /Parallel workflow branch count 5 exceeds/);
});

test('evaluateGatesAsync returns workflow sentinel warning when no static gate matches', async () => {
  const configPath = makeTempPath('gates.json');
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-sentinel-empty-'));
  writeJson(configPath, { version: 1, gates: [] });
  const previousFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;
  clearSessionActions();
  setTaskScope({
    allowedPaths: [
      'src/api/server.js',
      'adapters/mcp/server-stdio.js',
      'config/mcp-allowlists.json',
      'tests/mcp-server.test.js',
    ],
    summary: 'Isolate workflow-sentinel warning test from caller worktree state.',
  });

  try {
    const result = await evaluateGatesAsync('Bash', {
      command: 'node scripts/deploy-policy.js --dry-run',
      changed_files: [
        'src/api/server.js',
        'adapters/mcp/server-stdio.js',
        'config/mcp-allowlists.json',
        'tests/mcp-server.test.js',
      ],
    }, configPath);

    assert.ok(result);
    assert.equal(result.decision, 'warn');
    assert.equal(result.gate, 'workflow-sentinel');
    assert.match(result.message, /Predicted workflow risk/);
    assert.match(result.reasoning.join('\n'), /Workflow sentinel risk/);
  } finally {
    if (previousFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = previousFeedbackDir;
  }
});

test('evaluateGatesAsync enriches memory guard results with workflow sentinel context', async () => {
  const configPath = makeTempPath('gates.json');
  const feedbackLogPath = makeTempPath('feedback-log.jsonl');
  const attributedFeedbackPath = makeTempPath('attributed-feedback.jsonl');
  writeJson(configPath, { version: 1, gates: [] });
  writeJsonl(feedbackLogPath, []);
  writeJsonl(attributedFeedbackPath, [
    { id: 'fb_1', signal: 'negative', tool_name: 'Bash', context: 'rm -rf generated-cache removed runtime files', timestamp: new Date().toISOString() },
    { id: 'fb_2', signal: 'negative', tool_name: 'Bash', context: 'rm -rf generated-cache removed runtime files', timestamp: new Date().toISOString() },
    { id: 'fb_3', signal: 'negative', tool_name: 'Bash', context: 'rm -rf generated-cache removed runtime files', timestamp: new Date().toISOString() },
  ]);

  const previousFeedbackLog = process.env.THUMBGATE_FEEDBACK_LOG;
  const previousAttributed = process.env.THUMBGATE_ATTRIBUTED_FEEDBACK;
  const previousGuards = process.env.THUMBGATE_GUARDS_PATH;
  process.env.THUMBGATE_FEEDBACK_LOG = feedbackLogPath;
  process.env.THUMBGATE_ATTRIBUTED_FEEDBACK = attributedFeedbackPath;
  process.env.THUMBGATE_GUARDS_PATH = path.join(path.dirname(feedbackLogPath), 'missing-guards.json');
  clearSessionActions();
  setTaskScope({
    allowedPaths: [
      'docs/**',
    ],
    summary: 'Isolate memory-guard sentinel enrichment test from caller worktree state.',
  });

  try {
    const result = await evaluateGatesAsync('Bash', {
      command: 'rm -rf generated-cache',
      changed_files: [
        'scripts/tool-registry.js',
        'src/api/server.js',
        'adapters/mcp/server-stdio.js',
      ],
    }, configPath);

    assert.ok(result);
    assert.equal(result.decision, 'deny');
    assert.equal(result.gate, 'memory-high-risk-default-deny');
    assert.ok(result.sentinel);
    assert.match(result.message, /Workflow sentinel:/);
    assert.match(result.reasoning.join('\n'), /Workflow sentinel risk/);
  } finally {
    if (previousFeedbackLog === undefined) delete process.env.THUMBGATE_FEEDBACK_LOG;
    else process.env.THUMBGATE_FEEDBACK_LOG = previousFeedbackLog;
    if (previousAttributed === undefined) delete process.env.THUMBGATE_ATTRIBUTED_FEEDBACK;
    else process.env.THUMBGATE_ATTRIBUTED_FEEDBACK = previousAttributed;
    if (previousGuards === undefined) delete process.env.THUMBGATE_GUARDS_PATH;
    else process.env.THUMBGATE_GUARDS_PATH = previousGuards;
  }
});

test('workflow_sentinel MCP tool returns structured report text', async () => {
  const result = await callTool('workflow_sentinel', {
    toolName: 'Bash',
    command: 'node scripts/deploy-policy.js --dry-run',
    changedFiles: [
      'src/api/server.js',
      'adapters/mcp/server-stdio.js',
      'config/mcp-allowlists.json',
    ],
  });

  assert.equal(Array.isArray(result.content), true);
  assert.equal(result.content[0].type, 'text');
  assert.match(result.content[0].text, /workflow-sentinel-v2/);
  assert.match(result.content[0].text, /blastRadius/);
  assert.match(result.content[0].text, /executionSurface/);
});

test('workflow sentinel surfaces learned verify policy in warning decisions', () => {
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-sentinel-policy-'));
  const now = Date.now();
  writeJsonl(path.join(feedbackDir, 'feedback-log.jsonl'), [
    {
      id: 'fb_verify_1',
      timestamp: new Date(now - 9000).toISOString(),
      signal: 'negative',
      context: 'tests were failing and coverage was not verified before claiming success',
      diagnosis: {
        rootCauseCategory: 'tool_output_misread',
        criticalFailureStep: 'verification',
      },
      tags: ['testing', 'verification'],
    },
    {
      id: 'fb_verify_2',
      timestamp: new Date(now - 8000).toISOString(),
      signal: 'negative',
      context: 'verification failed because the proof command output was misread',
      diagnosis: {
        rootCauseCategory: 'tool_output_misread',
        criticalFailureStep: 'verification',
      },
      tags: ['testing', 'verification'],
    },
  ]);
  writeJsonl(path.join(feedbackDir, 'diagnostic-log.jsonl'), Array.from({ length: 6 }, (_, index) => ({
    id: `diag_verify_${index}`,
    timestamp: new Date(now - ((6 - index) * 1000)).toISOString(),
    source: 'verification_loop',
    step: 'verification',
    context: 'coverage claim mismatched the actual output',
    diagnosis: {
      rootCauseCategory: 'tool_output_misread',
      criticalFailureStep: 'verification',
      violations: [{ constraintId: 'workflow:proof_commands' }],
    },
  })));

  const report = evaluateWorkflowSentinel('Bash', {
    command: 'npm test --coverage',
    changed_files: [
      'src/api/server.js',
      'tests/mcp-server.test.js',
    ],
  }, {
    feedbackDir,
    repoPath: process.cwd(),
    governanceState: {
      taskScope: {
        summary: 'verification-heavy edit',
        allowedPaths: ['src/**', 'tests/**'],
        protectedPaths: [],
      },
      protectedApprovals: [],
      branchGovernance: {
        baseBranch: 'main',
        prRequired: true,
      },
    },
    memoryGuard: {
      mode: 'allow',
      reason: '',
    },
  });

  assert.equal(report.decision, 'warn');
  assert.equal(report.learnedPolicy.enabled, true);
  assert.equal(report.learnedPolicy.prediction.label, 'verify');
  assert.equal(report.decisionControl.executionMode, 'checkpoint_required');
  assert.ok(report.remediations.some((entry) => entry.id === 'verify_before_closeout'));
  assert.match(report.evidence.join('\n'), /Learned policy predicted verify/);
});

test('workflow sentinel scores deny, warn, and recall learned-policy drivers', () => {
  const baseInput = {
    toolName: 'Edit',
    toolInput: {
      command: 'apply_patch',
      file_path: 'docs/MARKETING_COPY_CONGRUENCE.md',
    },
    affectedFiles: ['docs/MARKETING_COPY_CONGRUENCE.md'],
    integrity: {
      blockers: [],
    },
    memoryGuard: {
      mode: 'allow',
      reason: '',
    },
    blastRadius: {
      fileCount: 1,
      surfaceCount: 1,
      releaseSensitiveFiles: [],
      summary: '1 file across 1 workflow surface',
      severity: 'low',
      unapprovedProtectedFiles: 0,
    },
    taskScopeViolation: null,
    protectedSurface: {
      unapprovedProtectedFiles: [],
    },
  };

  const denyRisk = scoreRisk({
    ...baseInput,
    learnedPolicy: {
      enabled: true,
      prediction: { label: 'deny', confidence: 0.8 },
    },
  });
  const warnRisk = scoreRisk({
    ...baseInput,
    learnedPolicy: {
      enabled: true,
      prediction: { label: 'warn', confidence: 0.5 },
    },
  });
  const recallRisk = scoreRisk({
    ...baseInput,
    learnedPolicy: {
      enabled: true,
      prediction: { label: 'recall', confidence: 0.6 },
    },
  });

  assert.ok(denyRisk.drivers.some((entry) => entry.key === 'learned_policy_deny'));
  assert.ok(warnRisk.drivers.some((entry) => entry.key === 'learned_policy_warn'));
  assert.ok(recallRisk.drivers.some((entry) => entry.key === 'learned_policy_recall'));
});

test('workflow sentinel learned recall evidence and remediations are operator-readable', () => {
  const learnedPolicy = {
    enabled: true,
    prediction: {
      label: 'recall',
      confidence: 0.61,
    },
    topTokens: [
      { token: 'tag:repeat', weight: 2.4 },
      { token: 'text:again', weight: 1.8 },
    ],
  };
  const blastRadius = {
    fileCount: 3,
    surfaceCount: 2,
    releaseSensitiveFiles: [],
    summary: '3 files across 2 workflow surfaces',
    severity: 'medium',
    unapprovedProtectedFiles: 0,
  };
  const evidence = buildEvidence({
    integrity: { blockers: [] },
    memoryGuard: { mode: 'allow', reason: '' },
    learnedPolicy,
    blastRadius,
    taskScopeViolation: null,
    protectedSurface: { unapprovedProtectedFiles: [] },
  });
  const remediations = buildRemediations({
    integrity: { blockers: [] },
    taskScopeViolation: null,
    protectedSurface: { unapprovedProtectedFiles: [] },
    blastRadius,
    memoryGuard: { mode: 'allow', reason: '' },
    learnedPolicy,
    executionSurface: { shouldSandbox: false },
  });
  const reasoning = buildReasoning({
    toolName: 'Edit',
    band: 'medium',
    riskScore: 0.36,
    blastRadius,
    drivers: [{ key: 'learned_policy_recall', weight: 0.09, reason: 'Needs prior lessons.' }],
    remediations,
    executionSurface: { shouldSandbox: false },
    learnedPolicy,
  });

  assert.match(evidence.join('\n'), /Learned policy predicted recall/);
  assert.match(evidence.join('\n'), /tag:repeat, text:again/);
  assert.ok(remediations.some((entry) => entry.id === 'retrieve_lessons'));
  assert.match(reasoning.join('\n'), /Learned policy predicted recall/);
  assert.match(reasoning.join('\n'), /Inspect prior lessons/);
});
