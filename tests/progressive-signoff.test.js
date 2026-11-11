'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULT_CLEAN_RUNS_N,
  DEFAULT_CONFIDENCE_THRESHOLD,
  computeThompsonConfidence,
  loadApprovalGates,
  countCleanRunsFromAuditTrail,
  resolveCleanRunsForGate,
  evaluateProgressiveSignoff,
  formatProgressiveSignoffSection,
} = require('../scripts/progressive-signoff');

const {
  generateAgentReadinessReport,
  reportToText,
} = require('../scripts/agent-readiness');

test('computeThompsonConfidence calculates Beta posterior mean correctly', () => {
  // Uniform prior Beta(1,1):
  // 0 runs: (1+0)/(1+0+1+0) = 0.5
  assert.equal(computeThompsonConfidence(0, 0), 0.5);

  // 19 clean runs: (1+19)/(1+19+1+0) = 20/21 ≈ 0.9524
  const conf19 = computeThompsonConfidence(19, 0);
  assert.ok(Math.abs(conf19 - (20 / 21)) < 1e-4);

  // 20 clean runs: (1+20)/(1+20+1+0) = 21/22 ≈ 0.9545
  const conf20 = computeThompsonConfidence(20, 0);
  assert.ok(Math.abs(conf20 - (21 / 22)) < 1e-4);
  assert.ok(conf20 >= DEFAULT_CONFIDENCE_THRESHOLD);

  // Failures reduce confidence:
  // 20 clean runs, 5 failures: 21/(21+6) = 21/27 ≈ 0.7778
  const confWithFails = computeThompsonConfidence(20, 5);
  assert.ok(confWithFails < 0.80);
});

test('loadApprovalGates filters only gates whose action is approve', () => {
  const sampleGates = [
    { id: 'gate-block', action: 'block' },
    { id: 'gate-warn', action: 'warn' },
    { id: 'gate-approve-1', action: 'approve' },
    { id: 'gate-approve-2', action: 'approve' },
  ];

  const filtered = loadApprovalGates({ gates: sampleGates });
  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].id, 'gate-approve-1');
  assert.equal(filtered[1].id, 'gate-approve-2');
});

