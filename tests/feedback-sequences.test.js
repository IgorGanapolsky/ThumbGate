// tests/feedback-sequences.test.js
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('Sequence Tracking (ML-03)', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-seq-test-'));
    process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } finally {
      delete process.env.THUMBGATE_FEEDBACK_DIR;
    }
  });

  it('accepted captureFeedback() creates feedback-sequences.jsonl', () => {
    // Re-require to pick up env var set in before()
    delete require.cache[require.resolve('../scripts/feedback-loop')];
    const { captureFeedback } = require('../scripts/feedback-loop');

    const result = captureFeedback({
      signal: 'positive',
      context: 'test context for ML verification',
      whatWorked: 'the feature worked correctly',
      tags: ['testing'],
    });

    assert.equal(result.accepted, true, `expected accepted:true, got: ${JSON.stringify(result)}`);

    const seqPath = path.join(tmpDir, 'feedback-sequences.jsonl');
    assert.ok(fs.existsSync(seqPath), 'feedback-sequences.jsonl should exist after accepted feedback');
  });

  it('sequence entry has correct schema', () => {
    delete require.cache[require.resolve('../scripts/feedback-loop')];
    const { captureFeedback } = require('../scripts/feedback-loop');

    captureFeedback({
      signal: 'positive',
      context: 'test context for ML verification',
      whatWorked: 'the feature worked correctly',
      tags: ['testing'],
    });

    const seqPath = path.join(tmpDir, 'feedback-sequences.jsonl');
    const lines = fs.readFileSync(seqPath, 'utf-8').trim().split('\n').filter(Boolean);
    const entry = JSON.parse(lines[lines.length - 1]);

    assert.equal(typeof entry.id, 'string', 'id should be a string');
    assert.ok(entry.id.startsWith('seq_'), `id should start with seq_, got: ${entry.id}`);
    assert.equal(typeof entry.timestamp, 'string', 'timestamp should be a string');
    assert.ok(!isNaN(Date.parse(entry.timestamp)), 'timestamp should be a valid ISO string');
    assert.equal(typeof entry.targetReward, 'number', 'targetReward should be a number');
    assert.ok(Array.isArray(entry.targetTags), 'targetTags should be an array');
    assert.equal(typeof entry.accepted, 'boolean', 'accepted should be a boolean');
    assert.equal(typeof entry.context, 'string', 'context should be a string');
    assert.equal(typeof entry.domain, 'string', 'domain should be a string');
    assert.equal(typeof entry.outcomeCategory, 'string', 'outcomeCategory should be a string');
    assert.equal(typeof entry.targetRisk, 'number', 'targetRisk should be a number');
    assert.equal(typeof entry.features, 'object', 'features should be an object');
    assert.equal(typeof entry.label, 'string', 'label should be a string');
  });

  it('targetReward is 1 for positive signal', () => {
    delete require.cache[require.resolve('../scripts/feedback-loop')];
    const { captureFeedback } = require('../scripts/feedback-loop');

    captureFeedback({
      signal: 'positive',
      context: 'test context for ML verification',
      whatWorked: 'the feature worked correctly',
      tags: ['testing'],
    });

    const seqPath = path.join(tmpDir, 'feedback-sequences.jsonl');
    const lines = fs.readFileSync(seqPath, 'utf-8').trim().split('\n').filter(Boolean);
    const entry = JSON.parse(lines[lines.length - 1]);

    assert.equal(entry.targetReward, 1, 'targetReward should be 1 for positive signal');
    assert.equal(entry.label, 'positive', 'label should be positive');
  });

  it('targetReward is -1 for negative signal', () => {
    delete require.cache[require.resolve('../scripts/feedback-loop')];
    const { captureFeedback } = require('../scripts/feedback-loop');

    const result = captureFeedback({
      signal: 'negative',
      context: 'test context',
      whatWentWrong: 'something failed',
      whatToChange: 'fix the issue',
      tags: ['debugging'],
    });

    assert.equal(result.accepted, true, `expected accepted:true, got: ${JSON.stringify(result)}`);

    const seqPath = path.join(tmpDir, 'feedback-sequences.jsonl');
    const lines = fs.readFileSync(seqPath, 'utf-8').trim().split('\n').filter(Boolean);
    const entry = JSON.parse(lines[lines.length - 1]);

    assert.equal(entry.targetReward, -1, 'targetReward should be -1 for negative signal');
    assert.equal(entry.label, 'negative', 'label should be negative');
  });

  it('features.rewardSequence is an array', () => {
    delete require.cache[require.resolve('../scripts/feedback-loop')];
    const { captureFeedback } = require('../scripts/feedback-loop');

    captureFeedback({
      signal: 'positive',
      context: 'test context for ML verification',
      whatWorked: 'the feature worked correctly',
      tags: ['testing'],
    });

    const seqPath = path.join(tmpDir, 'feedback-sequences.jsonl');
    const lines = fs.readFileSync(seqPath, 'utf-8').trim().split('\n').filter(Boolean);
    const entry = JSON.parse(lines[lines.length - 1]);

    assert.ok(Array.isArray(entry.features.rewardSequence), 'features.rewardSequence should be an array');
  });

  it('features.tagFrequency is an object', () => {
    delete require.cache[require.resolve('../scripts/feedback-loop')];
    const { captureFeedback } = require('../scripts/feedback-loop');

    captureFeedback({
      signal: 'positive',
      context: 'test context for ML verification',
      whatWorked: 'the feature worked correctly',
      tags: ['testing'],
    });

    const seqPath = path.join(tmpDir, 'feedback-sequences.jsonl');
    const lines = fs.readFileSync(seqPath, 'utf-8').trim().split('\n').filter(Boolean);
    const entry = JSON.parse(lines[lines.length - 1]);

    assert.equal(typeof entry.features.tagFrequency, 'object', 'features.tagFrequency should be an object');
    assert.ok(!Array.isArray(entry.features.tagFrequency), 'features.tagFrequency should not be an array');
  });

  it('invalid signal does NOT create sequence entry', () => {
    delete require.cache[require.resolve('../scripts/feedback-loop')];
    const { captureFeedback } = require('../scripts/feedback-loop');

    // Count lines before
    const seqPath = path.join(tmpDir, 'feedback-sequences.jsonl');
    const linesBefore = fs.existsSync(seqPath)
      ? fs.readFileSync(seqPath, 'utf-8').trim().split('\n').filter(Boolean).length
      : 0;

    const result = captureFeedback({ signal: 'invalid_signal_xyz' });
    assert.equal(result.accepted, false, 'should be rejected with invalid signal');

    const linesAfter = fs.existsSync(seqPath)
      ? fs.readFileSync(seqPath, 'utf-8').trim().split('\n').filter(Boolean).length
      : 0;

    assert.equal(linesAfter, linesBefore, 'invalid signal should not add sequence entry');
  });

  it('rubric-blocked positive capture still creates a training row with high-risk label', () => {
    delete require.cache[require.resolve('../scripts/feedback-loop')];
    const { captureFeedback } = require('../scripts/feedback-loop');

    const seqPath = path.join(tmpDir, 'feedback-sequences.jsonl');
    const linesBefore = fs.existsSync(seqPath)
      ? fs.readFileSync(seqPath, 'utf-8').trim().split('\n').filter(Boolean).length
      : 0;

    const result = captureFeedback({
      signal: 'positive',
      context: 'claimed success without logs',
      whatWorked: 'Reviewer approved despite missing logs',
      tags: ['verification'],
      rubricScores: [
        { criterion: 'verification_evidence', score: 5, judge: 'judge-a' },
        { criterion: 'verification_evidence', score: 2, judge: 'judge-b', evidence: 'missing logs' },
      ],
      guardrails: {
        testsPassed: false,
        pathSafety: true,
        budgetCompliant: true,
      },
    });

    assert.equal(result.accepted, false, 'rubric-blocked capture should not be promoted');

    const linesAfter = fs.readFileSync(seqPath, 'utf-8').trim().split('\n').filter(Boolean);
    assert.equal(linesAfter.length, linesBefore + 1, 'blocked capture should still add a sequence entry');

    const entry = JSON.parse(linesAfter[linesAfter.length - 1]);
    assert.equal(entry.accepted, false);
    assert.equal(entry.riskLabel, 'high-risk');
    assert.equal(entry.targetRisk, 1);
    assert.equal(entry.actionType, 'no-action');
  });

  it('multiple accepted calls append multiple sequence entries', () => {
    delete require.cache[require.resolve('../scripts/feedback-loop')];
    const { captureFeedback } = require('../scripts/feedback-loop');

    // Count lines before
    const seqPath = path.join(tmpDir, 'feedback-sequences.jsonl');
    const linesBefore = fs.existsSync(seqPath)
      ? fs.readFileSync(seqPath, 'utf-8').trim().split('\n').filter(Boolean).length
      : 0;

    for (let i = 0; i < 3; i++) {
      const result = captureFeedback({
        signal: 'positive',
        context: `test context for ML verification call ${i}`,
        whatWorked: 'the feature worked correctly',
        tags: ['testing'],
      });
      assert.equal(result.accepted, true, `call ${i} should be accepted`);
    }

    const linesAfter = fs.readFileSync(seqPath, 'utf-8').trim().split('\n').filter(Boolean).length;
    assert.equal(linesAfter, linesBefore + 3, 'should have 3 more sequence entries after 3 accepted calls');
  });
});
