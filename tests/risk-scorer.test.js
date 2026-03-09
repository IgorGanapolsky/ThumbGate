'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  trainRiskModel,
  predictRisk,
  saveRiskModel,
  loadRiskModel,
  trainAndPersistRiskModel,
} = require('../scripts/risk-scorer');

function makeSequenceRow(overrides = {}) {
  return {
    id: `seq_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    targetReward: 1,
    targetTags: ['testing'],
    accepted: true,
    actionType: 'store-learning',
    context: 'ran tests and included logs',
    skill: 'verification',
    domain: 'testing',
    outcomeCategory: 'standard-success',
    filePathCount: 1,
    errorType: null,
    rubric: {
      weightedScore: 0.9,
      failingCriteria: [],
      failingGuardrails: [],
      judgeDisagreements: [],
    },
    targetRisk: 0,
    riskLabel: 'low-risk',
    features: {
      rewardSequence: [1, 1, 1],
      recentTrend: 1,
      timeGaps: [3, 4],
      actionPatterns: {
        testing: { positive: 3, negative: 0 },
      },
    },
    label: 'positive',
    ...overrides,
  };
}

test('trainRiskModel ranks clearly negative-like row above positive-like row', () => {
  const rows = [
    makeSequenceRow(),
    makeSequenceRow(),
    makeSequenceRow(),
    makeSequenceRow({
      targetReward: -1,
      targetTags: ['debugging', 'verification'],
      accepted: false,
      actionType: 'no-action',
      context: 'skipped tests and missing logs caused failure',
      skill: 'debugging',
      domain: 'debugging',
      rubric: {
        weightedScore: 0.2,
        failingCriteria: ['verification_evidence'],
        failingGuardrails: ['testsPassed'],
        judgeDisagreements: [],
      },
      targetRisk: 1,
      riskLabel: 'high-risk',
      features: {
        rewardSequence: [1, -1, -1],
        recentTrend: -0.33,
        timeGaps: [12, 18],
        actionPatterns: {
          debugging: { positive: 0, negative: 3 },
        },
      },
      label: 'negative',
    }),
    makeSequenceRow({
      targetReward: -1,
      targetTags: ['verification'],
      accepted: false,
      actionType: 'no-action',
      context: 'error due to missing proof and skipped verification',
      skill: 'verification',
      domain: 'testing',
      rubric: {
        weightedScore: 0.25,
        failingCriteria: ['verification_evidence'],
        failingGuardrails: ['testsPassed'],
        judgeDisagreements: [],
      },
      targetRisk: 1,
      riskLabel: 'high-risk',
      features: {
        rewardSequence: [-1, -1, 1],
        recentTrend: -0.33,
        timeGaps: [10, 16],
        actionPatterns: {
          verification: { positive: 0, negative: 2 },
        },
      },
      label: 'negative',
    }),
    makeSequenceRow({
      targetReward: -1,
      targetTags: ['security'],
      accepted: false,
      actionType: 'store-mistake',
      context: 'unsafe path and security risk caused rejection',
      skill: 'security',
      domain: 'security',
      rubric: {
        weightedScore: 0.3,
        failingCriteria: ['safety'],
        failingGuardrails: ['pathSafety'],
        judgeDisagreements: [],
      },
      targetRisk: 1,
      riskLabel: 'high-risk',
      features: {
        rewardSequence: [-1, -1, -1],
        recentTrend: -1,
        timeGaps: [20, 22],
        actionPatterns: {
          security: { positive: 0, negative: 3 },
        },
      },
      label: 'negative',
    }),
  ];

  const model = trainRiskModel(rows);
  const safePrediction = predictRisk(model, makeSequenceRow());
  const riskyPrediction = predictRisk(model, rows[rows.length - 1]);

  assert.equal(model.metrics.mode, 'boosted');
  assert.ok(riskyPrediction.probability > safePrediction.probability, 'risky row should score above safe row');
  assert.equal(riskyPrediction.label, 'high-risk');
});

test('saved risk model reloads and predicts consistently', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'risk-model-'));
  try {
    const rows = [
      makeSequenceRow(),
      makeSequenceRow(),
      makeSequenceRow({ targetRisk: 1, accepted: false, label: 'negative', context: 'missing logs and failed test evidence', rubric: { weightedScore: 0.2, failingCriteria: ['verification_evidence'], failingGuardrails: ['testsPassed'], judgeDisagreements: [] } }),
      makeSequenceRow({ targetRisk: 1, accepted: false, label: 'negative', context: 'unsafe path caused error', domain: 'security', rubric: { weightedScore: 0.3, failingCriteria: ['safety'], failingGuardrails: ['pathSafety'], judgeDisagreements: [] } }),
      makeSequenceRow({ targetRisk: 1, accepted: false, label: 'negative', context: 'regression and skipped tests', domain: 'debugging', rubric: { weightedScore: 0.25, failingCriteria: ['correctness'], failingGuardrails: ['testsPassed'], judgeDisagreements: [] } }),
      makeSequenceRow(),
    ];
    const model = trainRiskModel(rows);
    const modelPath = saveRiskModel(model, tmpDir);
    const reloaded = loadRiskModel(tmpDir);

    assert.ok(fs.existsSync(modelPath), 'risk model file should exist');
    assert.equal(reloaded.metrics.mode, model.metrics.mode);

    const probe = makeSequenceRow({ context: 'missing logs and failed test evidence', accepted: false, targetRisk: 1, label: 'negative' });
    const original = predictRisk(model, probe);
    const restored = predictRisk(reloaded, probe);
    assert.equal(restored.label, original.label);
    assert.equal(restored.probability, original.probability);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('trainAndPersistRiskModel writes a file-based artifact from sequence log', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'risk-train-'));
  try {
    const sequencePath = path.join(tmpDir, 'feedback-sequences.jsonl');
    const rows = [
      makeSequenceRow(),
      makeSequenceRow(),
      makeSequenceRow({ targetRisk: 1, accepted: false, label: 'negative', context: 'missing logs and failed test evidence', rubric: { weightedScore: 0.2, failingCriteria: ['verification_evidence'], failingGuardrails: ['testsPassed'], judgeDisagreements: [] } }),
      makeSequenceRow({ targetRisk: 1, accepted: false, label: 'negative', context: 'unsafe path caused error', domain: 'security', rubric: { weightedScore: 0.3, failingCriteria: ['safety'], failingGuardrails: ['pathSafety'], judgeDisagreements: [] } }),
      makeSequenceRow({ targetRisk: 1, accepted: false, label: 'negative', context: 'regression and skipped tests', domain: 'debugging', rubric: { weightedScore: 0.25, failingCriteria: ['correctness'], failingGuardrails: ['testsPassed'], judgeDisagreements: [] } }),
      makeSequenceRow(),
    ];

    fs.writeFileSync(sequencePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);

    const { model, modelPath } = trainAndPersistRiskModel(tmpDir);
    assert.ok(fs.existsSync(modelPath), 'trainAndPersistRiskModel should write risk-model.json');
    assert.equal(model.exampleCount, rows.length);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
