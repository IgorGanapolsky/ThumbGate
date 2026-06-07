'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

describe('dashboard wiring: tokenBurn appears in generateDashboard response', () => {
  let tempDir;
  let originalEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-token-burn-dash-'));
    originalEnv = process.env.THUMBGATE_FEEDBACK_DIR;
    process.env.THUMBGATE_FEEDBACK_DIR = tempDir;
    fs.writeFileSync(path.join(tempDir, 'feedback-log.jsonl'), '');
    fs.writeFileSync(path.join(tempDir, 'memory-log.jsonl'), '');
    fs.writeFileSync(
      path.join(tempDir, 'token-usage.jsonl'),
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        model: 'claude-sonnet-4-5',
        usage: { input_tokens: 1200, output_tokens: 300 },
      })}\n`,
    );
    for (const key of Object.keys(require.cache)) {
      if (key.includes('dashboard.js') || key.includes('token-burn')) delete require.cache[key];
    }
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('generateDashboard includes tokenBurn field in response', () => {
    const { generateDashboard } = require(path.join(ROOT, 'scripts', 'dashboard.js'));
    const data = generateDashboard(tempDir);

    assert.ok('tokenBurn' in data, 'dashboard response must include tokenBurn');
    assert.equal(data.tokenBurn.available, true);
    assert.equal(data.tokenBurn.trackedEvents, 1);
    assert.equal(data.tokenBurn.totalTokens, 1500);
  });

  test('tokenBurn carries weekly review recommendations', () => {
    const { generateDashboard } = require(path.join(ROOT, 'scripts', 'dashboard.js'));
    const data = generateDashboard(tempDir);

    assert.ok(data.tokenBurn.weeklyReview, 'tokenBurn must include behavior review');
    assert.ok(Array.isArray(data.tokenBurn.weeklyReview.recommendations));
    assert.ok(Array.isArray(data.tokenBurn.weeklyReview.controls));
  });
});

describe('dashboard HTML: token burn panel has no fake usage figures', () => {
  test('dashboard.html contains token burn panel and renderer', () => {
    const html = fs.readFileSync(path.join(ROOT, 'public', 'dashboard.html'), 'utf8');

    assert.match(html, /id="tokenBurnPanel"/, 'token burn panel must exist');
    assert.match(html, /id="tokenBurnDotGrid"/, 'token burn dot grid must exist');
    assert.match(html, /function renderTokenBurn/, 'renderTokenBurn function must be defined');
    assert.match(html, /renderTokenBurn\s*\(\s*data\.tokenBurn/, 'renderInsights must call renderTokenBurn with data.tokenBurn');
  });

  test('token burn panel starts with placeholders instead of hardcoded burn numbers', () => {
    const html = fs.readFileSync(path.join(ROOT, 'public', 'dashboard.html'), 'utf8');
    const match = html.match(/id="tokenBurnCost"[^>]*>([^<]*)</);

    assert.ok(match, 'tokenBurnCost element must exist');
    assert.equal(match[1].trim(), '—');
    assert.doesNotMatch(html, /100M|1B|\$1,?000|Token Burn Dashboard sample/i);
  });
});
