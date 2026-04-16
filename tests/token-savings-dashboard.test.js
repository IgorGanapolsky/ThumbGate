'use strict';

/**
 * Tests for real token-savings calculation + dashboard wiring.
 *
 * Truthfulness invariants:
 *   - Zero blocks MUST produce $0.00 (no marketing placeholder)
 *   - Savings MUST be derived from real gate-stats.blocked, not hardcoded
 *   - Methodology MUST be transparent: input/output tokens per block and
 *     blended price are exposed in the response
 *   - Dashboard MUST NOT ship hardcoded demo numbers as if they were the
 *     user's real savings
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { computeTokenSavings } = require(path.join(ROOT, 'scripts', 'token-savings'));

describe('computeTokenSavings: truthfulness invariants', () => {
  test('zero blocked calls returns $0.00 — no placeholder', () => {
    const r = computeTokenSavings({ blockedCalls: 0 });
    assert.equal(r.dollarsSaved, 0);
    assert.equal(r.dollarsSavedDisplay, '$0.00');
    assert.equal(r.tokensSavedTotal, 0);
    assert.equal(r.blockedCalls, 0);
  });

  test('1 blocked call produces a small but non-zero figure', () => {
    const r = computeTokenSavings({ blockedCalls: 1 });
    assert.ok(r.dollarsSaved > 0, 'savings must be > 0 with a real block');
    assert.ok(r.dollarsSaved < 0.10, '1 block should not suddenly be > 10 cents — sanity check on defaults');
    assert.ok(r.tokensSavedTotal >= 2000 + 600, '1 block ≥ default input+output tokens');
  });

  test('scales linearly with blockedCalls', () => {
    const r1 = computeTokenSavings({ blockedCalls: 1 });
    const r100 = computeTokenSavings({ blockedCalls: 100 });
    const ratio = r100.dollarsSaved / r1.dollarsSaved;
    assert.ok(Math.abs(ratio - 100) < 0.001, 'savings must scale linearly with block count');
  });

  test('methodology is exposed in response — no black box', () => {
    const r = computeTokenSavings({ blockedCalls: 5 });
    assert.ok(r.blendedPricePer1M, 'must expose blended price');
    assert.ok(typeof r.blendedPricePer1M.input === 'number');
    assert.ok(typeof r.blendedPricePer1M.output === 'number');
    assert.ok(r.modelMix, 'must expose model mix used');
  });

  test('negative or invalid blockedCalls clamps to zero', () => {
    assert.equal(computeTokenSavings({ blockedCalls: -5 }).dollarsSaved, 0);
    assert.equal(computeTokenSavings({ blockedCalls: NaN }).dollarsSaved, 0);
    assert.equal(computeTokenSavings({ blockedCalls: 'not a number' }).dollarsSaved, 0);
  });

  test('accepts custom modelMix and prices without silent-defaulting', () => {
    const r = computeTokenSavings({
      blockedCalls: 10,
      modelMix: { 'test-model': 1.0 },
      modelPrices: { 'test-model': { input: 1.0, output: 2.0 } },
    });
    // 10 blocks × (2000 in + 600 out) × ($1/1M in + $2/1M out)
    // = 10 * 2000 * 1/1M + 10 * 600 * 2/1M = 0.02 + 0.012 = 0.032
    assert.ok(Math.abs(r.dollarsSaved - 0.032) < 1e-9,
      `expected $0.032, got $${r.dollarsSaved}`);
  });
});

describe('dashboard wiring: tokenSavings appears in generateDashboard response', () => {
  let tempDir;
  let originalEnv;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-tokens-dash-'));
    originalEnv = process.env.THUMBGATE_FEEDBACK_DIR;
    process.env.THUMBGATE_FEEDBACK_DIR = tempDir;
    fs.writeFileSync(path.join(tempDir, 'feedback-log.jsonl'), '');
    fs.writeFileSync(path.join(tempDir, 'memory-log.jsonl'), '');
    // Clear require cache so dashboard.js picks up env
    for (const k of Object.keys(require.cache)) {
      if (k.includes('dashboard.js') || k.includes('token-savings')) delete require.cache[k];
    }
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = originalEnv;
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  test('generateDashboard includes tokenSavings field in response', () => {
    const { generateDashboard } = require(path.join(ROOT, 'scripts', 'dashboard.js'));
    const data = generateDashboard(tempDir);
    assert.ok('tokenSavings' in data, 'dashboard response must include tokenSavings field');
  });

  test('generateDashboard tokenSavings structure matches computeTokenSavings shape', () => {
    const { generateDashboard } = require(path.join(ROOT, 'scripts', 'dashboard.js'));
    const data = generateDashboard(tempDir);
    if (data.tokenSavings === null) return; // OK if module unavailable
    assert.ok(typeof data.tokenSavings.dollarsSaved === 'number');
    assert.ok(typeof data.tokenSavings.dollarsSavedDisplay === 'string');
    assert.ok(typeof data.tokenSavings.blockedCalls === 'number');
    assert.ok(data.tokenSavings.modelMix, 'must carry methodology');
  });

  test('tokenSavings.blockedCalls equals gateStats.blocked — single source of truth', () => {
    const { generateDashboard } = require(path.join(ROOT, 'scripts', 'dashboard.js'));
    const data = generateDashboard(tempDir);
    if (data.tokenSavings === null) return;
    assert.equal(
      data.tokenSavings.blockedCalls,
      Number(data.gateStats.blocked) || 0,
      'tokenSavings must be derived from gateStats.blocked — no independent counter',
    );
  });
});

describe('dashboard HTML: no hardcoded demo numbers in token-savings panel', () => {
  test('dashboard.html does NOT contain hardcoded $1247.82', () => {
    const html = fs.readFileSync(path.join(ROOT, 'public', 'dashboard.html'), 'utf8');
    assert.doesNotMatch(
      html,
      /\$\s*1,?247\.82/,
      'dashboard.html must not contain the landing-page sample figure',
    );
  });

  test('token-savings panel exists and has data placeholders (—), not numbers', () => {
    const html = fs.readFileSync(path.join(ROOT, 'public', 'dashboard.html'), 'utf8');
    assert.match(html, /id="tokenSavingsDollars"/, 'token-savings element must exist');
    // Initial content should be "—" or "$0.00", not a specific number
    const m = html.match(/id="tokenSavingsDollars"[^>]*>([^<]*)</);
    assert.ok(m, 'must find element content');
    assert.ok(
      /^(—|-|\$0\.00|\s*)$/.test(m[1].trim()),
      `token-savings element must start with placeholder, got: "${m[1]}"`,
    );
  });

  test('renderTokenSavings function exists and is called from renderInsights', () => {
    const html = fs.readFileSync(path.join(ROOT, 'public', 'dashboard.html'), 'utf8');
    assert.match(html, /function renderTokenSavings/, 'renderTokenSavings function must be defined');
    assert.match(html, /renderTokenSavings\s*\(\s*data\.tokenSavings/, 'renderInsights must call renderTokenSavings with data.tokenSavings');
  });
});
