const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-contextfs-test-'));
process.env.RLHF_FEEDBACK_DIR = tmpFeedbackDir;

const {
  CONTEXTFS_ROOT,
  NAMESPACES,
  ensureContextFs,
  registerFeedback,
  registerPreventionRules,
  normalizeNamespaces,
  constructContextPack,
  evaluateContextPack,
  getProvenance,
} = require('../scripts/contextfs');

test.after(() => {
  fs.rmSync(tmpFeedbackDir, { recursive: true, force: true });
});

test('contextfs initializes required directories', () => {
  ensureContextFs();
  const required = Object.values(NAMESPACES).map((ns) => path.join(CONTEXTFS_ROOT, ns));
  required.forEach((dir) => assert.equal(fs.existsSync(dir), true));
});

test('register feedback and construct pack', () => {
  const feedbackEvent = {
    id: 'fb_test_1',
    signal: 'negative',
    context: 'Skipped verification on fix claim',
    tags: ['verification', 'testing'],
    actionType: 'store-mistake',
  };

  const memoryRecord = {
    title: 'MISTAKE: Skipped verification on fix claim',
    content: 'What went wrong: no tests\nHow to avoid: run tests before claim',
    category: 'error',
    tags: ['feedback', 'negative', 'verification'],
    sourceFeedbackId: 'fb_test_1',
  };

  const result = registerFeedback(feedbackEvent, memoryRecord);
  assert.ok(result.raw);
  assert.ok(result.memory);

  registerPreventionRules('# Prevention Rules\n\n- Always verify before claiming done.');

  const pack = constructContextPack({
    query: 'verification testing',
    maxItems: 5,
    maxChars: 5000,
  });

  assert.ok(pack.packId);
  assert.ok(pack.items.length >= 1);
  assert.equal(Object.prototype.hasOwnProperty.call(pack.items[0], 'filePath'), false);

  const evaluation = evaluateContextPack({
    packId: pack.packId,
    outcome: 'useful',
    signal: 'positive',
  });
  assert.equal(evaluation.packId, pack.packId);

  const provenance = getProvenance(20);
  assert.ok(provenance.length >= 1);
});

test('normalizeNamespaces rejects path traversal attempts', () => {
  assert.throws(() => normalizeNamespaces(['../..']), /Unsupported namespace/);
});
