'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  PROMPTS,
  runVisibilityCheck,
  formatReport,
  saveReport,
} = require('../scripts/ai-search-visibility');

test('PROMPTS array is non-empty and contains expected entries', () => {
  assert.ok(PROMPTS.length >= 5, `expected at least 5 prompts, got ${PROMPTS.length}`);
  assert.ok(PROMPTS.some((p) => /pre-action check/i.test(p)));
  assert.ok(PROMPTS.some((p) => /breaking production/i.test(p)));
  assert.ok(PROMPTS.some((p) => /parallel AI coding agent safety/i.test(p)));
  assert.ok(PROMPTS.some((p) => /environment inspection/i.test(p)));
  assert.ok(PROMPTS.some((p) => /thumbgate/i.test(p)));
});

test('runVisibilityCheck with mocked queryFn returns found results', async () => {
  const mockQuery = async (prompt) => {
    if (/pre-action check|alternatives to thumbgate/i.test(prompt)) {
      return 'ThumbGate is a popular pre-action check tool for AI agents.';
    }
    return 'There are many tools for AI safety.';
  };
  const results = await runVisibilityCheck({ queryFn: mockQuery });
  assert.equal(results.length, PROMPTS.length);
  const found = results.filter((r) => r.status === 'FOUND');
  assert.ok(found.length >= 2, `expected at least 2 FOUND, got ${found.length}`);
  const missing = results.filter((r) => r.status === 'MISSING');
  assert.ok(missing.length >= 1, 'expected at least 1 MISSING');
});

test('runVisibilityCheck manual mode (no API key) does not crash', async () => {
  const results = await runVisibilityCheck({ apiKey: null, queryFn: null });
  assert.equal(results.length, PROMPTS.length);
  assert.ok(results.every((r) => r.status === 'MANUAL'));
});

test('formatReport produces correct tags for found results', async () => {
  const mockQuery = async (prompt) => {
    if (/pre-action check/i.test(prompt)) return 'ThumbGate is great.';
    return 'No mention here.';
  };
  const results = await runVisibilityCheck({ queryFn: mockQuery });
  const report = formatReport(results);
  assert.ok(report.includes('[FOUND]'));
  assert.ok(report.includes('[MISSING]'));
  assert.ok(/Score: \d+\/\d+/.test(report));
});

test('formatReport manual-only produces manual score line', async () => {
  const results = await runVisibilityCheck({ apiKey: null, queryFn: null });
  const report = formatReport(results);
  assert.ok(report.includes('[MANUAL]'));
  assert.ok(report.includes('Manual checklist'));
});

describe('saveReport', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-vis-test-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('writes valid JSON to temp directory', async () => {
    const results = [
      { prompt: 'test prompt', status: 'FOUND', response: 'thumbgate mentioned' },
      { prompt: 'another prompt', status: 'MISSING', response: 'no mention' },
    ];
    const filePath = saveReport(results, { dir: tmpDir });
    assert.ok(fs.existsSync(filePath));
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.equal(data.score, '1/2');
    assert.equal(data.results.length, 2);
    assert.equal(data.results[0].status, 'FOUND');
  });
});

test('runVisibilityCheck handles queryFn errors gracefully', async () => {
  const errorQuery = async () => {
    throw new Error('API timeout');
  };
  const results = await runVisibilityCheck({ queryFn: errorQuery });
  assert.ok(results.every((r) => r.status === 'ERROR'));
  assert.ok(results.every((r) => r.error === 'API timeout'));
});
