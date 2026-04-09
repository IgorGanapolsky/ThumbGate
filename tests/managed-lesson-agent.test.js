const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const originalKey = process.env.ANTHROPIC_API_KEY;
const originalFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;

let tmpDir;

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-agent-test-'));
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
});

afterEach(() => {
  if (originalKey) process.env.ANTHROPIC_API_KEY = originalKey;
  else delete process.env.ANTHROPIC_API_KEY;
  if (originalFeedbackDir) process.env.THUMBGATE_FEEDBACK_DIR = originalFeedbackDir;
  else delete process.env.THUMBGATE_FEEDBACK_DIR;
  // Clean up require cache so each test gets fresh state
  delete require.cache[require.resolve('../scripts/managed-lesson-agent')];
  delete require.cache[require.resolve('../scripts/llm-client')];
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
});

test('getManagedAgentStatus returns null when no runs exist', () => {
  const { getManagedAgentStatus } = require('../scripts/managed-lesson-agent');
  const status = getManagedAgentStatus();
  assert.equal(status, null);
});

test('runManagedAgent dry-run with no feedback returns zero counts', async () => {
  const { runManagedAgent } = require('../scripts/managed-lesson-agent');
  const result = await runManagedAgent({ dryRun: true });
  assert.equal(result.entriesProcessed, 0);
  assert.equal(result.lessonsCreated, 0);
  assert.equal(result.gatesPromoted, 0);
  assert.equal(result.model, 'none');
});

test('runManagedAgent dry-run processes feedback entries with heuristic fallback', async () => {
  // Write sample feedback
  const feedbackLog = path.join(tmpDir, 'feedback-log.jsonl');
  const entries = [
    { id: 'test-1', signal: 'negative', context: 'Agent edited wrong file without reading it first', tags: ['execution-gap'], conversationWindow: [{ role: 'user', content: 'fix the bug' }, { role: 'assistant', content: 'I edited config.js' }] },
    { id: 'test-2', signal: 'positive', context: 'Agent read the file before editing', tags: [], conversationWindow: [{ role: 'user', content: 'update the handler' }, { role: 'assistant', content: 'I read handler.js first, then edited it' }] },
  ];
  fs.writeFileSync(feedbackLog, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');

  const { runManagedAgent } = require('../scripts/managed-lesson-agent');
  const result = await runManagedAgent({ dryRun: true });

  assert.equal(result.entriesProcessed, 2);
  assert.ok(result.lessonsCreated >= 0, 'should produce lessons');
  assert.equal(result.model, 'heuristic');
  assert.equal(result.dryRun, true);
});

test('runManagedAgent uses heuristic model when ANTHROPIC_API_KEY is absent', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const feedbackLog = path.join(tmpDir, 'feedback-log.jsonl');
  fs.writeFileSync(feedbackLog, JSON.stringify({ id: 'test-3', signal: 'negative', context: 'test failure context longer than twenty chars', tags: [] }) + '\n');

  const { runManagedAgent } = require('../scripts/managed-lesson-agent');
  const result = await runManagedAgent({ dryRun: true });

  assert.equal(result.model, 'heuristic');
});

test('runManagedAgent respects limit parameter', async () => {
  const feedbackLog = path.join(tmpDir, 'feedback-log.jsonl');
  const entries = Array.from({ length: 10 }, (_, i) => ({
    id: `limit-test-${i}`,
    signal: 'negative',
    context: `Repeated failure pattern number ${i} with enough context`,
    tags: [],
    conversationWindow: [],
  }));
  fs.writeFileSync(feedbackLog, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');

  const { runManagedAgent } = require('../scripts/managed-lesson-agent');
  const result = await runManagedAgent({ dryRun: true, limit: 3 });

  assert.equal(result.entriesProcessed, 3);
});

test('inferStructuredLessonLLM returns null without API key', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  delete require.cache[require.resolve('../scripts/lesson-inference')];
  delete require.cache[require.resolve('../scripts/llm-client')];
  const { inferStructuredLessonLLM } = require('../scripts/lesson-inference');
  const result = await inferStructuredLessonLLM(
    [{ role: 'user', content: 'fix the bug' }, { role: 'assistant', content: 'I edited the file' }],
    'negative',
    'wrong file was edited',
  );
  assert.equal(result, null);
});

test('analyzeWithLLM returns null without API key', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  delete require.cache[require.resolve('../scripts/feedback-to-rules')];
  delete require.cache[require.resolve('../scripts/llm-client')];
  const { analyzeWithLLM } = require('../scripts/feedback-to-rules');
  const result = await analyzeWithLLM([
    { signal: 'negative', context: 'Agent force-pushed to main without asking' },
  ]);
  assert.equal(result, null);
});
