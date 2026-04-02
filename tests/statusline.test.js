'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const STATUSLINE_PATH = path.join(__dirname, '..', 'scripts', 'statusline.sh');
const CACHE_UPDATER_PATH = path.join(__dirname, '..', 'scripts', 'hook-rlhf-cache-updater.js');
const AUTO_CAPTURE_HOOK_PATH = path.join(__dirname, '..', 'scripts', 'hook-auto-capture.sh');

test('statusline script exists and is executable', () => {
  assert.ok(fs.existsSync(STATUSLINE_PATH), 'scripts/statusline.sh must exist');
  const stat = fs.statSync(STATUSLINE_PATH);
  assert.ok(stat.mode & 0o111, 'scripts/statusline.sh must be executable');
});

test('statusline script reads jq input and outputs RLHF line', () => {
  const tmpCache = path.join(__dirname, '..', '.rlhf', 'statusline_cache.json');
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
      env: { ...process.env, RLHF_FEEDBACK_DIR: path.join(__dirname, '..') },
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
  const tmpCache = path.join(__dirname, '..', '.rlhf', 'statusline_cache.json');
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
      env: { ...process.env, RLHF_FEEDBACK_DIR: path.join(__dirname, '..') },
      timeout: 5000
    });
    assert.ok(out.includes('no feedback yet'), 'should show no-data message');
  } finally {
    if (oldData !== null) fs.writeFileSync(tmpCache, oldData);
    else fs.unlinkSync(tmpCache);
  }
});

test('cache updater hook script exists', () => {
  assert.ok(fs.existsSync(CACHE_UPDATER_PATH), 'scripts/hook-rlhf-cache-updater.js must exist');
});

