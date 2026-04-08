'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { cacheUpdateHookCommand, statuslineCommand } = require('../scripts/hook-runtime');

const STATUSLINE_PATH = path.join(__dirname, '..', 'scripts', 'statusline.sh');
const CACHE_UPDATER_PATH = path.join(__dirname, '..', 'scripts', 'hook-thumbgate-cache-updater.js');
const AUTO_CAPTURE_HOOK_PATH = path.join(__dirname, '..', 'scripts', 'hook-auto-capture.sh');

test('statusline script exists and is executable', () => {
  assert.ok(fs.existsSync(STATUSLINE_PATH), 'scripts/statusline.sh must exist');
  const stat = fs.statSync(STATUSLINE_PATH);
  assert.ok(stat.mode & 0o111, 'scripts/statusline.sh must be executable');
});

test('statusline script reads jq input and outputs ThumbGate line', () => {
  const tmpCache = path.join(__dirname, '..', '.thumbgate', 'statusline_cache.json');
  const cacheDir = path.dirname(tmpCache);
  fs.mkdirSync(cacheDir, { recursive: true });
  const existed = fs.existsSync(tmpCache);
  const oldData = existed ? fs.readFileSync(tmpCache, 'utf8') : null;

  fs.writeFileSync(tmpCache, JSON.stringify({
    thumbs_up: '10', thumbs_down: '5', lessons: '3', trend: 'improving'
  }));

  try {
    const sessionJson = JSON.stringify({ context_window: { used_percentage: 25 } });
    const out = execFileSync('bash', [STATUSLINE_PATH], {
      encoding: 'utf8',
      input: sessionJson,
      env: { ...process.env, THUMBGATE_FEEDBACK_DIR: path.join(__dirname, '..') },
      timeout: 5000
    });
    assert.ok(out.includes('10'), 'should show thumbs up count');
    assert.ok(out.includes('5'), 'should show thumbs down count');
    assert.ok(out.includes('3'), 'should show lessons count');
    assert.ok(out.includes('lessons'), 'should include word lessons');
  } finally {
    if (oldData !== null) fs.writeFileSync(tmpCache, oldData);
    else fs.unlinkSync(tmpCache);
  }
});

test('statusline shows "no feedback yet" when cache has zeros', () => {
  const tmpCache = path.join(__dirname, '..', '.thumbgate', 'statusline_cache.json');
  const cacheDir = path.dirname(tmpCache);
  fs.mkdirSync(cacheDir, { recursive: true });
  const existed = fs.existsSync(tmpCache);
  const oldData = existed ? fs.readFileSync(tmpCache, 'utf8') : null;

  fs.writeFileSync(tmpCache, JSON.stringify({
    thumbs_up: '0', thumbs_down: '0', lessons: '0', trend: '?'
  }));

  try {
    const sessionJson = JSON.stringify({ context_window: { used_percentage: 10 } });
    const out = execFileSync('bash', [STATUSLINE_PATH], {
      encoding: 'utf8',
      input: sessionJson,
      env: { ...process.env, THUMBGATE_FEEDBACK_DIR: path.join(__dirname, '..') },
      timeout: 5000
    });
    assert.ok(out.includes('no feedback yet'), 'should show no-data message');
  } finally {
    if (oldData !== null) fs.writeFileSync(tmpCache, oldData);
    else fs.unlinkSync(tmpCache);
  }
});

test('cache updater hook script exists', () => {
  assert.ok(fs.existsSync(CACHE_UPDATER_PATH), 'scripts/hook-thumbgate-cache-updater.js must exist');
});

test('user prompt hook records recent conversation history for statusline distillation', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-statusline-hook-'));
  const conversationPath = path.join(tmpDir, 'conversation-window.jsonl');

  execFileSync('bash', [AUTO_CAPTURE_HOOK_PATH], {
    encoding: 'utf8',
    env: {
      ...process.env,
      THUMBGATE_FEEDBACK_DIR: tmpDir,
      CLAUDE_USER_PROMPT: 'Need proof before saying deployed',
    },
    timeout: 5000,
  });

  assert.ok(fs.existsSync(conversationPath), 'conversation-window.jsonl should be created');
  const entries = fs.readFileSync(conversationPath, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].text, 'Need proof before saying deployed');
  assert.equal(entries[0].source, 'claude_user_prompt');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('cache updater writes cache from feedback_stats input', () => {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'thumbgate-test-'));
  const tmpCache = path.join(tmpDir, '.thumbgate', 'statusline_cache.json');

  const event = {
    tool_name: 'mcp__thumbgate__feedback_stats',
    tool_response: JSON.stringify({
      total: 100, totalPositive: 20, totalNegative: 80,
      approvalRate: 0.2, trend: 'stable',
      rubric: { samples: 42 }
    })
  };

  execFileSync(process.execPath, [CACHE_UPDATER_PATH], {
    encoding: 'utf8',
    input: JSON.stringify(event),
    env: { ...process.env, THUMBGATE_FEEDBACK_DIR: tmpDir },
    timeout: 5000
  });

  assert.ok(fs.existsSync(tmpCache), 'cache file should be created');
  const cache = JSON.parse(fs.readFileSync(tmpCache, 'utf8'));
  assert.strictEqual(cache.thumbs_up, '20');
  assert.strictEqual(cache.thumbs_down, '80');
  assert.strictEqual(cache.lessons, '42');
  assert.strictEqual(cache.trend, 'stable');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('setupClaude uses portable ThumbGate commands for status line and cache updates', () => {
  const cliSource = fs.readFileSync(path.join(__dirname, '..', 'bin', 'cli.js'), 'utf8');
  assert.ok(cliSource.includes('statusLine'), 'cli.js must wire statusLine');
  assert.ok(cliSource.includes('cacheUpdateHookCommand'), 'cli.js must wire the portable cache updater command');
  assert.ok(cliSource.includes('statuslineCommand'), 'cli.js must wire the portable statusline command');
  assert.match(cacheUpdateHookCommand(), /(thumbgate@.+ cache-update|bin\/cli\.js" cache-update)/);
  assert.match(statuslineCommand(), /(thumbgate@.+ statusline-render|bin\/cli\.js" statusline-render)/);
});
