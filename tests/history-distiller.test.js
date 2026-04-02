const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-distill-'));
process.env.RLHF_FEEDBACK_DIR = tmpDir;

const { ANTI_PATTERNS, analyzeChatHistory, distillFromHistory } = require('../scripts/history-distiller');

test.after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

// === Anti-Pattern Detection ===
test('ANTI_PATTERNS covers common bad practices', () => {
  const labels = ANTI_PATTERNS.map((p) => p.label);
  assert.ok(labels.includes('Tailwind CSS'));
  assert.ok(labels.includes('force push'));
  assert.ok(labels.includes('skipping tests'));
  assert.ok(labels.includes('mocking database'));
  assert.ok(labels.includes('hardcoded values'));
});

// === analyzeChatHistory ===
test('analyzeChatHistory detects user correction + anti-pattern', () => {
  const r = analyzeChatHistory([
    { role: 'user', content: 'Fix the login page' },
    { role: 'assistant', content: 'I added Tailwind classes to style the form.' },
    { role: 'user', content: "Don't use Tailwind, we use plain CSS in this project." },
    { role: 'assistant', content: 'I used tailwind again to fix the button.' },
  ]);
  assert.equal(r.antiPattern, 'Tailwind CSS');
  assert.ok(r.correction.includes('Tailwind'));
  assert.equal(r.proposedRule, 'NEVER use Tailwind CSS in this project');
  assert.equal(r.confidence, 90);
  assert.ok(r.evidence.length >= 2);
});

test('analyzeChatHistory detects anti-pattern without correction', () => {
  const r = analyzeChatHistory([
    { role: 'assistant', content: 'Running git push --force to fix the branch.' },
  ]);
  assert.equal(r.antiPattern, 'force push');
  assert.ok(r.proposedRule.includes('force-push'));
  assert.equal(r.confidence, 60);
});

test('analyzeChatHistory detects correction without anti-pattern', () => {
  const r = analyzeChatHistory([
    { role: 'user', content: "Don't use that library, it's deprecated" },
    { role: 'assistant', content: 'I imported the old library for the feature.' },
  ]);
  assert.ok(r.correction.includes('deprecated'));
  assert.ok(r.proposedRule.includes('NEVER'));
  assert.equal(r.confidence, 50);
});

test('analyzeChatHistory handles empty history', () => {
  const r = analyzeChatHistory([]);
  assert.equal(r.confidence, 0);
  assert.equal(r.proposedRule, null);
});

test('analyzeChatHistory detects correction in failedToolCall', () => {
  const r = analyzeChatHistory(
    [{ role: 'user', content: 'never skip tests' }],
    { tool: 'Bash', input: 'git push --no-verify', output: 'pushed' }
  );
  assert.ok(r.correction.includes('skip tests'));
});

test('analyzeChatHistory detects mock database anti-pattern', () => {
  const r = analyzeChatHistory([
    { role: 'assistant', content: 'I mocked the database for the integration test.' },
  ]);
  assert.equal(r.antiPattern, 'mocking database');
});

test('analyzeChatHistory detects skip CI anti-pattern', () => {
  const r = analyzeChatHistory([
    { role: 'assistant', content: 'Let me skip ci to speed things up.' },
  ]);
  assert.equal(r.antiPattern, 'skipping tests');
});

test('analyzeChatHistory reports messageCount', () => {
  const r = analyzeChatHistory([{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }]);
  assert.equal(r.messageCount, 2);
});

// === distillFromHistory ===
test('distillFromHistory creates lesson with correction + anti-pattern', () => {
  const r = distillFromHistory({
    chatHistory: [
      { role: 'user', content: "I told you not to use Tailwind" },
      { role: 'assistant', content: 'I added tw-flex classes to the layout.' },
    ],
    signal: 'negative',
  });
  assert.ok(r.autoCreated);
  assert.ok(r.lesson.id.startsWith('lesson_'));
  assert.ok(r.proposedWhatWentWrong.includes('Tailwind'));
  assert.equal(r.proposedRule, 'NEVER use Tailwind CSS in this project');
  assert.ok(r.confirmation.includes('Correct?'));
  assert.equal(r.ruleInstalled, true);
});

test('distillFromHistory creates lesson with anti-pattern only', () => {
  const r = distillFromHistory({
    chatHistory: [{ role: 'assistant', content: 'I hardcoded the API URL to http://localhost:3000.' }],
    signal: 'negative',
  });
  assert.ok(r.proposedWhatWentWrong.includes('hardcoded'));
  assert.equal(r.ruleInstalled, true);
});

test('distillFromHistory creates lesson with no patterns detected', () => {
  const r = distillFromHistory({
    chatHistory: [{ role: 'assistant', content: 'Here is the analysis report.' }],
    signal: 'negative',
    feedbackContext: 'The analysis was incomplete',
  });
  assert.ok(r.proposedWhatWentWrong.includes('incomplete'));
  assert.ok(r.autoCreated);
  assert.equal(r.ruleInstalled, false);
});

test('distillFromHistory handles empty input', () => {
  const r = distillFromHistory({});
  assert.ok(r.autoCreated);
  assert.ok(r.lesson.id);
});

test('distillFromHistory includes inference data', () => {
  const r = distillFromHistory({
    chatHistory: [{ role: 'assistant', content: 'I fixed the deploy script.' }],
    signal: 'negative',
  });
  assert.ok(r.inference);
  assert.ok(typeof r.inference.confidence === 'number');
});

test('distillFromHistory marks lesson metadata as distilled', () => {
  const r = distillFromHistory({
    chatHistory: [{ role: 'assistant', content: 'Using console.log for debugging.' }],
    signal: 'negative',
  });
  assert.equal(r.lesson.metadata.distilled, true);
});
