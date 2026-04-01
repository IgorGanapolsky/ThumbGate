'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const STATUSLINE_PATH = path.join(__dirname, '..', 'scripts', 'statusline.sh');
const CACHE_UPDATER_PATH = path.join(__dirname, '..', 'scripts', 'hook-rlhf-cache-updater.js');

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
    const out = execSync(`echo '${sessionJson}' | bash ${STATUSLINE_PATH}`, {
      encoding: 'utf8',
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
    const out = execSync(`echo '${sessionJson}' | bash ${STATUSLINE_PATH}`, {
      encoding: 'utf8',
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

  execSync(`echo '${JSON.stringify(event)}' | node ${CACHE_UPDATER_PATH}`, {
    encoding: 'utf8',
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

test('setupClaude wires statusLine and cache hook into settings', () => {
  const cliSource = fs.readFileSync(path.join(__dirname, '..', 'bin', 'cli.js'), 'utf8');
  assert.ok(cliSource.includes('statusLine'), 'cli.js must wire statusLine');
  assert.ok(cliSource.includes('hook-rlhf-cache-updater'), 'cli.js must wire cache updater hook');
  assert.ok(cliSource.includes('statusline.sh'), 'cli.js must reference statusline.sh');
});
