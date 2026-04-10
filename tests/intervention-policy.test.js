'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildExamplesFromFeedbackDir,
  getInterventionRecommendation,
  getInterventionPolicySummary,
  readJSONL,
  trainAndPersistInterventionPolicy,
} = require('../scripts/intervention-policy');

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

function makeFeedbackDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-intervention-policy-'));
}

test('intervention policy trains from audit, feedback, and diagnostics', () => {
  const feedbackDir = makeFeedbackDir();
  const now = Date.now();

  writeJsonl(path.join(feedbackDir, 'audit-trail.jsonl'), [
    {
      id: 'audit_1',
      timestamp: new Date(now - 5000).toISOString(),
      toolName: 'Bash',
      toolInput: { command: 'npm publish', changed_files: ['package.json', 'server.json'] },
      decision: 'deny',
      gateId: 'publish_requires_mainline_head',
      message: 'Publish and tag flows should execute from the protected mainline branch.',
      source: 'gates-engine',
    },
    {
      id: 'audit_2',
      timestamp: new Date(now - 4000).toISOString(),
      toolName: 'Bash',
      toolInput: { command: 'gh pr merge --auto', changed_files: ['README.md'] },
      decision: 'allow',
      source: 'gates-engine',
    },
  ]);

  writeJsonl(path.join(feedbackDir, 'feedback-log.jsonl'), [
    {
      id: 'fb_1',
      timestamp: new Date(now - 3000).toISOString(),
      signal: 'negative',
      context: 'tests were failing and coverage was not verified before claiming success',
      diagnosis: {
        rootCauseCategory: 'tool_output_misread',
        criticalFailureStep: 'verification',
      },
      tags: ['testing', 'verification'],
    },
    {
      id: 'fb_2',
      timestamp: new Date(now - 2000).toISOString(),
      signal: 'positive',
      context: 'verified the proof commands and fixed the release flow',
      tags: ['verification'],
    },
  ]);

  writeJsonl(path.join(feedbackDir, 'diagnostic-log.jsonl'), [
    {
      id: 'diag_1',
      timestamp: new Date(now - 1000).toISOString(),
      source: 'verification_loop',
      step: 'verification',
      context: 'coverage claim mismatched the actual output',
      diagnosis: {
        rootCauseCategory: 'tool_output_misread',
        criticalFailureStep: 'verification',
        violations: [{ constraintId: 'workflow:proof_commands' }],
      },
    },
  ]);

  const { model } = trainAndPersistInterventionPolicy(feedbackDir);
  assert.ok(model.exampleCount >= 4);
  assert.equal(model.modelType, 'multinomial_naive_bayes');

  const summary = getInterventionPolicySummary(feedbackDir);
  assert.equal(summary.enabled, false);
  assert.ok(summary.exampleCount >= 4);
  assert.ok(summary.labelCounts.deny >= 1);
  assert.ok(summary.labelCounts.verify >= 1);
});

test('intervention policy recommends deny for repeated publish failures', () => {
  const feedbackDir = makeFeedbackDir();
  const rows = [];
  for (let index = 0; index < 10; index += 1) {
    rows.push({
      id: `audit_${index}`,
      timestamp: new Date(Date.now() - ((10 - index) * 1000)).toISOString(),
      toolName: 'Bash',
      toolInput: {
        command: 'npm publish',
        changed_files: ['package.json', 'server.json', '.github/workflows/publish-npm.yml'],
      },
      decision: 'deny',
      gateId: 'publish_requires_mainline_head',
      message: 'Publish and tag flows should execute from the protected mainline branch.',
      severity: 'high',
      source: 'gates-engine',
    });
  }
  writeJsonl(path.join(feedbackDir, 'audit-trail.jsonl'), rows);
  writeJsonl(path.join(feedbackDir, 'feedback-log.jsonl'), []);
  writeJsonl(path.join(feedbackDir, 'diagnostic-log.jsonl'), []);

  trainAndPersistInterventionPolicy(feedbackDir);
  const recommendation = getInterventionRecommendation({
    toolName: 'Bash',
    command: 'npm publish',
    affectedFiles: ['package.json', 'server.json', '.github/workflows/publish-npm.yml'],
    memoryGuard: { mode: 'allow', reason: '' },
    integrity: { blockers: [{ code: 'publish_requires_mainline_head' }] },
    blastRadius: {
      severity: 'high',
      surfaceCount: 2,
      releaseSensitiveFiles: ['package.json', 'server.json'],
    },
    protectedSurface: { unapprovedProtectedFiles: [] },
  }, { feedbackDir });

  assert.equal(recommendation.enabled, true);
  assert.equal(recommendation.prediction.label, 'deny');
  assert.ok(recommendation.prediction.confidence > 0.5);
});

test('readJSONL skips malformed intervention rows', () => {
  const feedbackDir = makeFeedbackDir();
  const logPath = path.join(feedbackDir, 'feedback-log.jsonl');
  fs.writeFileSync(logPath, [
    JSON.stringify({ id: 'good_1', signal: 'positive' }),
    '{not-json',
    JSON.stringify({ id: 'good_2', signal: 'negative' }),
  ].join('\n') + '\n');

  const rows = readJSONL(logPath);
  assert.deepEqual(rows.map((row) => row.id), ['good_1', 'good_2']);
});