test('user prompt hook records recent conversation history for statusline distillation', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-statusline-hook-'));
  const conversationPath = path.join(tmpDir, 'conversation-window.jsonl');

  execFileSync('bash', [AUTO_CAPTURE_HOOK_PATH], {
    encoding: 'utf8',
    env: {
      ...process.env,
      RLHF_FEEDBACK_DIR: tmpDir,
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
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rlhf-test-'));
  const tmpCache = path.join(tmpDir, '.rlhf', 'statusline_cache.json');

  const event = {
    tool_name: 'mcp__rlhf__feedback_stats',
    tool_response: JSON.stringify({
      total: 100, totalPositive: 20, totalNegative: 80,
      approvalRate: 0.2, trend: 'stable',
      rubric: { samples: 42 }
    })
  };

  execFileSync(process.execPath, [CACHE_UPDATER_PATH], {
    encoding: 'utf8',
    input: JSON.stringify(event),
    env: { ...process.env, RLHF_FEEDBACK_DIR: tmpDir },
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

test('statusline shows lesson info when last_lesson is present in cache', () => {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rlhf-sl-lesson-'));
  const tmpCache = path.join(tmpDir, '.rlhf', 'statusline_cache.json');
  fs.mkdirSync(path.dirname(tmpCache), { recursive: true });

  fs.writeFileSync(tmpCache, JSON.stringify({
    thumbs_up: '5', thumbs_down: '2', lessons: '3', trend: 'improving',
    last_lesson: {
      icon: '\u2705',
      memoryId: 'mem_123_abc',
      feedbackId: 'fb_123_abc',
      signal: 'positive',
      summary: 'profile save fix approved',
      turnCount: 3,
      timestamp: Math.floor(Date.now() / 1000),
    }
  }));

  try {
    const sessionJson = JSON.stringify({ context_window: { used_percentage: 25 } });
    const out = execFileSync('bash', [STATUSLINE_PATH], {
      encoding: 'utf8',
      input: sessionJson,
      env: { ...process.env, RLHF_FEEDBACK_DIR: tmpDir },
      timeout: 5000
    });
    assert.ok(out.includes('mem_123_abc'), 'should show memory ID in lesson');
    assert.ok(out.includes('profile save fix approved'), 'should show lesson summary');
    assert.ok(out.includes('3 turns captured'), 'should show turn count');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('statusline shows warning when last_lesson has no memoryId (rejected)', () => {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rlhf-sl-reject-'));
  const tmpCache = path.join(tmpDir, '.rlhf', 'statusline_cache.json');
  fs.mkdirSync(path.dirname(tmpCache), { recursive: true });

  fs.writeFileSync(tmpCache, JSON.stringify({
    thumbs_up: '5', thumbs_down: '2', lessons: '3', trend: 'stable',
    last_lesson: {
      icon: '\u26A0\uFE0F',
      memoryId: null,
      feedbackId: 'fb_456_def',
      signal: 'negative',
      summary: 'Feedback needs detail',
      turnCount: 0,
      timestamp: Math.floor(Date.now() / 1000),
    }
  }));

  try {
    const sessionJson = JSON.stringify({ context_window: { used_percentage: 10 } });
    const out = execFileSync('bash', [STATUSLINE_PATH], {
      encoding: 'utf8',
      input: sessionJson,
      env: { ...process.env, RLHF_FEEDBACK_DIR: tmpDir },
      timeout: 5000
    });
    assert.ok(out.includes('Feedback needs detail'), 'should show warning summary');
    assert.ok(!out.includes('turns captured'), 'should not show turns for rejected feedback');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('updateStatuslineWithLesson writes lesson to cache on accepted feedback', () => {
  const { updateStatuslineWithLesson } = require('../scripts/feedback-loop');
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rlhf-sl-'));
  const cachePath = path.join(tmpDir, '.rlhf', 'statusline_cache.json');

  // Seed initial cache
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify({ thumbs_up: '5', thumbs_down: '2' }));

  const origEnv = process.env.RLHF_FEEDBACK_DIR;
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  try {
    updateStatuslineWithLesson({
      accepted: true,
      signal: 'positive',
      memoryId: 'mem_test_001',
      feedbackId: 'fb_test_001',
      lesson: 'profile save fix approved',
      turnCount: 3,
    });

    assert.ok(fs.existsSync(cachePath), 'cache file should exist');
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    assert.strictEqual(cache.thumbs_up, '5', 'should preserve existing cache fields');
    assert.ok(cache.last_lesson, 'should have last_lesson');
    assert.strictEqual(cache.last_lesson.memoryId, 'mem_test_001');
    assert.strictEqual(cache.last_lesson.signal, 'positive');
    assert.strictEqual(cache.last_lesson.summary, 'profile save fix approved');
    assert.strictEqual(cache.last_lesson.turnCount, 3);
    assert.strictEqual(cache.last_lesson.icon, '\u2705');
  } finally {
    process.env.RLHF_FEEDBACK_DIR = origEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('updateStatuslineWithLesson writes warning on rejected feedback', () => {
  const { updateStatuslineWithLesson } = require('../scripts/feedback-loop');
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rlhf-sl-'));

  const origEnv = process.env.RLHF_FEEDBACK_DIR;
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  try {
    updateStatuslineWithLesson({
      accepted: false,
      signal: 'negative',
      feedbackId: 'fb_test_002',
    });

    const cachePath = path.join(tmpDir, '.rlhf', 'statusline_cache.json');
    assert.ok(fs.existsSync(cachePath), 'cache file should be created');
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    assert.ok(cache.last_lesson, 'should have last_lesson');
    assert.strictEqual(cache.last_lesson.memoryId, null);
    assert.strictEqual(cache.last_lesson.icon, '\u26A0\uFE0F');
    assert.ok(cache.last_lesson.summary.includes('Feedback needs detail'));
  } finally {
    process.env.RLHF_FEEDBACK_DIR = origEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('captureFeedback updates statusline cache on accepted capture', () => {
  const { captureFeedback } = require('../scripts/feedback-loop');
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rlhf-sl-'));

  const origEnv = process.env.RLHF_FEEDBACK_DIR;
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  try {
    const result = captureFeedback({
      signal: 'up',
      context: 'Fixed the profile save 401 error by using correct guestId',
      whatWorked: 'Used userProfile.guestId as primary source',
    });

    if (result.accepted) {
      const cachePath = path.join(tmpDir, '.rlhf', 'statusline_cache.json');
      assert.ok(fs.existsSync(cachePath), 'statusline cache should be updated on accepted feedback');
      const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      assert.ok(cache.last_lesson, 'should have last_lesson after accepted capture');
      assert.ok(cache.last_lesson.memoryId, 'should have memoryId');
      assert.strictEqual(cache.last_lesson.signal, 'positive');
    }
  } finally {
    process.env.RLHF_FEEDBACK_DIR = origEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('setupClaude wires statusLine and cache hook into settings', () => {
  const cliSource = fs.readFileSync(path.join(__dirname, '..', 'bin', 'cli.js'), 'utf8');
  assert.ok(cliSource.includes('statusLine'), 'cli.js must wire statusLine');
  assert.ok(cliSource.includes('hook-rlhf-cache-updater'), 'cli.js must wire cache updater hook');
  assert.ok(cliSource.includes('statusline.sh'), 'cli.js must reference statusline.sh');
});
