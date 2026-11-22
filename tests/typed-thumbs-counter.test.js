'use strict';

// TG-counter-2026-11-22: typing "thumbs down" in a project must raise that
// project's status-bar counter by exactly 1 each time. On 22 Nov 2026 three
// typed thumbs-downs in one session (1:09, 1:12, 1:14 PM) left the counter at 1,
// because a repeat of the same bare text inside five minutes was treated as a
// duplicate delivery of the first.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'cli.js');
const SESSION = 'session-typed-counter';

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeScratchProject(t) {
  const home = makeTempDir('thumbgate-counter-home-');
  const project = makeTempDir('thumbgate-counter-project-');
  t.after(() => {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  });
  return { home, project };
}

function typePrompt({ home, project }, prompt, timestamp) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const key of ['THUMBGATE_FEEDBACK_DIR', 'THUMBGATE_DATA_DIR', 'THUMBGATE_PROJECT_DIR', 'CLAUDE_PROJECT_DIR']) {
      delete env[key];
    }
    const child = spawn(process.execPath, [CLI, 'hook-auto-capture'], {
      cwd: project,
      env: {
        ...env,
        HOME: home,
        CLAUDE_PROJECT_DIR: project,
        THUMBGATE_NO_NUDGE: '1',
        THUMBGATE_NO_TELEMETRY: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout }));
    child.stdin.end(JSON.stringify({
      session_id: SESSION,
      cwd: project,
      hook_event_name: 'UserPromptSubmit',
      prompt,
      timestamp,
    }));
  });
}

function counter(project) {
  const cachePath = path.join(project, '.thumbgate', 'statusline_cache.json');
  const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  return { up: Number(cache.thumbs_up), down: Number(cache.thumbs_down) };
}

test('each typed "thumbs down" minutes apart raises the project counter by exactly 1', async (t) => {
  const scratch = makeScratchProject(t);
  const start = Date.now();

  const first = await typePrompt(scratch, 'thumbs down', start);
  assert.equal(first.code, 0);
  assert.deepEqual(counter(scratch.project), { up: 0, down: 1 });

  const second = await typePrompt(scratch, 'thumbs down', start + 2 * 60 * 1000);
  assert.equal(second.code, 0);
  assert.doesNotMatch(second.stdout, /already captured/i);
  assert.deepEqual(counter(scratch.project), { up: 0, down: 2 });

  const third = await typePrompt(scratch, 'thumbs down', start + 4.5 * 60 * 1000);
  assert.equal(third.code, 0);
  assert.deepEqual(counter(scratch.project), { up: 0, down: 3 });
});

test('a second delivery of the same typed event does not raise the counter', async (t) => {
  const scratch = makeScratchProject(t);
  const start = Date.now();

  await typePrompt(scratch, 'thumbs down', start);
  assert.deepEqual(counter(scratch.project), { up: 0, down: 1 });

  const redelivery = await typePrompt(scratch, 'thumbs down', start + 4000);
  assert.equal(redelivery.code, 0);
  assert.match(redelivery.stdout, /already captured/i);
  assert.deepEqual(counter(scratch.project), { up: 0, down: 1 });
});

test('a capture that is logged but not promoted still raises the counter', (t) => {
  const scratch = makeScratchProject(t);
  const feedbackDir = path.join(scratch.project, '.thumbgate');
  const script = `
    const { captureFeedback } = require(${JSON.stringify(path.join(ROOT, 'scripts', 'feedback-loop'))});
    const result = captureFeedback({
      signal: 'down',
      context: 'transport transcript dump',
      whatWentWrong: 'x'.repeat(200000),
      reviewOrigin: 'human',
    });
    process.stdout.write(JSON.stringify({ status: result.status, signalLogged: Boolean(result.signalLogged) }));
  `;
  const { spawnSync } = require('node:child_process');
  const run = spawnSync(process.execPath, ['-e', script], {
    cwd: scratch.project,
    env: {
      ...process.env,
      HOME: scratch.home,
      THUMBGATE_FEEDBACK_DIR: feedbackDir,
      THUMBGATE_NO_TELEMETRY: '1',
    },
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  const outcome = JSON.parse(run.stdout);
  assert.equal(outcome.signalLogged, true);
  assert.equal(outcome.status, 'rejected');
  assert.deepEqual(counter(scratch.project), { up: 0, down: 1 });
});
