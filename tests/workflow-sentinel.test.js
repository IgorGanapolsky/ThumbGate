'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateWorkflowSentinel,
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
  const report = evaluateWorkflowSentinel('Bash', {
    command: 'gh pr create --title "test"',
    changed_files: ['README.md'],
  }, {
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
  writeJson(configPath, { version: 1, gates: [] });

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
  assert.match(result.content[0].text, /workflow-sentinel-v1/);
  assert.match(result.content[0].text, /blastRadius/);
  assert.match(result.content[0].text, /executionSurface/);
});
