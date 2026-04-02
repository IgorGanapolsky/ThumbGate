'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const DISTILLER_PATH = path.join(__dirname, '..', 'scripts', 'feedback-history-distiller.js');
const {
  DEFAULT_HISTORY_LIMIT,
  distillFeedbackHistory,
  findFeedbackEventById,
  getConversationPaths,
  normalizeChatHistory,
  readRecentConversationWindow,
  recordConversationEntry,
} = require('../scripts/feedback-history-distiller');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-history-distiller-'));
}

test('normalizeChatHistory accepts strings and structured entries', () => {
  const result = normalizeChatHistory([
    'Need proof before claiming done',
    { author: 'assistant', message: 'I skipped tests', timestamp: '2026-04-02T00:00:00.000Z' },
    null,
    42,
    { author: 'assistant', text: '   ' },
  ]);

  assert.equal(result.length, 2);
  assert.equal(result[0].text, 'Need proof before claiming done');
  assert.equal(result[1].author, 'assistant');
});

test('normalizeChatHistory rejects non-arrays', () => {
  assert.deepEqual(normalizeChatHistory('not-an-array'), []);
});

test('recordConversationEntry stores a readable recent conversation window', () => {
  const tmpDir = makeTmpDir();
  const stored = recordConversationEntry({
    author: 'user',
    text: 'Do not use Tailwind in this repo.',
    source: 'test',
  }, { feedbackDir: tmpDir });

  const window = readRecentConversationWindow({ feedbackDir: tmpDir, limit: DEFAULT_HISTORY_LIMIT });
  assert.equal(stored.recorded, true);
  assert.equal(window.length, 1);
  assert.equal(window[0].text, 'Do not use Tailwind in this repo.');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('recordConversationEntry rejects empty text', () => {
  const tmpDir = makeTmpDir();
  const stored = recordConversationEntry({
    author: 'user',
    text: '   ',
  }, { feedbackDir: tmpDir });

  assert.equal(stored.recorded, false);
  assert.equal(readRecentConversationWindow({ feedbackDir: tmpDir }).length, 0);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('readRecentConversationWindow ignores malformed JSONL rows', () => {
  const tmpDir = makeTmpDir();
  const { conversationLogPath } = getConversationPaths(tmpDir);
  fs.mkdirSync(path.dirname(conversationLogPath), { recursive: true });
  fs.writeFileSync(conversationLogPath, '{bad json}\n{"author":"user","text":"Need proof","source":"test"}\n');

  const window = readRecentConversationWindow({ feedbackDir: tmpDir });
  assert.equal(window.length, 1);
  assert.equal(window[0].text, 'Need proof');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('distillFeedbackHistory infers a negative lesson from explicit chatHistory', () => {
  const result = distillFeedbackHistory({
    signal: 'negative',
    context: 'thumbs down',
    chatHistory: [
      { author: 'user', text: 'Do not use Tailwind in this repo.' },
      { author: 'assistant', text: 'I used Tailwind classes in the hero rewrite.' },
    ],
  });

  assert.equal(result.usedHistory, true);
  assert.equal(result.source, 'chat_history');
  assert.match(result.inferredFields.whatWentWrong, /ignored a prior instruction/i);
  assert.match(result.inferredFields.whatToChange, /Follow the earlier instruction/i);
  assert.match(result.lessonProposal.proposedRule, /Never use Tailwind/i);
});

test('distillFeedbackHistory handles "don\'t" and long rule truncation', () => {
  const longInstruction = `Don't ship without proof ${'x'.repeat(220)}`;
  const result = distillFeedbackHistory({
    signal: 'negative',
    context: 'thumbs down',
    chatHistory: [
      { author: 'user', text: longInstruction },
      { author: 'assistant', text: 'I shipped the change without proof.' },
    ],
  });

  assert.equal(result.usedHistory, true);
  assert.match(result.lessonProposal.proposedRule, /^Never ship without proof/i);
  assert.match(result.lessonProposal.proposedRule, /…$/);
});

test('distillFeedbackHistory handles "avoid" correction language', () => {
  const result = distillFeedbackHistory({
    signal: 'negative',
    context: 'thumbs down',
    chatHistory: [
      { author: 'user', text: 'Avoid force-pushing main.' },
      { author: 'assistant', text: 'I force-pushed main anyway.' },
    ],
  });

  assert.match(result.lessonProposal.proposedRule, /^Avoid force-pushing main/i);
});

test('distillFeedbackHistory can infer from lastAction when no correction message exists', () => {
  const result = distillFeedbackHistory({
    signal: 'negative',
    context: 'thumbs down',
    lastAction: {
      tool: 'Bash',
      file: 'package.json',
      timestamp: '2026-04-02T00:00:00.000Z',
    },
  });

  assert.equal(result.usedHistory, true);
  assert.match(result.inferredFields.whatToChange, /Inspect and correct the failing step/i);
});

test('distillFeedbackHistory infers a positive lesson from local fallback history', () => {
  const tmpDir = makeTmpDir();
  recordConversationEntry({
    author: 'assistant',
    text: 'Ran npm test and attached the output before closing the task.',
    source: 'test',
  }, { feedbackDir: tmpDir });

  const result = distillFeedbackHistory({
    signal: 'positive',
    context: 'thumbs up',
    allowLocalConversationFallback: true,
    feedbackDir: tmpDir,
  });

  assert.equal(result.usedHistory, true);
  assert.equal(result.source, 'local_conversation_window');
  assert.match(result.inferredFields.whatWorked, /successful pattern/i);
  assert.match(result.lessonProposal.proposedRule, /Repeat the successful pattern/i);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('distillFeedbackHistory can reuse related feedback context when follow-up arrives later', () => {
  const tmpDir = makeTmpDir();
  const { feedbackLogPath } = getConversationPaths(tmpDir);
  fs.mkdirSync(path.dirname(feedbackLogPath), { recursive: true });
  fs.writeFileSync(feedbackLogPath, `${JSON.stringify({
    id: 'fb_parent_1',
    context: 'Quick capture from Claude Code statusline',
    conversationWindow: [
      { author: 'user', text: 'Never skip tests before claiming done.', source: 'chat_history' },
      { author: 'assistant', text: 'I claimed done without running npm test.', source: 'chat_history' },
    ],
    timestamp: '2026-04-02T00:00:00.000Z',
  })}\n`);

  const found = findFeedbackEventById('fb_parent_1', { feedbackDir: tmpDir });
  const result = distillFeedbackHistory({
    signal: 'negative',
    context: 'more detail',
    relatedFeedbackId: 'fb_parent_1',
    feedbackDir: tmpDir,
  });

  assert.ok(found);
  assert.equal(result.relatedFeedbackId, 'fb_parent_1');
  assert.equal(result.usedHistory, true);
  assert.equal(result.source, 'related_feedback');
  assert.match(result.inferredFields.whatWentWrong, /ignored a prior instruction/i);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('getConversationPaths honors feedback-dir environment overrides and cwd fallbacks', () => {
  const tmpDir = makeTmpDir();
  const savedFeedbackDir = process.env.RLHF_FEEDBACK_DIR;
  const savedRailwayDir = process.env.RAILWAY_VOLUME_MOUNT_PATH;

  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  assert.equal(getConversationPaths().feedbackDir, tmpDir);

  delete process.env.RLHF_FEEDBACK_DIR;
  process.env.RAILWAY_VOLUME_MOUNT_PATH = tmpDir;
  assert.equal(getConversationPaths().feedbackDir, path.join(tmpDir, 'feedback'));

  delete process.env.RAILWAY_VOLUME_MOUNT_PATH;
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-history-cwd-'));
  fs.mkdirSync(path.join(cwd, '.rlhf'), { recursive: true });
  const prevCwd = process.cwd();
  process.chdir(cwd);
  assert.equal(fs.realpathSync(getConversationPaths().feedbackDir), fs.realpathSync(path.join(cwd, '.rlhf')));
  fs.rmSync(path.join(cwd, '.rlhf'), { recursive: true, force: true });
  fs.mkdirSync(path.join(cwd, '.claude', 'memory', 'feedback'), { recursive: true });
  assert.equal(
    fs.realpathSync(getConversationPaths().feedbackDir),
    fs.realpathSync(path.join(cwd, '.claude', 'memory', 'feedback'))
  );
  process.chdir(prevCwd);

  if (savedFeedbackDir === undefined) delete process.env.RLHF_FEEDBACK_DIR;
  else process.env.RLHF_FEEDBACK_DIR = savedFeedbackDir;
  if (savedRailwayDir === undefined) delete process.env.RAILWAY_VOLUME_MOUNT_PATH;
  else process.env.RAILWAY_VOLUME_MOUNT_PATH = savedRailwayDir;

  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('getConversationPaths falls back to HOME project path when no local dirs exist', () => {
  const savedFeedbackDir = process.env.RLHF_FEEDBACK_DIR;
  const savedRailwayDir = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  const prevCwd = process.cwd();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-history-home-fallback-'));

  delete process.env.RLHF_FEEDBACK_DIR;
  delete process.env.RAILWAY_VOLUME_MOUNT_PATH;
  process.chdir(cwd);

  const expected = path.join(process.env.HOME || process.env.USERPROFILE || '', '.rlhf', 'projects', path.basename(cwd));
  assert.equal(getConversationPaths().feedbackDir, expected);

  process.chdir(prevCwd);
  if (savedFeedbackDir === undefined) delete process.env.RLHF_FEEDBACK_DIR;
  else process.env.RLHF_FEEDBACK_DIR = savedFeedbackDir;
  if (savedRailwayDir === undefined) delete process.env.RAILWAY_VOLUME_MOUNT_PATH;
  else process.env.RAILWAY_VOLUME_MOUNT_PATH = savedRailwayDir;
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('distillFeedbackHistory stays inert when no useful history exists', () => {
  const result = distillFeedbackHistory({
    signal: 'negative',
    context: 'thumbs down',
    chatHistory: [],
  });

  assert.equal(result.usedHistory, false);
  assert.deepEqual(result.inferredFields, {});
  assert.equal(result.lessonProposal, null);
});

test('distillFeedbackHistory stays inert for positive signals without a success pattern', () => {
  const result = distillFeedbackHistory({
    signal: 'positive',
    context: 'thumbs up',
    chatHistory: [{ author: 'assistant', text: 'hello there' }],
  });

  assert.equal(result.usedHistory, false);
  assert.deepEqual(result.inferredFields, {});
  assert.equal(result.lessonProposal, null);
});

test('findFeedbackEventById returns null when no matching feedback exists', () => {
  const tmpDir = makeTmpDir();
  assert.equal(findFeedbackEventById('missing-feedback', { feedbackDir: tmpDir }), null);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('CLI record command writes a conversation entry', () => {
  const tmpDir = makeTmpDir();
  execFileSync(process.execPath, [
    DISTILLER_PATH,
    'record',
    '--author=user',
    '--source=cli_test',
    '--feedbackDir=' + tmpDir,
    '--text=Need proof before saying deployed',
  ], {
    encoding: 'utf8',
  });

  const window = readRecentConversationWindow({ feedbackDir: tmpDir });
  assert.equal(window.length, 1);
  assert.equal(window[0].source, 'cli_test');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('CLI exits non-zero for unsupported commands and empty record payloads', () => {
  assert.throws(() => {
    execFileSync(process.execPath, [DISTILLER_PATH], { encoding: 'utf8', stdio: 'pipe' });
  }, /Usage:/);

  const tmpDir = makeTmpDir();
  assert.throws(() => {
    execFileSync(process.execPath, [
      DISTILLER_PATH,
      'record',
      '--feedbackDir=' + tmpDir,
      '--text=',
    ], { encoding: 'utf8', stdio: 'pipe' });
  }, /empty_text/);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
