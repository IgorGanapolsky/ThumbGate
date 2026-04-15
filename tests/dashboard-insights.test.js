const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  generateDashboard,
} = require('../scripts/dashboard');

function createTempFeedbackDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-insights-'));
  return dir;
}

function writeFeedbackLog(dir, entries) {
  const logPath = path.join(dir, 'feedback-log.jsonl');
  fs.writeFileSync(logPath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

function makeEntry(signal, dayOffset, opts = {}) {
  const date = new Date();
  date.setDate(date.getDate() - dayOffset);
  return {
    id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    signal,
    context: opts.context || `Test ${signal} feedback`,
    timestamp: date.toISOString(),
    tags: opts.tags || [],
    ...opts,
  };
}

test('feedbackTimeSeries counts up and down signals per day', () => {
  const dir = createTempFeedbackDir();
  writeFeedbackLog(dir, [
    makeEntry('positive', 1),
    makeEntry('positive', 1),
    makeEntry('negative', 1),
    makeEntry('negative', 2),
    makeEntry('negative', 2),
    makeEntry('negative', 2),
  ]);

  const result = generateDashboard(dir);

  assert.ok(result.feedbackTimeSeries, 'feedbackTimeSeries should exist');
  assert.equal(result.feedbackTimeSeries.days.length, 30, 'should have 30 days');

  const yesterday = result.feedbackTimeSeries.days[28]; // offset 1 = index 28
  assert.equal(yesterday.up, 2, 'yesterday should have 2 up');
  assert.equal(yesterday.down, 1, 'yesterday should have 1 down');

  const twoDaysAgo = result.feedbackTimeSeries.days[27]; // offset 2 = index 27
  assert.equal(twoDaysAgo.down, 3, 'two days ago should have 3 down');
});

test('feedbackTimeSeries includes audit-trail entries (they are real gate events)', () => {
  const dir = createTempFeedbackDir();
  writeFeedbackLog(dir, [
    makeEntry('negative', 1, { tags: ['audit-trail'] }),
    makeEntry('negative', 1, { tags: ['audit-trail'] }),
    makeEntry('negative', 1),
    makeEntry('positive', 1),
  ]);

  const result = generateDashboard(dir);
  const yesterday = result.feedbackTimeSeries.days[28];

  assert.equal(yesterday.up, 1, 'should count 1 positive');
  assert.equal(yesterday.down, 3, 'should count all 3 negatives including audit-trail');
});

test('lessonPipeline shows correct stage counts', () => {
  const dir = createTempFeedbackDir();
  writeFeedbackLog(dir, [
    makeEntry('positive', 1),
    makeEntry('negative', 1),
    makeEntry('negative', 2),
  ]);

  // Write memory log with lessons
  const memoryLogPath = path.join(dir, 'memory-log.jsonl');
  fs.writeFileSync(memoryLogPath, [
    JSON.stringify({ id: 'mem_1', category: 'error', timestamp: new Date().toISOString() }),
    JSON.stringify({ id: 'mem_2', category: 'learning', timestamp: new Date().toISOString() }),
  ].join('\n') + '\n');

  const result = generateDashboard(dir);

  assert.ok(result.lessonPipeline, 'lessonPipeline should exist');
  assert.equal(result.lessonPipeline.stages.length, 4, 'should have 4 pipeline stages');

  const [feedback, lessons] = result.lessonPipeline.stages;
  assert.equal(feedback.id, 'feedback');
  assert.equal(feedback.count, 3, 'should count 3 feedback entries');
  assert.equal(lessons.id, 'lessons');
  assert.equal(lessons.count, 2, 'should count 2 lessons');
});

test('lessonPipeline includes audit-trail in feedback count', () => {
  const dir = createTempFeedbackDir();
  writeFeedbackLog(dir, [
    makeEntry('negative', 1, { tags: ['audit-trail'] }),
    makeEntry('negative', 1, { tags: ['audit-trail'] }),
    makeEntry('negative', 1),
  ]);

  const result = generateDashboard(dir);
  const feedback = result.lessonPipeline.stages[0];

  assert.equal(feedback.count, 3, 'should count all 3 entries including audit-trail');
});

test('approval stats include audit-trail entries', () => {
  const dir = createTempFeedbackDir();
  writeFeedbackLog(dir, [
    makeEntry('positive', 1),
    makeEntry('negative', 1, { tags: ['audit-trail'] }),
    makeEntry('negative', 1, { tags: ['audit-trail'] }),
  ]);

  const result = generateDashboard(dir);

  assert.equal(result.approval.total, 3, 'approval should count all entries');
  assert.equal(result.approval.positive, 1);
  assert.equal(result.approval.negative, 2);
});

test('stat card totals match chart totals (data consistency)', () => {
  const dir = createTempFeedbackDir();
  const entries = [
    makeEntry('positive', 0),
    makeEntry('positive', 1),
    makeEntry('negative', 1),
    makeEntry('negative', 2),
    makeEntry('negative', 3),
    makeEntry('negative', 1, { tags: ['audit-trail'] }), // should be excluded
  ];
  writeFeedbackLog(dir, entries);

  const result = generateDashboard(dir);

  // Chart totals
  const chartUp = result.feedbackTimeSeries.days.reduce((s, d) => s + d.up, 0);
  const chartDown = result.feedbackTimeSeries.days.reduce((s, d) => s + d.down, 0);
  const chartTotal = chartUp + chartDown;

  // Approval totals (stat cards)
  const statTotal = result.approval.total;
  const statPos = result.approval.positive;
  const statNeg = result.approval.negative;

  // Pipeline total
  const pipelineTotal = result.lessonPipeline.stages[0].count;

  // ALL THREE MUST AGREE
  assert.equal(chartTotal, statTotal, `chart total (${chartTotal}) must equal stat card total (${statTotal})`);
  assert.equal(chartUp, statPos, `chart up (${chartUp}) must equal stat positive (${statPos})`);
  assert.equal(chartDown, statNeg, `chart down (${chartDown}) must equal stat negative (${statNeg})`);
  assert.equal(pipelineTotal, statTotal, `pipeline total (${pipelineTotal}) must equal stat total (${statTotal})`);
});
