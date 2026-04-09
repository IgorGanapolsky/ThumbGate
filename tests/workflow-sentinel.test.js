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
} = require('../scripts/gates-engine');
const {
  callTool,
} = require('../adapters/mcp/server-stdio');

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
  assert.ok(report.remediations.some((entry) => entry.id === 'split_blast_radius'));
  assert.match(report.reasoning.join('\n'), /Blast radius:/);
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
  assert.ok(report.remediations.some((entry) => entry.id === 'retrieve_lessons'));
  assert.ok(report.remediations.some((entry) => entry.id === 'route_to_docker_sandbox'));
  assert.match(report.evidence.join('\n'), /Memory guard predicted block/);
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
});

test('evaluateGatesAsync returns workflow sentinel warning when no static gate matches', async () => {
  const configPath = makeTempPath('gates.json');
  const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-sentinel-empty-'));
  writeJson(configPath, { version: 1, gates: [] });
  const previousFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;

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