test('intervention policy ignores unsupported audit decisions during example extraction', () => {
  const feedbackDir = makeFeedbackDir();
  writeJsonl(path.join(feedbackDir, 'audit-trail.jsonl'), [
    {
      id: 'audit_noop',
      timestamp: new Date().toISOString(),
      toolName: 'Bash',
      toolInput: { command: 'echo noop' },
      decision: 'noop',
      source: 'gates-engine',
    },
  ]);

  const { examples, sourceCounts } = buildExamplesFromFeedbackDir(feedbackDir);
  assert.equal(examples.length, 0);
  assert.equal(sourceCounts.audit, 0);
});

test('intervention policy learns from decision overrides and rollbacks', () => {
  const feedbackDir = makeFeedbackDir();
  writeJsonl(path.join(feedbackDir, 'decision-journal.jsonl'), [
    {
      recordType: 'evaluation',
      actionId: 'decision_1',
      timestamp: '2026-04-09T12:00:00.000Z',
      toolName: 'Bash',
      toolInput: { command: 'npm publish' },
      changedFiles: ['package.json', 'server.json'],
      recommendation: {
        decision: 'warn',
        executionMode: 'checkpoint_required',
        decisionOwner: 'human',
        reversibility: 'one_way_door',
        riskBand: 'high',
      },
      blastRadius: {
        severity: 'high',
        fileCount: 2,
        surfaceCount: 2,
      },
    },
    {
      recordType: 'outcome',
      actionId: 'decision_1',
      timestamp: '2026-04-09T12:06:00.000Z',
      outcome: 'overridden',
      actualDecision: 'warn',
      actor: 'human',
      notes: 'Manual checkpoint required before release.',
    },
    {
      recordType: 'evaluation',
      actionId: 'decision_2',
      timestamp: '2026-04-09T13:00:00.000Z',
      toolName: 'Bash',
      toolInput: { command: 'gh pr merge --admin' },
      changedFiles: ['package.json'],
      recommendation: {
        decision: 'deny',
        executionMode: 'blocked',
        decisionOwner: 'human',
        reversibility: 'one_way_door',
        riskBand: 'very_high',
      },
      blastRadius: {
        severity: 'critical',
        fileCount: 1,
        surfaceCount: 1,
      },
    },
    {
      recordType: 'outcome',
      actionId: 'decision_2',
      timestamp: '2026-04-09T13:03:00.000Z',
      outcome: 'rolled_back',
      actualDecision: 'deny',
      actor: 'system',
      notes: 'Decision reversed after governance check.',
    },
  ]);

  const { examples, sourceCounts } = buildExamplesFromFeedbackDir(feedbackDir);
  assert.equal(sourceCounts.decision, 2);
  assert.ok(examples.some((example) => example.source === 'decision' && example.label === 'warn'));
  assert.ok(examples.some((example) => example.source === 'decision' && example.label === 'deny'));
});

test('intervention policy summary falls back when the persisted model is invalid JSON', () => {
  const feedbackDir = makeFeedbackDir();
  const now = Date.now();
  writeJsonl(path.join(feedbackDir, 'feedback-log.jsonl'), Array.from({ length: 8 }, (_, index) => ({
    id: `fb_${index}`,
    timestamp: new Date(now - ((8 - index) * 1000)).toISOString(),
    signal: index % 2 === 0 ? 'negative' : 'positive',
    context: index % 2 === 0
      ? 'tests were failing and coverage was not verified before claiming success'
      : 'verified the proof commands and fixed the release flow',
    diagnosis: index % 2 === 0 ? {
      rootCauseCategory: 'tool_output_misread',
      criticalFailureStep: 'verification',
    } : null,
    tags: ['testing', 'verification'],
  })));
  fs.writeFileSync(path.join(feedbackDir, 'intervention-policy.json'), '{broken-json');

  const summary = getInterventionPolicySummary(feedbackDir);
  assert.equal(summary.exampleCount, 8);
  assert.equal(summary.enabled, true);
});

test('intervention policy CLI trains and prints the model path', () => {
  const feedbackDir = makeFeedbackDir();
  const now = Date.now();
  writeJsonl(path.join(feedbackDir, 'audit-trail.jsonl'), Array.from({ length: 8 }, (_, index) => ({
    id: `audit_${index}`,
    timestamp: new Date(now - ((8 - index) * 1000)).toISOString(),
    toolName: 'Bash',
    toolInput: {
      command: 'npm publish',
      changed_files: ['package.json', 'server.json'],
    },
    decision: 'deny',
    gateId: 'publish_requires_mainline_head',
    source: 'gates-engine',
  })));

  const cliPath = path.join(__dirname, '..', 'scripts', 'intervention-policy.js');
  const { execFileSync } = require('node:child_process');
  const output = execFileSync(process.execPath, [cliPath, feedbackDir], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
  });

  const parsed = JSON.parse(output);
  assert.equal(parsed.model.modelType, 'multinomial_naive_bayes');
  assert.match(parsed.modelPath, /intervention-policy\.json$/);
});
