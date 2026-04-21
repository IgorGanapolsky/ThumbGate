'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { analyzeFeedback, captureFeedback } = require('../scripts/feedback-loop');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-remediations-'));
  const prevEnv = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_FEEDBACK_DIR = dir;
  try {
    return fn(dir);
  } finally {
    if (prevEnv == null) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = prevEnv;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('analyzeFeedback returns actionableRemediations array (always present)', () => {
  withTempDir(() => {
    const analysis = analyzeFeedback();
    assert.ok(Array.isArray(analysis.actionableRemediations),
      'actionableRemediations must be an array on empty state');
    assert.equal(analysis.actionableRemediations.length, 0,
      'actionableRemediations should be empty when there is no feedback');
  });
});

test('actionableRemediations emits skill-improve entries for skills with ≥50% negative rate and ≥3 total', () => {
  withTempDir(() => {
    // Seed 3 negative + 0 positive on skill "github"
    for (let i = 0; i < 3; i++) {
      captureFeedback({
        signal: 'down',
        context: `gh fail ${i}`,
        skill: 'github',
      });
    }
    const analysis = analyzeFeedback();
    const skillImprove = analysis.actionableRemediations.find(
      (r) => r.type === 'skill-improve' && r.target === 'github',
    );
    assert.ok(skillImprove, 'expected skill-improve remediation for github');
    assert.equal(skillImprove.action, 'review-and-update-skill');
    assert.equal(skillImprove.evidence.total, 3);
    assert.equal(skillImprove.evidence.negative, 3);
    assert.equal(skillImprove.evidence.negativeRate, 1);
    assert.ok(typeof skillImprove.rationale === 'string' && skillImprove.rationale.length > 0);
  });
});

test('actionableRemediations emits pattern-reuse entries for tags with ≥80% positive rate and ≥3 total', () => {
  withTempDir(() => {
    for (let i = 0; i < 4; i++) {
      captureFeedback({
        signal: 'up',
        context: `positive pattern ${i}`,
        tags: ['thumbgate'],
      });
    }
    const analysis = analyzeFeedback();
    const patternReuse = analysis.actionableRemediations.find(
      (r) => r.type === 'pattern-reuse' && r.target === 'thumbgate',
    );
    assert.ok(patternReuse, 'expected pattern-reuse remediation for thumbgate');
    assert.equal(patternReuse.action, 'replicate-pattern');
    assert.equal(patternReuse.evidence.positive, 4);
    assert.equal(patternReuse.evidence.positiveRate, 1);
  });
});

test('actionableRemediations stays parallel to recommendations — prose count == structured count', () => {
  withTempDir(() => {
    for (let i = 0; i < 3; i++) {
      captureFeedback({ signal: 'down', context: `gh ${i}`, skill: 'github' });
    }
    for (let i = 0; i < 4; i++) {
      captureFeedback({ signal: 'up', context: `tg ${i}`, tags: ['thumbgate'] });
    }
    const analysis = analyzeFeedback();
    // At minimum, every skill-improve / pattern-reuse prose line has a structured counterpart.
    const skillImproveProse = analysis.recommendations.filter((r) => r.startsWith('IMPROVE skill')).length;
    const skillImproveStruct = analysis.actionableRemediations.filter((r) => r.type === 'skill-improve').length;
    assert.equal(skillImproveProse, skillImproveStruct,
      'prose IMPROVE count should equal structured skill-improve count');

    const patternReuseProse = analysis.recommendations.filter((r) => r.startsWith('REUSE pattern')).length;
    const patternReuseStruct = analysis.actionableRemediations.filter((r) => r.type === 'pattern-reuse').length;
    assert.equal(patternReuseProse, patternReuseStruct,
      'prose REUSE count should equal structured pattern-reuse count');
  });
});
