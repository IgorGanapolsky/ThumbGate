const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');
const COMMAND = 'git push --force origin main';
const THUMB = '👎 You force pushed over the shared branch; rebase on origin/main and push without force.';

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dpo-incident-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const feedbackDir = path.join(dir, 'feedback');
  const transcripts = path.join(dir, 'transcripts');
  fs.mkdirSync(feedbackDir);
  fs.mkdirSync(path.join(transcripts, 'proj'), { recursive: true });
  return { feedbackDir, transcripts };
}

const user = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const said = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const ran = (name, input) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name, input }] } });
const base = () => [user('Get my branch onto main'), said('Pushing it now.'), ran('Bash', { command: COMMAND })];

function writeTranscript(transcripts, sessionId, entries) {
  fs.writeFileSync(path.join(transcripts, 'proj', `${sessionId}.jsonl`), entries.map((e) => JSON.stringify(e)).join('\n'));
}

const jsonl = (file) => (fs.existsSync(file)
  ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

function strictExport(feedbackDir) {
  const { buildStrictDpoPairs } = require('../scripts/export-dpo-pairs');
  const memories = jsonl(path.join(feedbackDir, 'memory-log.jsonl'));
  return buildStrictDpoPairs(memories.filter((m) => m.category === 'error'), [], { feedbackDir });
}

function assertOnePair(feedbackDir) {
  const { pairs, dropped } = strictExport(feedbackDir);
  assert.equal(pairs.length, 1, JSON.stringify(dropped));
  const [pair] = pairs;
  assert.match(pair.prompt, /user: Get my branch onto main/);
  assert.doesNotMatch(pair.prompt, /Task domain|git push --force origin main/);
  assert.equal(pair.rejected, COMMAND);
  assert.ok(pair.chosen.trim().length > 0);
}

function runHook(feedbackDir, transcripts, sessionId) {
  const env = {
    ...process.env,
    THUMBGATE_FEEDBACK_DIR: feedbackDir,
    THUMBGATE_TRANSCRIPTS_DIR: transcripts,
    THUMBGATE_NO_NUDGE: '1',
    THUMBGATE_NO_TELEMETRY: '1',
    THUMBGATE_DISABLE_CLAUDE_HISTORY_SYNC: '1',
  };
  for (const key of ['CLAUDE_USER_PROMPT', 'THUMBGATE_USER_PROMPT', 'CODEX_USER_PROMPT', 'USER_PROMPT']) delete env[key];
  return spawnSync(process.execPath, [CLI, 'hook-auto-capture'], {
    cwd: ROOT,
    env,
    input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: sessionId, prompt_id: 'p1', cwd: ROOT, prompt: THUMB }),
    encoding: 'utf8',
  });
}

test('hook thumbs-down exports one pair: conversation, real command, correction', (t) => {
  const { feedbackDir, transcripts } = setup(t);
  writeTranscript(transcripts, 'session-a', [...base(), user(THUMB)]);
  // A newer transcript from another session must never be picked.
  writeTranscript(transcripts, 'session-b', [user('unrelated'), ran('Bash', { command: 'ls' })]);
  const result = runHook(feedbackDir, transcripts, 'session-a');
  assert.equal(result.status, 0, result.stderr);
  assertOnePair(feedbackDir);
});

test('hook thumbs-down with no transcript for its session records no action', (t) => {
  const { feedbackDir, transcripts } = setup(t);
  writeTranscript(transcripts, 'session-b', base());
  assert.equal(runHook(feedbackDir, transcripts, 'session-a').status, 0);
  const [event] = jsonl(path.join(feedbackDir, 'feedback-log.jsonl'));
  assert.equal(event.lastAction, null);
  assert.equal(strictExport(feedbackDir).pairs.length, 0);
});

test('MCP capture_feedback finds the transcript holding this exact call', async (t) => {
  const { feedbackDir, transcripts } = setup(t);
  const args = {
    signal: 'down',
    context: 'Force pushed over the shared branch and lost a commit',
    whatWentWrong: 'Force pushed over the shared branch and lost a commit',
    whatToChange: 'Rebase on origin/main and push without force',
    tags: ['git'],
  };
  writeTranscript(transcripts, 'session-mcp', [...base(), user(THUMB), ran('mcp__thumbgate__capture_feedback', args)]);
  const saved = { dir: process.env.THUMBGATE_FEEDBACK_DIR, t: process.env.THUMBGATE_TRANSCRIPTS_DIR };
  process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;
  process.env.THUMBGATE_TRANSCRIPTS_DIR = transcripts;
  t.after(() => {
    for (const [key, value] of [['THUMBGATE_FEEDBACK_DIR', saved.dir], ['THUMBGATE_TRANSCRIPTS_DIR', saved.t]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const { callTool } = require('../adapters/mcp/server-stdio');
  await callTool('capture_feedback', args);
  assertOnePair(feedbackDir);
});

test('a complaint with no correction yields none, and distiller boilerplate is never the chosen side', () => {
  const { correctionIn } = require('../scripts/transcript-incident');
  assert.equal(correctionIn('👎 this is completely broken again'), null);
  assert.equal(correctionIn(THUMB), 'rebase on origin/main and push without force');
  const { buildStrictDpoPairs } = require('../scripts/export-dpo-pairs');
  const row = {
    id: 'fb_t', signal: 'negative', whatWentWrong: 'force pushed over shared work',
    whatToChange: 'Follow the earlier instruction instead of repeating the same pattern: do the thing',
    lastAction: { tool: 'Bash', command: COMMAND }, conversationWindow: [{ role: 'user', content: 'Get my branch onto main' }],
  };
  const out = buildStrictDpoPairs([{ id: 'm', sourceFeedbackId: 'fb_t' }], [], { feedbackRows: [row] });
  assert.equal(out.pairs.length, 0);
});

test('secrets in the transcript are redacted before storage', () => {
  const { incidentFrom, itemsOf } = require('../scripts/transcript-incident');
  const token = `ghp_${'a1B2'.repeat(9)}`;
  const incident = incidentFrom(itemsOf([user(`use ${token}`), said('ok'), ran('Bash', { command: 'ls' })]));
  assert.doesNotMatch(JSON.stringify(incident.conversationWindow), new RegExp(token));
});

test('a memory whose record was moved to a log backup still links; one with no id says so', (t) => {
  const { feedbackDir } = setup(t);
  const record = {
    id: 'fb_old', signal: 'negative', whatWentWrong: 'force pushed over shared work', whatToChange: 'rebase first',
    lastAction: { tool: 'Bash', command: COMMAND }, conversationWindow: [{ role: 'user', content: 'Get my branch onto main' }],
  };
  fs.writeFileSync(path.join(feedbackDir, 'feedback-log.jsonl.bak-1'), `${JSON.stringify(record)}\n`);
  const { buildStrictDpoPairs } = require('../scripts/export-dpo-pairs');
  const out = buildStrictDpoPairs([{ id: 'm1', sourceFeedbackId: 'fb_old' }, { id: 'm2' }], [], { feedbackDir });
  assert.equal(out.pairs.length, 1);
  assert.deepEqual(out.dropped.map((d) => d.reason), ['memory_has_no_source_feedback_id']);
});
