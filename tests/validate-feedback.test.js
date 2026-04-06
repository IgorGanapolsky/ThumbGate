'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshFeedbackLoop(tmpDir) {
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  // Clear caches for modules that read env at require time
  [
    '../scripts/feedback-loop',
    '../scripts/feedback-attribution',
    '../scripts/rlaif-self-audit',
    '../scripts/vector-store',
  ].forEach((m) => {
    try {
      delete require.cache[require.resolve(m)];
    } catch {
      // module may not exist in test env
    }
  });
  return require('../scripts/feedback-loop');
}

// validate-feedback is stateless — just re-require without cache clearing
const {
  validateEntry,
  validateSchema,
  validateSemantics,
  detectAnomalies,
  generateCorrections,
  applyCorrections,
} = require('../scripts/validate-feedback');

function makeValidEntry(overrides) {
  return {
    id: 'fb_test_001',
    timestamp: new Date().toISOString(),
    signal: 'positive',
    reward: 1,
    context: 'Comprehensive test coverage added',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// describe: validateSchema
// ---------------------------------------------------------------------------

describe('validateSchema', () => {
  it('returns no issues for a fully valid entry', () => {
    const entry = makeValidEntry();
    const issues = validateSchema(entry);
    assert.strictEqual(issues.length, 0);
  });

  it('reports error for missing signal field', () => {
    const { signal: _s, ...entry } = makeValidEntry();
    const issues = validateSchema(entry);
    const err = issues.find((i) => i.field === 'signal' && i.level === 'error');
    assert.ok(err, 'Expected error for missing signal');
  });

  it('reports error for missing timestamp field', () => {
    const { timestamp: _t, ...entry } = makeValidEntry();
    const issues = validateSchema(entry);
    const err = issues.find((i) => i.field === 'timestamp' && i.level === 'error');
    assert.ok(err, 'Expected error for missing timestamp');
  });

  it('reports error for reward out of range (> 1)', () => {
    const entry = makeValidEntry({ reward: 2.5 });
    const issues = validateSchema(entry);
    const err = issues.find((i) => i.field === 'reward' && i.level === 'error');
    assert.ok(err, 'Expected error for reward > 1');
  });

  it('reports error for invalid timestamp format', () => {
    const entry = makeValidEntry({ timestamp: 'not-a-date' });
    const issues = validateSchema(entry);
    const err = issues.find((i) => i.field === 'timestamp' && i.level === 'error');
    assert.ok(err, 'Expected error for invalid timestamp format');
  });
});

// ---------------------------------------------------------------------------
// describe: validateSemantics
// ---------------------------------------------------------------------------

describe('validateSemantics', () => {
  it('reports error for positive signal with negative reward', () => {
    const entry = makeValidEntry({ signal: 'positive', reward: -1 });
    const issues = validateSemantics(entry);
    const err = issues.find((i) => i.field === 'reward' && i.level === 'error');
    assert.ok(err, 'Expected semantic error: positive signal with negative reward');
  });

  it('reports error for negative signal with positive reward', () => {
    const entry = makeValidEntry({ signal: 'negative', reward: 1 });
    const issues = validateSemantics(entry);
    const err = issues.find((i) => i.field === 'reward' && i.level === 'error');
    assert.ok(err, 'Expected semantic error: negative signal with positive reward');
  });

  it('reports warning for context shorter than 5 chars', () => {
    const entry = makeValidEntry({ context: 'no' });
    const issues = validateSemantics(entry);
    const warn = issues.find((i) => i.field === 'context' && i.level === 'warning');
    assert.ok(warn, 'Expected warning for short context');
  });

  it('reports warning for context containing placeholder text (TODO)', () => {
    const entry = makeValidEntry({ context: 'TODO: fix this later' });
    const issues = validateSemantics(entry);
    const warn = issues.find((i) => i.field === 'context' && i.level === 'warning');
    assert.ok(warn, 'Expected warning for placeholder text in context');
  });
});

// ---------------------------------------------------------------------------
// describe: detectAnomalies
// ---------------------------------------------------------------------------

describe('detectAnomalies', () => {
  it('returns no issues when allEntries is empty', () => {
    const entry = makeValidEntry();
    const issues = detectAnomalies(entry, []);
    // Only check for anomaly-type issues (security patterns in default context won't trigger)
    const anomalyIssues = issues.filter((i) => i.type === 'anomaly');
    assert.strictEqual(anomalyIssues.length, 0);
  });

  it('detects duplicate entry when allEntries has identical context+signal', () => {
    const entry = makeValidEntry({ context: 'unique-duplicate-context', signal: 'positive' });
    const allEntries = [{ ...entry }]; // same context, signal, tool_name
    const issues = detectAnomalies(entry, allEntries);
    const dup = issues.find((i) => i.type === 'anomaly' && i.message.includes('Duplicate'));
    assert.ok(dup, 'Expected duplicate anomaly detection');
  });

  it('reports security error for potential API key in context', () => {
    const entry = makeValidEntry({ context: 'api_key=abc123 was used here' });
    const issues = detectAnomalies(entry, []);
    const secErr = issues.find((i) => i.type === 'security' && i.level === 'error');
    assert.ok(secErr, 'Expected security error for api_key pattern');
  });

  it('reports skew info when entries are heavily positive (>95%)', () => {
    // 11 positive entries + current positive = 100% positive
    const positiveEntries = Array.from({ length: 11 }, (_, i) =>
      makeValidEntry({ id: `fb_pos_${i}`, context: `positive entry ${i}` })
    );
    const entry = makeValidEntry({ id: 'fb_new', context: 'new positive' });
    const issues = detectAnomalies(entry, positiveEntries);
    const skew = issues.find((i) => i.type === 'anomaly' && i.message.includes('positive'));
    assert.ok(skew, 'Expected skew anomaly for >95% positive');
  });
});

// ---------------------------------------------------------------------------
// describe: generateCorrections + applyCorrections
// ---------------------------------------------------------------------------

describe('generateCorrections and applyCorrections', () => {
  it('generates reward correction for positive signal with reward=-1', () => {
    const entry = makeValidEntry({ signal: 'positive', reward: -1 });
    const issues = [{ level: 'error', field: 'reward', message: 'Positive signal but negative reward' }];
    const corrections = generateCorrections(entry, issues);
    assert.strictEqual(corrections.length, 1);
    assert.strictEqual(corrections[0].field, 'reward');
    assert.strictEqual(corrections[0].corrected, 1);
  });

  it('applyCorrections sets corrected field value and _corrected flag', () => {
    const entry = makeValidEntry({ signal: 'positive', reward: -1 });
    const corrections = [{ field: 'reward', original: -1, corrected: 1, reason: 'test' }];
    const corrected = applyCorrections(entry, corrections);
    assert.strictEqual(corrected.reward, 1);
    assert.strictEqual(corrected._corrected, true);
    assert.deepStrictEqual(corrected._corrections, corrections);
  });
});

// ---------------------------------------------------------------------------
// describe: validateEntry integration
// ---------------------------------------------------------------------------

describe('validateEntry integration', () => {
  it('returns valid:true for a correct entry with no issues', () => {
    const entry = makeValidEntry();
    const result = validateEntry(entry);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.issues.filter((i) => i.level === 'error').length, 0);
  });

  it('returns valid:false and correctedEntry for positive signal with reward=-1', () => {
    const entry = makeValidEntry({ signal: 'positive', reward: -1 });
    const result = validateEntry(entry);
    assert.strictEqual(result.valid, false);
    assert.ok(result.issues.some((i) => i.level === 'error'));
    assert.ok(result.correctedEntry, 'Expected correctedEntry to be set');
    assert.strictEqual(result.correctedEntry.reward, 1, 'Expected corrected reward = 1');
  });

  it('returns valid:false for entry with sensitive data in context', () => {
    const entry = makeValidEntry({ context: 'secret_token=xyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890 used' });
    const result = validateEntry(entry);
    assert.strictEqual(result.valid, false);
    assert.ok(result.issues.some((i) => i.type === 'security' && i.level === 'error'));
  });
});

// ---------------------------------------------------------------------------
// describe: inferOutcome (QUAL-03)
// ---------------------------------------------------------------------------

describe('inferOutcome (QUAL-03)', () => {
  let inferOutcome;
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-qual-infer-'));
    ({ inferOutcome } = freshFeedbackLoop(tmpDir));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.THUMBGATE_FEEDBACK_DIR;
  });

  it('returns quick-success for positive + "first try"', () => {
    assert.strictEqual(inferOutcome('positive', 'solved it first try'), 'quick-success');
  });

  it('returns deep-success for positive + "thorough comprehensive"', () => {
    assert.strictEqual(inferOutcome('positive', 'thorough comprehensive analysis provided'), 'deep-success');
  });

  it('returns standard-success for positive + generic context', () => {
    assert.strictEqual(inferOutcome('positive', 'worked as expected'), 'standard-success');
  });

  it('returns factual-error for negative + "wrong"', () => {
    assert.strictEqual(inferOutcome('negative', 'gave wrong incorrect answer'), 'factual-error');
  });

  it('returns insufficient-depth for negative + "shallow"', () => {
    assert.strictEqual(inferOutcome('negative', 'shallow surface level response'), 'insufficient-depth');
  });
});

