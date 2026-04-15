const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  analyzePatterns,
  analyzeCategoryPatterns,
  analyzeFeedbackEffectiveness,
  analyzeRecurringErrors,
  analyzeTimeOfDayPatterns,
  buildEpisode,
  loadEpisodes,
  loadRecentEpisodes,
  recordEpisode,
} = require('../scripts/session-episode-store');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-episodes-'));
}

function makeEpisode(overrides = {}) {
  return {
    sessionId: `session_${Date.now()}_test`,
    recordedAt: new Date().toISOString(),
    hourOfDay: 14,
    dayOfWeek: 2,
    score: 100,
    grade: 'healthy',
    signals: [],
    recommendation: null,
    feedbackCount: 0,
    negativeCount: 0,
    positiveCount: 0,
    categories: [],
    errorFingerprints: [],
    durationMs: null,
    tags: [],
    ...overrides,
  };
}

test('buildEpisode produces a complete episode from feedback entries', () => {
  const episode = buildEpisode({
    feedbackEntries: [
      { signal: 'negative', whatWentWrong: 'Broke the build', tags: ['testing'], timestamp: new Date().toISOString() },
      { signal: 'positive', whatWorked: 'Fixed it', tags: ['testing'], timestamp: new Date().toISOString() },
    ],
  });

  assert.ok(episode.sessionId.startsWith('session_'));
  assert.ok(episode.recordedAt);
  assert.equal(typeof episode.hourOfDay, 'number');
  assert.equal(typeof episode.dayOfWeek, 'number');
  assert.equal(typeof episode.score, 'number');
  assert.equal(episode.feedbackCount, 2);
  assert.equal(episode.negativeCount, 1);
  assert.equal(episode.positiveCount, 1);
  assert.ok(episode.categories.includes('testing'));
  assert.equal(episode.errorFingerprints.length, 1);
});

test('recordEpisode persists to JSONL and loadEpisodes retrieves it', () => {
  const tempDir = makeTempDir();
  const episode = makeEpisode({ sessionId: 'test_persist' });

  recordEpisode(episode, { feedbackDir: tempDir });
  const loaded = loadEpisodes({ feedbackDir: tempDir });

  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].sessionId, 'test_persist');
});

test('loadRecentEpisodes returns only the most recent N entries', () => {
  const tempDir = makeTempDir();
  for (let i = 0; i < 10; i++) {
    recordEpisode(makeEpisode({ sessionId: `session_${i}`, score: 50 + i }), { feedbackDir: tempDir });
  }

  const recent = loadRecentEpisodes(3, { feedbackDir: tempDir });
  assert.equal(recent.length, 3);
  assert.equal(recent[0].sessionId, 'session_7');
});

test('analyzeTimeOfDayPatterns detects risky hours', () => {
  const episodes = [
    makeEpisode({ hourOfDay: 14, grade: 'critical', score: 30 }),
    makeEpisode({ hourOfDay: 14, grade: 'degraded', score: 55 }),
    makeEpisode({ hourOfDay: 14, grade: 'degraded', score: 60 }),
    makeEpisode({ hourOfDay: 9, grade: 'healthy', score: 95 }),
    makeEpisode({ hourOfDay: 9, grade: 'healthy', score: 90 }),
  ];

  const patterns = analyzeTimeOfDayPatterns(episodes);
  assert.ok(patterns.length >= 1);
  assert.equal(patterns[0].hour, 14);
  assert.ok(patterns[0].failRate > 50);
  assert.match(patterns[0].recommendation, /2PM/);
});

test('analyzeCategoryPatterns identifies risky task types', () => {
  const episodes = [
    makeEpisode({ categories: ['git', 'code_edit'], grade: 'degraded', score: 45 }),
    makeEpisode({ categories: ['git'], grade: 'critical', score: 20 }),
    makeEpisode({ categories: ['git'], grade: 'degraded', score: 50 }),
    makeEpisode({ categories: ['testing'], grade: 'healthy', score: 95 }),
    makeEpisode({ categories: ['testing'], grade: 'healthy', score: 90 }),
  ];

  const patterns = analyzeCategoryPatterns(episodes);
  assert.ok(patterns.length >= 1);
  assert.equal(patterns[0].category, 'git');
  assert.ok(patterns[0].failRate > 50);
});

