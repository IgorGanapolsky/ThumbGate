'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('verification-loop', () => {
  let m;
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vloop-test-'));
    process.env.RLHF_FEEDBACK_DIR = tmpDir;
    delete require.cache[require.resolve('../scripts/verification-loop')];
    m = require('../scripts/verification-loop');
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.RLHF_FEEDBACK_DIR;
  });

  it('exports MAX_RETRIES as 3', () => {
    assert.equal(m.MAX_RETRIES, 3);
  });

  it('exports DEFAULT_MODEL_PATH as a string', () => {
    assert.equal(typeof m.DEFAULT_MODEL_PATH, 'string');
    assert.ok(m.DEFAULT_MODEL_PATH.includes('verification-model.json'));
  });

  it('extractKeywords returns 4+ char words excluding stopwords', () => {
    const kws = m.extractKeywords('this is a test without running verification');
    assert.ok(kws.includes('test'));
    assert.ok(kws.includes('running'));
    assert.ok(kws.includes('verification'));
    assert.ok(!kws.includes('this'));
    assert.ok(!kws.includes('without'));
  });

  it('extractKeywords returns empty array for empty string', () => {
    assert.deepEqual(m.extractKeywords(''), []);
    assert.deepEqual(m.extractKeywords(null), []);
  });

  it('extractKeywords strips non-alphanumeric chars', () => {
    const kws = m.extractKeywords('agent-failed! to_validate');
    assert.ok(kws.includes('agent'));
    assert.ok(kws.includes('failed'));
    assert.ok(kws.includes('validate'));
  });

  it('verifyAgainstRules passes with no error memories', () => {
    const result = m.verifyAgainstRules({
      context: 'some perfectly fine output',
      tags: ['testing'],
    });
    assert.equal(result.passed, true);
    assert.equal(result.violations.length, 0);
    assert.equal(result.score, 1.0);
    assert.equal(result.checkedRules, 0);
  });

  it('verifyAgainstRules detects violations from error memories', () => {
    const memLog = path.join(tmpDir, 'memory-log.jsonl');
    fs.writeFileSync(memLog, JSON.stringify({
      category: 'error',
      id: 'mem_test_1',
      title: 'MISTAKE: agent claimed done without running tests',
      content: 'How to avoid: Always run tests first',
    }) + '\n');

    delete require.cache[require.resolve('../scripts/verification-loop')];
    const fresh = require('../scripts/verification-loop');

    const result = fresh.verifyAgainstRules({
      context: 'I am done, claimed without running tests',
      tags: ['testing'],
    });
    assert.equal(result.passed, false);
    assert.ok(result.violations.length >= 1);
    assert.ok(result.score < 1.0);
    assert.equal(result.checkedRules, 1);
    assert.ok(result.violations[0].avoidRule.toLowerCase().includes('always run tests'));
  });

  it('verifyAgainstRules requires 2+ keyword matches to trigger', () => {
    const memLog = path.join(tmpDir, 'memory-log.jsonl');
    fs.writeFileSync(memLog, JSON.stringify({
      category: 'error',
      id: 'mem_test_2',
      title: 'MISTAKE: database migration failed catastrophically',
      content: 'How to avoid: Test migrations locally first',
    }) + '\n');

    delete require.cache[require.resolve('../scripts/verification-loop')];
    const fresh = require('../scripts/verification-loop');

    const noMatch = fresh.verifyAgainstRules({
      context: 'deployed the new feature successfully',
      tags: [],
    });
    assert.equal(noMatch.passed, true);
  });

  it('runVerificationLoop accepts clean context on first attempt', () => {
    fs.writeFileSync(path.join(tmpDir, 'memory-log.jsonl'), '');
    delete require.cache[require.resolve('../scripts/verification-loop')];
    const fresh = require('../scripts/verification-loop');

    const modelPath = path.join(tmpDir, 'test-model.json');
    const result = fresh.runVerificationLoop({
      context: 'all tests pass and output is verified',
      tags: ['testing'],
      modelPath,
    });

    assert.equal(result.accepted, true);
    assert.equal(result.attempts, 1);
    assert.ok(result.history.length === 1);
    assert.equal(result.history[0].passed, true);
    assert.ok(result.thompsonUpdate);
    assert.equal(result.thompsonUpdate.signal, 'positive');
  });

  it('runVerificationLoop retries and calls onRetry', () => {
    const memLog = path.join(tmpDir, 'memory-log.jsonl');
    fs.writeFileSync(memLog, JSON.stringify({
      category: 'error',
      id: 'mem_retry',
      title: 'MISTAKE: agent skipped tests before claiming done',
      content: 'How to avoid: Run tests',
    }) + '\n');

    delete require.cache[require.resolve('../scripts/verification-loop')];
    const fresh = require('../scripts/verification-loop');

    let retryCalls = 0;
    const modelPath = path.join(tmpDir, 'retry-model.json');
    const result = fresh.runVerificationLoop({
      context: 'agent skipped tests before claiming done again',
      tags: ['testing'],
      maxRetries: 2,
      modelPath,
      onRetry: (attempt, violations) => {
        retryCalls++;
        return 'completely different safe output here now';
      },
    });

    assert.ok(retryCalls >= 1);
    assert.ok(result.attempts >= 2);
    assert.equal(result.accepted, true);
  });

  it('runVerificationLoop fails after exhausting retries', () => {
    const memLog = path.join(tmpDir, 'memory-log.jsonl');
    fs.writeFileSync(memLog, JSON.stringify({
      category: 'error',
      id: 'mem_exhaust',
      title: 'MISTAKE: agent fabricated fake results output',
      content: 'How to avoid: Never fabricate',
    }) + '\n');

    delete require.cache[require.resolve('../scripts/verification-loop')];
    const fresh = require('../scripts/verification-loop');

    const modelPath = path.join(tmpDir, 'exhaust-model.json');
    const result = fresh.runVerificationLoop({
      context: 'agent fabricated fake results output again',
      tags: ['testing'],
      maxRetries: 1,
      modelPath,
    });

    assert.equal(result.accepted, false);
    assert.equal(result.attempts, 2);
    assert.equal(result.thompsonUpdate.signal, 'negative');
  });

  it('runVerificationLoop updates Thompson model on disk', () => {
    fs.writeFileSync(path.join(tmpDir, 'memory-log.jsonl'), '');
    delete require.cache[require.resolve('../scripts/verification-loop')];
    const fresh = require('../scripts/verification-loop');

    const modelPath = path.join(tmpDir, 'persist-model.json');
    fresh.runVerificationLoop({
      context: 'clean output',
      tags: ['architecture'],
      modelPath,
    });

    assert.ok(fs.existsSync(modelPath));
    const model = JSON.parse(fs.readFileSync(modelPath, 'utf-8'));
    assert.ok(model.categories.architecture);
    assert.ok(model.categories.architecture.alpha > 1);
  });

  it('runVerificationLoop records partner-aware strategy and model updates', () => {
    fs.writeFileSync(path.join(tmpDir, 'memory-log.jsonl'), '');
    delete require.cache[require.resolve('../scripts/verification-loop')];
    const fresh = require('../scripts/verification-loop');

    const modelPath = path.join(tmpDir, 'partner-model.json');
    const result = fresh.runVerificationLoop({
      context: 'verified output with evidence',
      tags: ['testing'],
      partnerProfile: 'strict-reviewer',
      maxRetries: 1,
      modelPath,
    });

    assert.equal(result.partnerStrategy.profile, 'strict_reviewer');
    assert.equal(result.requestedMaxRetries, 1);
    assert.equal(result.maxRetries, 2);
    assert.ok(result.partnerReward.reward > 0);
    assert.equal(result.thompsonUpdate.partnerCategory, 'partner_strict_reviewer');

    const model = JSON.parse(fs.readFileSync(modelPath, 'utf-8'));
    assert.ok(model.categories.partner_strict_reviewer);
    assert.ok(model.categories.partner_strict_reviewer.alpha > 1);
  });

  it('getVerificationReliability returns per-category reliability', () => {
    const modelPath = path.join(tmpDir, 'rel-model.json');
    fs.writeFileSync(path.join(tmpDir, 'memory-log.jsonl'), '');
    delete require.cache[require.resolve('../scripts/verification-loop')];
    const fresh = require('../scripts/verification-loop');

    fresh.runVerificationLoop({
      context: 'good output',
      tags: ['testing'],
      modelPath,
    });

    const rel = fresh.getVerificationReliability(modelPath);
    assert.ok(rel.testing);
    assert.ok(typeof rel.testing.reliability === 'number');
    assert.ok(rel.testing.reliability > 0.5);
  });

  it('sampleVerificationPosteriors returns samples and recommendations', () => {
    const modelPath = path.join(tmpDir, 'sample-model.json');
    fs.writeFileSync(path.join(tmpDir, 'memory-log.jsonl'), '');
    delete require.cache[require.resolve('../scripts/verification-loop')];
    const fresh = require('../scripts/verification-loop');

    fresh.runVerificationLoop({
      context: 'safe output',
      tags: ['security'],
      modelPath,
    });

    const result = fresh.sampleVerificationPosteriors(modelPath);
    assert.ok(result.samples);
    assert.ok(typeof result.samples.security === 'number');
    assert.ok(Array.isArray(result.recommendations));
  });
});
