'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

function freshModule(tmpDir) {
  if (tmpDir) process.env.RLHF_FEEDBACK_DIR = tmpDir;
  delete require.cache[require.resolve('../scripts/disagreement-mining')];
  delete require.cache[require.resolve('../scripts/thompson-sampling')];
  delete require.cache[require.resolve('../scripts/feedback-loop')];
  delete require.cache[require.resolve('../scripts/export-dpo-pairs')];
  return require('../scripts/disagreement-mining');
}

function writeThompsonModel(tmpDir, categories) {
  const model = {
    version: 1,
    created: '2026-03-09T00:00:00Z',
    updated: '2026-03-09T00:00:00Z',
    total_entries: 10,
    categories: {
      uncategorized: { alpha: 1, beta: 1, samples: 0, last_updated: null },
      ...categories,
    },
  };
  fs.writeFileSync(
    path.join(tmpDir, 'feedback_model.json'),
    JSON.stringify(model, null, 2),
    'utf-8'
  );
}

function appendJSONL(filePath, record) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(record) + '\n');
}

describe('mineDisagreements()', () => {
  it('returns empty disagreements when no feedback exists', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'disagree-test-'));
    try {
      const { mineDisagreements } = freshModule(tmpDir);
      const result = mineDisagreements({ feedbackDir: tmpDir });
      assert.ok(Array.isArray(result.disagreements), 'disagreements must be an array');
      assert.strictEqual(result.disagreements.length, 0, 'expected 0 disagreements');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      delete process.env.RLHF_FEEDBACK_DIR;
    }
  });

  it('detects disagreement when model predicts high but user gave negative', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'disagree-test-'));
    try {
      writeThompsonModel(tmpDir, {
        testing: { alpha: 10, beta: 1, samples: 11, last_updated: '2026-03-09T00:00:00Z' },
      });
      appendJSONL(path.join(tmpDir, 'feedback-log.jsonl'), {
        id: 'fb_test_1',
        signal: 'negative',
        context: 'Claimed done without running tests',
        tags: ['testing'],
        timestamp: '2026-03-09T00:00:00Z',
        actionType: 'log-and-store',
        skill: 'executor',
      });

      const { mineDisagreements } = freshModule(tmpDir);
      const result = mineDisagreements({ feedbackDir: tmpDir });
      assert.ok(result.disagreements.length >= 1, `expected >= 1 disagreement, got ${result.disagreements.length}`);

      const d = result.disagreements[0];
      assert.ok(d.feedbackId, 'disagreement must have feedbackId');
      assert.ok(d.domain, 'disagreement must have domain');
      assert.ok(typeof d.categoryReliability === 'number', 'disagreement must have numeric categoryReliability');
      assert.strictEqual(d.signal, 'negative', 'signal should be negative');
      assert.ok(d.disagreementStrength > 0, `disagreementStrength should be > 0, got ${d.disagreementStrength}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      delete process.env.RLHF_FEEDBACK_DIR;
    }
  });

  it('detects disagreement when model predicts low but user gave positive', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'disagree-test-'));
    try {
      writeThompsonModel(tmpDir, {
        security: { alpha: 1, beta: 10, samples: 11, last_updated: '2026-03-09T00:00:00Z' },
      });
      appendJSONL(path.join(tmpDir, 'feedback-log.jsonl'), {
        id: 'fb_test_2',
        signal: 'positive',
        context: 'Security review passed',
        tags: ['security'],
        timestamp: '2026-03-09T00:00:00Z',
        actionType: 'log-and-store',
        skill: 'executor',
      });

      const { mineDisagreements } = freshModule(tmpDir);
      const result = mineDisagreements({ feedbackDir: tmpDir });
      assert.ok(result.disagreements.length >= 1, `expected >= 1 disagreement, got ${result.disagreements.length}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      delete process.env.RLHF_FEEDBACK_DIR;
    }
  });

  it('no disagreement when model and signal agree', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'disagree-test-'));
    try {
      writeThompsonModel(tmpDir, {
        testing: { alpha: 10, beta: 1, samples: 11, last_updated: '2026-03-09T00:00:00Z' },
      });
      appendJSONL(path.join(tmpDir, 'feedback-log.jsonl'), {
        id: 'fb_test_3',
        signal: 'positive',
        context: 'All tests passed successfully',
        tags: ['testing'],
        timestamp: '2026-03-09T00:00:00Z',
        actionType: 'log-and-store',
        skill: 'executor',
      });

      const { mineDisagreements } = freshModule(tmpDir);
      const result = mineDisagreements({ feedbackDir: tmpDir });
      assert.strictEqual(result.disagreements.length, 0, `expected 0 disagreements, got ${result.disagreements.length}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      delete process.env.RLHF_FEEDBACK_DIR;
    }
  });

  it('stats include total, disagreementCount, rate', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'disagree-test-'));
    try {
      writeThompsonModel(tmpDir, {
        testing: { alpha: 10, beta: 1, samples: 11, last_updated: '2026-03-09T00:00:00Z' },
      });
      appendJSONL(path.join(tmpDir, 'feedback-log.jsonl'), {
        id: 'fb_test_4',
        signal: 'positive',
        context: 'Tests passed',
        tags: ['testing'],
        timestamp: '2026-03-09T00:00:00Z',
        actionType: 'log-and-store',
        skill: 'executor',
      });

      const { mineDisagreements } = freshModule(tmpDir);
      const result = mineDisagreements({ feedbackDir: tmpDir });
      assert.ok(result.stats, 'result must have stats');
      assert.ok('totalEvents' in result.stats, 'stats must have totalEvents');
      assert.ok('disagreementCount' in result.stats, 'stats must have disagreementCount');
      assert.ok('disagreementRate' in result.stats, 'stats must have disagreementRate');
      assert.ok(typeof result.stats.disagreementRate === 'number', 'rate must be a number');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      delete process.env.RLHF_FEEDBACK_DIR;
    }
  });
});

describe('amplifyFromDisagreements()', () => {
  it('returns empty array for empty disagreements', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'disagree-test-'));
    try {
      const { amplifyFromDisagreements } = freshModule(tmpDir);
      const pairs = amplifyFromDisagreements([]);
      assert.ok(Array.isArray(pairs), 'must return array');
      assert.strictEqual(pairs.length, 0, 'expected 0 pairs');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      delete process.env.RLHF_FEEDBACK_DIR;
    }
  });

  it('generates DPO pair for each disagreement', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'disagree-test-'));
    try {
      const { amplifyFromDisagreements } = freshModule(tmpDir);
      const mockDisagreements = [
        {
          feedbackId: 'fb_1',
          domain: 'testing',
          category: 'testing',
          categoryReliability: 0.9,
          signal: 'negative',
          context: 'Claimed done without tests',
          disagreementType: 'model_overconfident',
          disagreementStrength: 0.3,
          tags: ['testing'],
        },
        {
          feedbackId: 'fb_2',
          domain: 'security',
          category: 'security',
          categoryReliability: 0.1,
          signal: 'positive',
          context: 'Security review passed',
          disagreementType: 'model_underconfident',
          disagreementStrength: 0.3,
          tags: ['security'],
        },
      ];
      const pairs = amplifyFromDisagreements(mockDisagreements);
      assert.strictEqual(pairs.length, 2, `expected 2 pairs, got ${pairs.length}`);

      for (const pair of pairs) {
        assert.ok(typeof pair.prompt === 'string', 'pair must have string prompt');
        assert.ok(typeof pair.chosen === 'string', 'pair must have string chosen');
        assert.ok(typeof pair.rejected === 'string', 'pair must have string rejected');
        assert.ok(pair.metadata, 'pair must have metadata');
        assert.strictEqual(pair.metadata.amplified, true, 'metadata.amplified must be true');
        assert.ok(typeof pair.metadata.disagreementStrength === 'number', 'metadata must have disagreementStrength');
        assert.ok(typeof pair.metadata.domain === 'string', 'metadata must have domain');
        assert.ok(typeof pair.metadata.originalFeedbackId === 'string', 'metadata must have originalFeedbackId');
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      delete process.env.RLHF_FEEDBACK_DIR;
    }
  });
});

describe('calibratePreventionRules()', () => {
  it('returns empty when no error memories exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'disagree-test-'));
    try {
      const { calibratePreventionRules } = freshModule(tmpDir);
      const result = calibratePreventionRules(tmpDir);
      assert.ok(Array.isArray(result.calibratedRules), 'calibratedRules must be an array');
      assert.strictEqual(result.calibratedRules.length, 0, 'expected 0 calibratedRules');
      assert.strictEqual(result.concordanceRate, 1, 'concordanceRate should be 1 (vacuous)');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      delete process.env.RLHF_FEEDBACK_DIR;
    }
  });

  it('keeps rules where model agrees with user (concordance)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'disagree-test-'));
    try {
      // inferDomain(['testing']) → 'testing' → domainToCategory → 'testing'
      writeThompsonModel(tmpDir, {
        testing: { alpha: 1, beta: 5, samples: 6, last_updated: '2026-03-09T00:00:00Z' },
      });
      appendJSONL(path.join(tmpDir, 'memory-log.jsonl'), {
        id: 'mem_err_1',
        category: 'error',
        title: 'MISTAKE: Claimed done without test proof',
        content: 'Claimed completion without running tests.',
        tags: ['testing', 'feedback'],
        timestamp: '2026-03-09T00:00:00Z',
      });

      const { calibratePreventionRules } = freshModule(tmpDir);
      const result = calibratePreventionRules(tmpDir);
      assert.ok(result.calibratedRules.length >= 1, `expected >= 1 calibratedRules, got ${result.calibratedRules.length}`);
      assert.ok(result.concordanceRate > 0, `concordanceRate should be > 0, got ${result.concordanceRate}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      delete process.env.RLHF_FEEDBACK_DIR;
    }
  });

  it('drops rules where model disagrees', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'disagree-test-'));
    try {
      writeThompsonModel(tmpDir, {
        testing: { alpha: 10, beta: 1, samples: 11, last_updated: '2026-03-09T00:00:00Z' },
      });
      appendJSONL(path.join(tmpDir, 'memory-log.jsonl'), {
        id: 'mem_err_2',
        category: 'error',
        title: 'MISTAKE: Testing shortcuts taken',
        content: 'Skipped integration tests during deployment.',
        tags: ['testing'],
        timestamp: '2026-03-09T00:00:00Z',
      });

      const { calibratePreventionRules } = freshModule(tmpDir);
      const result = calibratePreventionRules(tmpDir);
      assert.ok(Array.isArray(result.droppedRules), 'droppedRules must be an array');
      const dropped = result.droppedRules.some((r) => r.domain === 'testing');
      assert.ok(dropped, 'testing rule should be in droppedRules when model disagrees');
      assert.ok(result.concordanceRate < 1.0, `concordanceRate should be < 1.0, got ${result.concordanceRate}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      delete process.env.RLHF_FEEDBACK_DIR;
    }
  });
});