test('analyzeRecurringErrors detects cross-session repeat failures', () => {
  const episodes = [
    makeEpisode({ errorFingerprints: ['failed to read file at', 'missing import'] }),
    makeEpisode({ errorFingerprints: ['failed to read file at'] }),
    makeEpisode({ errorFingerprints: ['timeout on api call'] }),
  ];

  const patterns = analyzeRecurringErrors(episodes);
  assert.ok(patterns.length >= 1);
  assert.equal(patterns[0].fingerprint, 'failed to read file at');
  assert.equal(patterns[0].occurrences, 2);
  assert.match(patterns[0].recommendation, /prevention rule/);
});

test('analyzeFeedbackEffectiveness detects improving trend', () => {
  const episodes = [
    makeEpisode({ score: 40, errorFingerprints: ['a', 'b', 'c'] }),
    makeEpisode({ score: 45, errorFingerprints: ['a', 'b'] }),
    makeEpisode({ score: 50, errorFingerprints: ['a'] }),
    makeEpisode({ score: 80, errorFingerprints: [] }),
    makeEpisode({ score: 85, errorFingerprints: [] }),
    makeEpisode({ score: 90, errorFingerprints: [] }),
  ];

  const result = analyzeFeedbackEffectiveness(episodes);
  assert.ok(result);
  assert.equal(result.improving, true);
  assert.ok(result.scoreTrend > 0);
  assert.ok(result.recentRepeatRate <= result.olderRepeatRate);
  assert.match(result.recommendation, /improving/);
});

test('analyzeFeedbackEffectiveness detects declining trend', () => {
  const episodes = [
    makeEpisode({ score: 90, errorFingerprints: [] }),
    makeEpisode({ score: 85, errorFingerprints: [] }),
    makeEpisode({ score: 50, errorFingerprints: ['a'] }),
    makeEpisode({ score: 40, errorFingerprints: ['a', 'b'] }),
    makeEpisode({ score: 30, errorFingerprints: ['a', 'b', 'c'] }),
    makeEpisode({ score: 25, errorFingerprints: ['a', 'b', 'c', 'd'] }),
  ];

  const result = analyzeFeedbackEffectiveness(episodes);
  assert.ok(result);
  assert.equal(result.improving, false);
  assert.ok(result.scoreTrend < 0);
  assert.match(result.recommendation, /declining/);
});

test('analyzeFeedbackEffectiveness returns null with fewer than 3 episodes', () => {
  assert.equal(analyzeFeedbackEffectiveness([makeEpisode(), makeEpisode()]), null);
});

test('analyzePatterns returns all pattern types', () => {
  const episodes = [
    makeEpisode({ hourOfDay: 14, grade: 'critical', score: 20, categories: ['git'], errorFingerprints: ['broke build'] }),
    makeEpisode({ hourOfDay: 14, grade: 'degraded', score: 50, categories: ['git'], errorFingerprints: ['broke build'] }),
    makeEpisode({ hourOfDay: 14, grade: 'degraded', score: 55, categories: ['git'], errorFingerprints: [] }),
    makeEpisode({ hourOfDay: 9, grade: 'healthy', score: 95, categories: ['testing'], errorFingerprints: [] }),
  ];

  const patterns = analyzePatterns(episodes);
  assert.ok(patterns.timeOfDay.length > 0);
  assert.ok(patterns.categories.length > 0);
  assert.ok(patterns.recurringErrors.length > 0);
  assert.ok(patterns.effectiveness);
  assert.equal(patterns.episodesAnalyzed, 4);
  assert.ok(patterns.analyzedAt);
});

test('empty episode history produces no patterns', () => {
  const patterns = analyzePatterns([]);
  assert.equal(patterns.timeOfDay.length, 0);
  assert.equal(patterns.categories.length, 0);
  assert.equal(patterns.recurringErrors.length, 0);
  assert.equal(patterns.effectiveness, null);
});

test('buildEpisode extracts domain from richContext', () => {
  const episode = buildEpisode({
    feedbackEntries: [
      {
        signal: 'negative',
        whatWentWrong: 'test failure',
        tags: [],
        richContext: { domain: 'security' },
        timestamp: new Date().toISOString(),
      },
    ],
  });

  assert.ok(episode.categories.includes('security'));
});