// ---------------------------------------------------------------------------
// describe: captureFeedback richContext (QUAL-02)
// ---------------------------------------------------------------------------

describe('captureFeedback richContext enrichment (QUAL-02)', () => {
  let captureFeedback;
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-qual-capture-'));
    ({ captureFeedback } = freshFeedbackLoop(tmpDir));
  });

  after(async () => {
    // Brief pause so LanceDB fire-and-forget async write can settle before rmSync
    await new Promise((resolve) => setTimeout(resolve, 200));
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Non-critical — OS will clean up tmp dir eventually
    }
    delete process.env.THUMBGATE_FEEDBACK_DIR;
  });

  it('feedbackEvent.richContext contains domain, filePaths, errorType, outcomeCategory', () => {
    const result = captureFeedback({
      signal: 'positive',
      context: 'comprehensive unit test coverage added',
      tags: ['testing'],
    });
    assert.ok(result.feedbackEvent, 'Expected feedbackEvent in result');
    const rc = result.feedbackEvent.richContext;
    assert.ok(rc, 'Expected richContext on feedbackEvent');
    assert.ok(typeof rc.domain === 'string', 'richContext.domain must be string');
    assert.ok(Array.isArray(rc.filePaths), 'richContext.filePaths must be array');
    assert.ok('errorType' in rc, 'richContext.errorType must be present');
    assert.ok(typeof rc.outcomeCategory === 'string', 'richContext.outcomeCategory must be string');
    assert.strictEqual(rc.domain, 'testing', 'Expected domain=testing for testing tag');
  });

  it('richContext.filePaths populated when filePaths param passed as array', () => {
    const result = captureFeedback({
      signal: 'negative',
      context: 'incorrect logic in the implementation',
      tags: [],
      filePaths: ['src/api.js', 'src/utils.js'],
    });
    assert.ok(result.feedbackEvent, 'Expected feedbackEvent');
    const rc = result.feedbackEvent.richContext;
    assert.deepStrictEqual(rc.filePaths, ['src/api.js', 'src/utils.js']);
  });
});