test('countCleanRunsFromAuditTrail counts consecutive clean runs and stops on failure', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-audit-streak-'));
  const auditPath = path.join(tmpDir, 'audit-trail.jsonl');

  try {
    // Write audit events:
    // Old failure -> followed by 5 consecutive clean events
    const records = [
      { gateId: 'deploy-gate', decision: 'deny', timestamp: '2026-11-01T10:00:00Z' },
      { gateId: 'deploy-gate', decision: 'approve', timestamp: '2026-11-02T10:00:00Z' },
      { gateId: 'other-gate', decision: 'deny', timestamp: '2026-11-02T11:00:00Z' },
      { gateId: 'deploy-gate', decision: 'allow', timestamp: '2026-11-03T10:00:00Z' },
      { gateId: 'deploy-gate', decision: 'approve', timestamp: '2026-11-04T10:00:00Z' },
      { gateId: 'deploy-gate', decision: 'allow', timestamp: '2026-11-05T10:00:00Z' },
      { gateId: 'deploy-gate', decision: 'allow', timestamp: '2026-11-06T10:00:00Z' },
    ];

    fs.writeFileSync(auditPath, records.map((r) => JSON.stringify(r)).join('\n') + '\n');

    const streak = countCleanRunsFromAuditTrail('deploy-gate', auditPath);
    assert.equal(streak, 5);

    // Now append a failure to break the streak
    fs.appendFileSync(auditPath, JSON.stringify({ gateId: 'deploy-gate', decision: 'deny' }) + '\n');
    const brokenStreak = countCleanRunsFromAuditTrail('deploy-gate', auditPath);
    assert.equal(brokenStreak, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('evaluateProgressiveSignoff recommends downgrade only after N clean runs', () => {
  const sampleGates = [
    { id: 'production-deploy-approval', action: 'approve' },
    { id: 'schema-migration-approval', action: 'approve' },
  ];

  // 19 clean runs on deploy (< 20 threshold), 22 clean runs on schema (>= 20 threshold)
  const result = evaluateProgressiveSignoff({
    gates: sampleGates,
    thresholdN: 20,
    confidenceThreshold: 0.90,
    cleanRunsByGate: {
      'production-deploy-approval': 19,
      'schema-migration-approval': 22,
    },
  });

  assert.equal(result.evaluatedCount, 2);
  assert.equal(result.hasRecommendations, true);
  assert.equal(result.recommendations.length, 1);

  const rec = result.recommendations[0];
  assert.equal(rec.gateId, 'schema-migration-approval');
  assert.equal(rec.currentAction, 'approve');
  assert.equal(rec.recommendedAction, 'warn');
  assert.equal(rec.cleanRuns, 22);
  assert.equal(rec.advisoryOnly, true);
  assert.ok(rec.confidence >= 0.90);
  assert.ok(rec.reason.includes('Passed 22 clean runs in a row'));

  const deployEval = result.evaluatedGates.find((g) => g.gateId === 'production-deploy-approval');
  assert.equal(deployEval.eligibleForDowngrade, false);
  assert.equal(deployEval.cleanRuns, 19);
});

test('evaluateProgressiveSignoff never modifies config files (advisory only)', () => {
  const configPath = path.join(__dirname, '..', 'config', 'gates', 'default.json');
  const beforeStats = fs.statSync(configPath);
  const beforeContent = fs.readFileSync(configPath, 'utf8');

  const result = evaluateProgressiveSignoff({
    thresholdN: 5,
    confidenceThreshold: 0.80,
    cleanRunsByGate: {
      'production-deploy-approval': 50,
      'schema-migration-approval': 50,
      'permission-change-approval': 50,
    },
  });

  assert.ok(result.recommendations.length > 0);
  assert.ok(result.safetyNotice.includes('never be auto-edited'));

  const afterStats = fs.statSync(configPath);
  const afterContent = fs.readFileSync(configPath, 'utf8');

  assert.equal(beforeContent, afterContent, 'Gate configuration must remain strictly unchanged');
  assert.equal(beforeStats.mtimeMs, afterStats.mtimeMs, 'Gate configuration file must not be touched');
});

test('formatProgressiveSignoffSection formats advisory recommendations clearly', () => {
  const report = {
    recommendations: [
      {
        gateId: 'production-deploy-approval',
        cleanRuns: 25,
        confidence: 0.963,
      },
    ],
  };

  const output = formatProgressiveSignoffSection(report);
  assert.ok(output.includes('Progressive Sign-off Recommendations:'));
  assert.ok(output.includes('production-deploy-approval'));
  assert.ok(output.includes('25 clean runs'));
  assert.ok(output.includes('96.3%'));
  assert.ok(output.includes("Recommend downgrade 'approve' -> 'warn'"));
  assert.ok(output.includes('Advisory only — manual config change required'));
});

test('generateAgentReadinessReport includes progressive signoff in text and json', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-readiness-signoff-'));
  try {
    for (const fileName of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) {
      fs.writeFileSync(path.join(projectRoot, fileName), `# ${fileName}\n`);
    }
    fs.writeFileSync(path.join(projectRoot, '.mcp.json'), JSON.stringify({ mcpServers: {} }, null, 2));

    const report = generateAgentReadinessReport({
      projectRoot,
      progressiveSignoff: {
        cleanRunsThreshold: 20,
        cleanRunsByGate: {
          'production-deploy-approval': 24,
        },
        gates: [
          { id: 'production-deploy-approval', action: 'approve' },
        ],
      },
    });

    assert.ok(report.progressiveSignoff);
    assert.equal(report.progressiveSignoff.hasRecommendations, true);
    assert.equal(report.progressiveSignoff.recommendations.length, 1);
    assert.equal(report.progressiveSignoff.recommendations[0].gateId, 'production-deploy-approval');

    const text = reportToText(report);
    assert.ok(text.includes('Progressive Sign-off Recommendations:'));
    assert.ok(text.includes('production-deploy-approval'));
    assert.ok(text.includes('24 clean runs'));
    assert.ok(text.includes('Advisory only'));
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
