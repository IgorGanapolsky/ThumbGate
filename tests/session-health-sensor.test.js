const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AMNESIA_PATTERNS,
  STAGNATION_THRESHOLD,
  computeSessionHealth,
  detectContextAmnesia,
  detectNegativeDensity,
  detectRepeatErrors,
  detectStagnation,
  normalizeErrorText,
} = require('../scripts/session-health-sensor');

function makeFeedback(signal, overrides = {}) {
  return {
    signal,
    timestamp: new Date().toISOString(),
    context: '',
    whatWentWrong: null,
    whatToChange: null,
    whatWorked: null,
    tags: [],
    ...overrides,
  };
}

test('healthy session scores 100 with no feedback entries', () => {
  const health = computeSessionHealth([]);
  assert.equal(health.score, 100);
  assert.equal(health.grade, 'healthy');
  assert.equal(health.recommendation, null);
});

test('healthy session with only positive feedback stays high', () => {
  const entries = [
    makeFeedback('positive', { whatWorked: 'Correctly refactored module.' }),
    makeFeedback('positive', { whatWorked: 'Tests all pass.' }),
    makeFeedback('positive', { whatWorked: 'Clean commit.' }),
  ];
  const health = computeSessionHealth(entries);
  assert.equal(health.score, 100);
  assert.equal(health.grade, 'healthy');
});

test('repeat errors are detected and penalize health score', () => {
  const entries = [
    makeFeedback('negative', { whatWentWrong: 'Failed to read file at line 42' }),
    makeFeedback('negative', { whatWentWrong: 'Failed to read file at line 99' }),
    makeFeedback('negative', { whatWentWrong: 'Failed to read file at line 7' }),
  ];
  const signal = detectRepeatErrors(entries);
  assert.equal(signal.signal, 'repeat_errors');
  assert.ok(signal.count >= 2, 'should detect normalized duplicates');
  assert.equal(signal.severity, 'warning');

  const health = computeSessionHealth(entries);
  assert.ok(health.score < 80, `expected degraded, got ${health.score}`);
});

test('negative density above 70% triggers critical severity', () => {
  const entries = [
    makeFeedback('negative'),
    makeFeedback('negative'),
    makeFeedback('negative'),
    makeFeedback('positive'),
  ];
  const signal = detectNegativeDensity(entries);
  assert.equal(signal.rate, 0.75);
  assert.equal(signal.severity, 'critical');
});

test('stagnation detects consecutive negatives without recovery', () => {
  const entries = [
    makeFeedback('positive'),
    ...Array.from({ length: STAGNATION_THRESHOLD }, () => makeFeedback('negative')),
  ];
  const signal = detectStagnation(entries);
  assert.equal(signal.consecutiveNegatives, STAGNATION_THRESHOLD);
  assert.equal(signal.severity, 'warning');
});

test('double stagnation threshold triggers critical', () => {
  const entries = Array.from(
    { length: STAGNATION_THRESHOLD * 2 },
    () => makeFeedback('negative'),
  );
  const signal = detectStagnation(entries);
  assert.equal(signal.severity, 'critical');
});

test('context amnesia patterns are detected in feedback text', () => {
  assert.ok(AMNESIA_PATTERNS.test('I already told you to use the correct path'));
  assert.ok(AMNESIA_PATTERNS.test('Agent forgot the architecture constraints'));
  assert.ok(AMNESIA_PATTERNS.test('Same mistake as before'));
  assert.ok(AMNESIA_PATTERNS.test('Context drift is causing failures'));
  assert.ok(AMNESIA_PATTERNS.test('It keeps making the wrong edit'));
  assert.ok(!AMNESIA_PATTERNS.test('Fixed the import statement'));
});

test('context amnesia in feedback entries triggers warning or critical', () => {
  const entries = [
    makeFeedback('negative', { whatWentWrong: 'Agent forgot the file structure again.' }),
    makeFeedback('negative', { context: 'I already told it to use snake_case.' }),
    makeFeedback('positive'),
  ];
  const signal = detectContextAmnesia(entries);
  assert.equal(signal.count, 2);
  assert.equal(signal.severity, 'warning');
});

test('three or more amnesia signals trigger critical', () => {
  const entries = [
    makeFeedback('negative', { whatWentWrong: 'Same mistake again.' }),
    makeFeedback('negative', { context: 'Already told it about this.' }),
    makeFeedback('negative', { whatToChange: 'Stop making the same error repeatedly.' }),
  ];
  const signal = detectContextAmnesia(entries);
  assert.equal(signal.count, 3);
  assert.equal(signal.severity, 'critical');
});

test('error text normalization strips line numbers and collapses whitespace', () => {
  assert.equal(
    normalizeErrorText('Failed to read file at line 42 col 10'),
    'failed to read file at',
  );
  assert.equal(
    normalizeErrorText('Error on line 100: missing semicolon after 3 tokens'),
    'error on : missing semicolon after N tokens',
  );
});

test('combined degradation signals produce low health score with actionable recommendation', () => {
  const entries = [
    makeFeedback('negative', { whatWentWrong: 'Broke the import again' }),
    makeFeedback('negative', { whatWentWrong: 'Broke the import again' }),
    makeFeedback('negative', { whatWentWrong: 'Broke the import again' }),
    makeFeedback('negative', { context: 'Already told it not to do this. Context drift.' }),
  ];
  const health = computeSessionHealth(entries);
  assert.equal(health.grade, 'critical');
  assert.ok(health.score < 50);
  assert.ok(health.recommendation);
  assert.match(health.recommendation, /Context drift|prevention rule|fresh/);
});

test('mixed session with recovery stays healthy', () => {
  const entries = [
    makeFeedback('negative', { whatWentWrong: 'Wrong file path' }),
    makeFeedback('positive', { whatWorked: 'Fixed the path' }),
    makeFeedback('negative', { whatWentWrong: 'Missing import' }),
    makeFeedback('positive', { whatWorked: 'Added the import' }),
  ];
  const health = computeSessionHealth(entries);
  assert.ok(health.score >= 50, `expected non-critical, got ${health.score}`);
});

test('health report includes metadata fields', () => {
  const health = computeSessionHealth([]);
  assert.ok(health.computedAt);
  assert.equal(health.entriesAnalyzed, 0);
  assert.equal(typeof health.windowMs, 'number');
  assert.ok(Array.isArray(health.signals));
  assert.equal(health.signals.length, 4);
});
