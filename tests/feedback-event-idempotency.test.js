'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');

const { syncClaudeHistoryFeedback } = require('../scripts/claude-feedback-sync');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

function runPromptHook(payload, feedbackDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, 'hook-auto-capture'], {
      cwd: ROOT,
      env: {
        ...process.env,
        THUMBGATE_FEEDBACK_DIR: feedbackDir,
        THUMBGATE_NO_NUDGE: '1',
        THUMBGATE_NO_TELEMETRY: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(payload));
  });
}

function feedbackEnvelope(overrides = {}) {
  return {
    session_id: 'session-idempotency',
    prompt_id: 'prompt-idempotency',
    cwd: ROOT,
    hook_event_name: 'UserPromptSubmit',
    prompt: 'thumbs up The evidence-backed regression verification was clear',
    ...overrides,
  };
}

test('parallel duplicate hook registrations produce one feedback event and one downstream lesson', async (t) => {
  const feedbackDir = makeTempDir('thumbgate-feedback-idempotency-');
  t.after(() => fs.rmSync(feedbackDir, { recursive: true, force: true }));

  const payload = feedbackEnvelope();
  const results = await Promise.all([
    runPromptHook(payload, feedbackDir),
    runPromptHook(payload, feedbackDir),
    runPromptHook(payload, feedbackDir),
  ]);

  assert.deepEqual(results.map((result) => result.code), [0, 0, 0]);
  assert.equal(results.filter((result) => /already captured/i.test(result.stdout)).length, 2);
  const feedbackRows = readJsonl(path.join(feedbackDir, 'feedback-log.jsonl'));
  assert.equal(feedbackRows.length, 1);
  assert.match(feedbackRows[0].sourceEvent.key, /^fev_[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(feedbackRows[0].sourceEvent), /session-idempotency|prompt-idempotency/);
  assert.equal(readJsonl(path.join(feedbackDir, 'memory-log.jsonl')).length, 1);
  assert.equal(readJsonl(path.join(feedbackDir, 'feedback-sequences.jsonl')).length, 1);
  assert.equal(readJsonl(path.join(feedbackDir, 'conversation-window.jsonl')).length, 1);

  const summary = JSON.parse(fs.readFileSync(path.join(feedbackDir, 'feedback-summary.json'), 'utf8'));
  assert.equal(summary.total, 1);
  assert.equal(summary.positive, 1);
  assert.equal(summary.accepted, 1);

  const cache = JSON.parse(fs.readFileSync(path.join(feedbackDir, 'statusline_cache.json'), 'utf8'));
  assert.equal(cache.total_feedback, '1');
  assert.equal(cache.thumbs_up, '1');

  const db = new Database(path.join(feedbackDir, 'lessons.sqlite'), { readonly: true });
  t.after(() => db.close());
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM lessons').get().count, 1);
});

test('distinct prompt IDs remain distinct even when session and text match', async (t) => {
  const feedbackDir = makeTempDir('thumbgate-feedback-distinct-prompts-');
  t.after(() => fs.rmSync(feedbackDir, { recursive: true, force: true }));

  const first = await runPromptHook(feedbackEnvelope({ prompt_id: 'prompt-a' }), feedbackDir);
  const second = await runPromptHook(feedbackEnvelope({ prompt_id: 'prompt-b' }), feedbackDir);

  assert.equal(first.code, 0);
  assert.equal(second.code, 0);
  assert.equal(readJsonl(path.join(feedbackDir, 'feedback-log.jsonl')).length, 2);
  const summary = JSON.parse(fs.readFileSync(path.join(feedbackDir, 'feedback-summary.json'), 'utf8'));
  assert.equal(summary.total, 2);
});

test('a stable prompt ID remains idempotent after the fallback window expires', async (t) => {
  const feedbackDir = makeTempDir('thumbgate-feedback-stable-prompt-');
  t.after(() => fs.rmSync(feedbackDir, { recursive: true, force: true }));

  const first = await runPromptHook(feedbackEnvelope(), feedbackDir);
  assert.equal(first.code, 0);

  const claimsDir = path.join(feedbackDir, '.feedback-event-claims');
  const [claimName] = fs.readdirSync(claimsDir);
  const statePath = path.join(claimsDir, claimName, 'state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.completedAtMs = Date.now() - 31_000;
  fs.writeFileSync(statePath, `${JSON.stringify(state)}\n`);

  const second = await runPromptHook(feedbackEnvelope({ timestamp: Date.now() + 31_000 }), feedbackDir);
  assert.equal(second.code, 0);
  assert.match(second.stdout, /already captured/i);
  assert.equal(readJsonl(path.join(feedbackDir, 'feedback-log.jsonl')).length, 1);
});

test('history-first capture is reused by the live prompt hook', async (t) => {
  const feedbackDir = makeTempDir('thumbgate-feedback-history-first-');
  const homeDir = makeTempDir('thumbgate-feedback-history-home-');
  const projectDir = makeTempDir('thumbgate-feedback-history-project-');
  const historyPath = path.join(homeDir, '.claude', 'history.jsonl');
  t.after(() => {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  const prompt = 'thumbs down The response omitted the required verification evidence';
  const timestamp = Date.now();
  writeJsonl(historyPath, [{
    display: prompt,
    timestamp,
    project: projectDir,
    sessionId: 'history-first-session',
  }]);

  const syncResult = syncClaudeHistoryFeedback({ feedbackDir, projectDir, historyPath });
  assert.equal(syncResult.importedCount, 1);

  const hookResult = await runPromptHook(feedbackEnvelope({
    session_id: 'history-first-session',
    prompt_id: undefined,
    cwd: projectDir,
    prompt,
  }), feedbackDir);
  assert.equal(hookResult.code, 0);
  assert.match(hookResult.stdout, /already captured/i);
  assert.equal(readJsonl(path.join(feedbackDir, 'feedback-log.jsonl')).length, 1);
});

test('live-hook-first capture is not imported again from Claude history', async (t) => {
  const feedbackDir = makeTempDir('thumbgate-feedback-hook-first-');
  const homeDir = makeTempDir('thumbgate-feedback-hook-home-');
  const projectDir = makeTempDir('thumbgate-feedback-hook-project-');
  const historyPath = path.join(homeDir, '.claude', 'history.jsonl');
  t.after(() => {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  const prompt = 'thumbs up The final answer included exact test evidence';
  const timestamp = Date.now();
  const hookResult = await runPromptHook(feedbackEnvelope({
    session_id: 'hook-first-session',
    prompt_id: undefined,
    cwd: projectDir,
    prompt,
  }), feedbackDir);
  assert.equal(hookResult.code, 0);

  writeJsonl(historyPath, [{
    display: prompt,
    timestamp,
    project: projectDir,
    sessionId: 'hook-first-session',
  }]);
  const syncResult = syncClaudeHistoryFeedback({ feedbackDir, projectDir, historyPath });
  assert.equal(syncResult.importedCount, 0);
  assert.equal(syncResult.skippedCount, 1);
  assert.equal(readJsonl(path.join(feedbackDir, 'feedback-log.jsonl')).length, 1);
});

test('history fallback ignores ordinary repair requests that merely say fix this', (t) => {
  const feedbackDir = makeTempDir('thumbgate-feedback-history-nonsignal-');
  const homeDir = makeTempDir('thumbgate-feedback-history-nonsignal-home-');
  const projectDir = makeTempDir('thumbgate-feedback-history-nonsignal-project-');
  const historyPath = path.join(homeDir, '.claude', 'history.jsonl');
  t.after(() => {
    fs.rmSync(feedbackDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  writeJsonl(historyPath, [{
    display: 'fix this bug before closing the task',
    timestamp: Date.now(),
    project: projectDir,
    sessionId: 'non-signal-session',
  }]);

  const syncResult = syncClaudeHistoryFeedback({ feedbackDir, projectDir, historyPath });
  assert.equal(syncResult.importedCount, 0);
  assert.equal(readJsonl(path.join(feedbackDir, 'feedback-log.jsonl')).length, 0);
});
