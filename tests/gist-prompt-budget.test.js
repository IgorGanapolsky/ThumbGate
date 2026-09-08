'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  DEFAULT_FILES,
  buildGistPromptBudgetReport,
  formatGistPromptBudgetReport,
} = require('../scripts/gist-prompt-budget');
const { estimateTokens } = require('../scripts/context-footprint');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'gist-prompt-budget.js');

function makeFixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gist-budget-'));
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, name), body);
  }
  return root;
}

test('default files are the three agent instruction packs', () => {
  assert.deepEqual(DEFAULT_FILES, ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']);
});

test('uses context-footprint estimateTokens (chars/4), not learned tokens', () => {
  const text = 'abcd'.repeat(100);
  assert.equal(estimateTokens(text), 100);
  const root = makeFixture({ 'AGENTS.md': text });
  const report = buildGistPromptBudgetReport({
    root,
    files: ['AGENTS.md'],
    maxTokensPerFile: 1000,
    maxTokensTotal: 1000,
  });
  assert.equal(report.learnedTokens, false);
  assert.equal(report.packs[0].tokens, 100);
  assert.equal(report.status, 'ready');
});

test('fails when a pack exceeds the per-file budget', () => {
  const root = makeFixture({
    'AGENTS.md': 'x'.repeat(400),
  });
  const report = buildGistPromptBudgetReport({
    root,
    files: ['AGENTS.md'],
    maxTokensPerFile: 50,
    maxTokensTotal: 10000,
  });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'instruction_pack_over_file_budget'));
});

test('fails when the pack total exceeds the total budget', () => {
  const root = makeFixture({
    'AGENTS.md': 'a'.repeat(200),
    'CLAUDE.md': 'b'.repeat(200),
  });
  const report = buildGistPromptBudgetReport({
    root,
    files: ['AGENTS.md', 'CLAUDE.md'],
    maxTokensPerFile: 1000,
    maxTokensTotal: 80,
  });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'instruction_pack_over_total_budget'));
});

test('missing optional packs are actionable, not fail', () => {
  const root = makeFixture({ 'AGENTS.md': 'ok\n' });
  const report = buildGistPromptBudgetReport({
    root,
    files: ['AGENTS.md', 'MISSING.md'],
    maxTokensPerFile: 1000,
    maxTokensTotal: 1000,
  });
  assert.equal(report.status, 'actionable');
  assert.ok(report.findings.some((f) => f.id === 'instruction_pack_missing'));
});

test('format report names measure-only', () => {
  const root = makeFixture({ 'AGENTS.md': 'short\n' });
  const report = buildGistPromptBudgetReport({
    root,
    files: ['AGENTS.md'],
    maxTokensPerFile: 1000,
    maxTokensTotal: 1000,
  });
  assert.match(formatGistPromptBudgetReport(report), /Learned tokens: no/);
});

test('CLI --json --strict exits 1 on overflow', () => {
  const root = makeFixture({ 'AGENTS.md': 'z'.repeat(400) });
  const result = spawnSync(process.execPath, [
    SCRIPT,
    `--root=${root}`,
    '--files=AGENTS.md',
    '--max-tokens-per-file=10',
    '--strict',
    '--json',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'fail');
});

test('filesystem-root --root does not false-positive path_escape', () => {
  const report = buildGistPromptBudgetReport({
    root: path.parse(process.cwd()).root,
    files: ['NO_SUCH_GIST_PACK.md'],
    maxTokensPerFile: 1000,
    maxTokensTotal: 1000,
  });
  assert.equal(report.findings.some((f) => f.id === 'path_escape'), false);
  assert.ok(report.findings.some((f) => f.id === 'instruction_pack_missing'));
});

test('symlink that escapes --root is path_escape', () => {
  const root = makeFixture({ 'AGENTS.md': 'ok\n' });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gist-out-'));
  const secret = path.join(outside, 'secret.md');
  fs.writeFileSync(secret, 'secret\n');
  const link = path.join(root, 'ESCAPE.md');
  try {
    fs.symlinkSync(secret, link);
  } catch {
    return;
  }
  const report = buildGistPromptBudgetReport({
    root,
    files: ['ESCAPE.md'],
    maxTokensPerFile: 1000,
    maxTokensTotal: 1000,
  });
  assert.ok(report.findings.some((f) => f.id === 'path_escape'));
});

test('CLI --json exits 0 on a small pack', () => {
  const root = makeFixture({ 'AGENTS.md': 'tiny\n' });
  const result = spawnSync(process.execPath, [
    SCRIPT,
    `--root=${root}`,
    '--files=AGENTS.md',
    '--json',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'ready');
});
