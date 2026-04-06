const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-cli-'));
process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;

const { processInlineFeedback, formatCliOutput } = require('../scripts/cli-feedback');
const { getStatusbarLessonData, createLesson } = require('../scripts/lesson-inference');

test.after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

// === processInlineFeedback ===
test('processInlineFeedback thumbs up captures feedback', () => {
  const r = processInlineFeedback({ signal: 'up', context: 'Great fix on the deploy script' });
  assert.ok(r.feedbackResult);
  assert.ok(r.stats);
});

test('processInlineFeedback thumbs down captures feedback', () => {
  const r = processInlineFeedback({ signal: 'down', context: 'Broke the tests', whatWentWrong: 'Skipped verification' });
  assert.ok(r.feedbackResult);
});

test('processInlineFeedback thumbs down with chat history distills lesson', () => {
  const r = processInlineFeedback({
    signal: 'down',
    context: 'Used Tailwind despite my correction',
    chatHistory: [
      { role: 'user', content: "Don't use Tailwind in this project" },
      { role: 'assistant', content: 'I added tw-flex classes to the layout.' },
    ],
  });
  assert.ok(r.distillResult);
  assert.ok(r.distillResult.proposedWhatWentWrong.includes('Tailwind'));
  assert.ok(r.distillResult.proposedRule);
});

test('processInlineFeedback returns recent lesson and stats', () => {
  createLesson({ signal: 'negative', inferredLesson: 'Never skip health check after deploy' });
  const r = processInlineFeedback({ signal: 'up', context: 'Good job' });
  assert.ok(r.recentLesson);
  assert.ok(r.recentLesson.lesson.includes('health check'));
  assert.ok(r.stats.total >= 1);
});

test('processInlineFeedback handles missing signal gracefully', () => {
  const r = processInlineFeedback({});
  assert.ok(r.feedbackResult);
});

// === formatCliOutput ===
test('formatCliOutput shows thumbs up header', () => {
  const output = formatCliOutput({ feedbackResult: { accepted: true, signal: 'positive' }, stats: { total: 0 } });
  assert.ok(output.includes('👍'));
  assert.ok(output.includes('Thumbs up recorded'));
});

test('formatCliOutput shows thumbs down with distilled lesson', () => {
  const output = formatCliOutput({
    feedbackResult: { accepted: true, signal: 'negative', id: 'fb_123' },
    distillResult: { proposedWhatWentWrong: 'Used Tailwind', proposedRule: 'NEVER use Tailwind', ruleInstalled: true, confirmation: 'Correct?' },
    recentLesson: { lesson: 'Never use Tailwind', link: 'http://localhost:3456/lessons#lesson_1' },
    stats: { positive: 5, negative: 3, total: 8, avgConfidence: 72 },
  });
  assert.ok(output.includes('👎'));
  assert.ok(output.includes('Lesson distilled'));
  assert.ok(output.includes('Used Tailwind'));
  assert.ok(output.includes('NEVER use Tailwind'));
  assert.ok(output.includes('Auto-installed'));
  assert.ok(output.includes('Most recent lesson'));
  assert.ok(output.includes('Stats:'));
  assert.ok(output.includes('5👍'));
});

test('formatCliOutput shows rejected feedback', () => {
  const output = formatCliOutput({ feedbackResult: { accepted: false, reason: 'too vague' }, stats: { total: 0 } });
  assert.ok(output.includes('not accepted'));
  assert.ok(output.includes('too vague'));
});

test('formatCliOutput handles no distill result', () => {
  const output = formatCliOutput({ feedbackResult: { accepted: true, signal: 'positive' }, stats: { total: 1, positive: 1, negative: 0, avgConfidence: 80 } });
  assert.ok(!output.includes('Lesson distilled'));
  assert.ok(output.includes('Stats:'));
});

// === statusline-lesson.js ===
test('statusline-lesson.js outputs valid JSON', () => {
  createLesson({ signal: 'positive', inferredLesson: 'Deploy health check works' });
  const { execFileSync } = require('child_process');
  const result = execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'statusline-lesson.js')], {
    encoding: 'utf-8',
    env: { ...process.env, THUMBGATE_FEEDBACK_DIR: tmpDir },
  });
  const parsed = JSON.parse(result);
  assert.equal(parsed.hasLesson, true);
  assert.ok(parsed.text.includes('Deploy health check'));
});

// === statusline.sh structure ===
test('statusline.sh uses CLI commands not browser URLs for feedback', () => {
  const sh = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'statusline.sh'), 'utf-8');
  assert.ok(!sh.includes('feedback/quick?signal='), 'should NOT have browser URL for feedback');
  assert.ok(sh.includes('statusline-lesson.js'), 'should reference lesson helper');
  assert.ok(sh.includes('statusline-tower.js'), 'should reference tower helper');
  assert.ok(sh.includes('LESSON_TEXT'), 'should show lesson in output');
});

test('statusline.sh shows Control Tower alerts', () => {
  const sh = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'statusline.sh'), 'utf-8');
  assert.ok(sh.includes('SLO_V'));
  assert.ok(sh.includes('AT_RISK'));
  assert.ok(sh.includes('ANOMALIES'));
});
