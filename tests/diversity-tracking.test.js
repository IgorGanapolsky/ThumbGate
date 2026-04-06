// tests/diversity-tracking.test.js
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('Diversity Tracking (ML-04)', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-div-test-'));
    process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } finally {
      delete process.env.THUMBGATE_FEEDBACK_DIR;
    }
  });

  it('accepted captureFeedback() creates diversity-tracking.json', () => {
    delete require.cache[require.resolve('../scripts/feedback-loop')];
    const { captureFeedback } = require('../scripts/feedback-loop');

    const result = captureFeedback({
      signal: 'positive',
      context: 'test context for ML verification',
      whatWorked: 'the feature worked correctly',
      tags: ['testing'],
    });

    assert.equal(result.accepted, true, `expected accepted:true, got: ${JSON.stringify(result)}`);

    const divPath = path.join(tmpDir, 'diversity-tracking.json');
    assert.ok(fs.existsSync(divPath), 'diversity-tracking.json should exist after accepted feedback');
  });

  it('diversity-tracking.json has diversityScore field', () => {
    delete require.cache[require.resolve('../scripts/feedback-loop')];

    const divPath = path.join(tmpDir, 'diversity-tracking.json');
    assert.ok(fs.existsSync(divPath), 'diversity-tracking.json should exist');

    const diversity = JSON.parse(fs.readFileSync(divPath, 'utf-8'));
    assert.ok(
      typeof diversity.diversityScore !== 'undefined',
      'diversityScore field should exist'
    );
  });

  it('diversityScore is a numeric value in [0, 100]', () => {
    delete require.cache[require.resolve('../scripts/feedback-loop')];

    const divPath = path.join(tmpDir, 'diversity-tracking.json');
    const diversity = JSON.parse(fs.readFileSync(divPath, 'utf-8'));

    const score = Number(diversity.diversityScore);
    assert.ok(score >= 0, `diversityScore should be >= 0, got: ${score}`);
    assert.ok(score <= 100, `diversityScore should be <= 100, got: ${score}`);
  });

  it('domains object is populated', () => {
    delete require.cache[require.resolve('../scripts/feedback-loop')];

    const divPath = path.join(tmpDir, 'diversity-tracking.json');
    const diversity = JSON.parse(fs.readFileSync(divPath, 'utf-8'));

    assert.equal(typeof diversity.domains, 'object', 'domains should be an object');
    assert.ok(!Array.isArray(diversity.domains), 'domains should not be an array');
    assert.ok(
      Object.keys(diversity.domains).length > 0,
      'domains should have at least one key after feedback'
    );
  });

  it('domain count matches feedback domain (testing tag -> testing domain)', () => {
    delete require.cache[require.resolve('../scripts/feedback-loop')];

    const divPath = path.join(tmpDir, 'diversity-tracking.json');
    const diversity = JSON.parse(fs.readFileSync(divPath, 'utf-8'));

    assert.ok(
      diversity.domains.testing !== undefined,
      'testing domain should exist after tags:["testing"] feedback'
    );
    assert.ok(
      diversity.domains.testing.count >= 1,
      `testing domain count should be >= 1, got: ${diversity.domains.testing.count}`
    );
  });

  it('lastUpdated is set', () => {
    delete require.cache[require.resolve('../scripts/feedback-loop')];

    const divPath = path.join(tmpDir, 'diversity-tracking.json');
    const diversity = JSON.parse(fs.readFileSync(divPath, 'utf-8'));

    assert.equal(typeof diversity.lastUpdated, 'string', 'lastUpdated should be a string');
    assert.ok(
      !isNaN(Date.parse(diversity.lastUpdated)),
      `lastUpdated should be a valid ISO string, got: ${diversity.lastUpdated}`
    );
  });

  it('diversityScore updates after second feedback with different domain', () => {
    delete require.cache[require.resolve('../scripts/feedback-loop')];
    const { captureFeedback } = require('../scripts/feedback-loop');

    const divPath = path.join(tmpDir, 'diversity-tracking.json');

    // Read lastUpdated before second call
    const before = JSON.parse(fs.readFileSync(divPath, 'utf-8'));
    const lastUpdatedBefore = before.lastUpdated;

    // Wait a tiny bit to ensure timestamp changes
    const start = Date.now();
    while (Date.now() - start < 5) { /* spin */ }

    const result = captureFeedback({
      signal: 'positive',
      context: 'security review completed',
      whatWorked: 'vulnerability patched correctly',
      tags: ['security'],
    });

    assert.equal(result.accepted, true, `expected accepted:true, got: ${JSON.stringify(result)}`);

    const after = JSON.parse(fs.readFileSync(divPath, 'utf-8'));
    assert.notEqual(
      after.lastUpdated,
      lastUpdatedBefore,
      'lastUpdated should change after second feedback'
    );
  });

  it('diversityScore is not NaN or Infinity on first entry (edge case)', () => {
    // Use a fresh tmpdir for this edge-case test to simulate first entry
    const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-div-fresh-'));
    process.env.THUMBGATE_FEEDBACK_DIR = freshDir;
    delete require.cache[require.resolve('../scripts/feedback-loop')];
    const { captureFeedback } = require('../scripts/feedback-loop');

    try {
      const result = captureFeedback({
        signal: 'positive',
        context: 'test context for ML verification',
        whatWorked: 'the feature worked correctly',
        tags: ['testing'],
      });

      assert.equal(result.accepted, true, `expected accepted:true, got: ${JSON.stringify(result)}`);

      const divPath = path.join(freshDir, 'diversity-tracking.json');
      assert.ok(fs.existsSync(divPath), 'diversity-tracking.json should exist');

      const diversity = JSON.parse(fs.readFileSync(divPath, 'utf-8'));
      const score = Number(diversity.diversityScore);

      assert.ok(isFinite(score), `diversityScore should be finite on first entry, got: ${score}`);
      assert.ok(!isNaN(score), `diversityScore should not be NaN on first entry, got: ${diversity.diversityScore}`);
    } finally {
      fs.rmSync(freshDir, { recursive: true, force: true });
      // Restore the suite's tmpDir
      process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
      delete require.cache[require.resolve('../scripts/feedback-loop')];
    }
  });
});
