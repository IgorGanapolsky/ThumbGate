// tests/plugin-eval-gate.test.js
// Release gate: the plugin eval WITH score must not drop below the last accepted release's.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('node:child_process');

const { evaluateGate, renderTable } = require('../scripts/plugin-eval-gate');

const baseline = { withScore: 0.8, cases: { 'm01-a': 1, 'm02-b': 0.5, 'a01-c': 1 } };
const results = (scores) => ({
  cases: Object.entries(scores).map(([name, withScore]) => ({ name, with: withScore, without: 0.5, delta: withScore - 0.5, pass3: withScore === 1, withPassed: 3, runs: 3 })),
});

test('passes when the WITH score equals or beats the baseline', () => {
  const same = evaluateGate(results({ 'm01-a': 1, 'm02-b': 0.5, 'a01-c': 1 }), { ...baseline, withScore: 0.8333 });
  assert.equal(same.ok, true);
  const better = evaluateGate(results({ 'm01-a': 1, 'm02-b': 1, 'a01-c': 1 }), baseline);
  assert.equal(better.ok, true);
  assert.ok(better.withScore > baseline.withScore);
});

test('fails when the WITH score drops, and names the cases that fell', () => {
  const r = evaluateGate(results({ 'm01-a': 0, 'm02-b': 0.5, 'a01-c': 1 }), baseline);
  assert.equal(r.ok, false);
  assert.deepEqual(r.regressed.map((c) => c.name), ['m01-a']);
  assert.match(r.reason, /0\.5.*below.*0\.8/);
});

test('fails closed on empty results or a missing baseline score', () => {
  assert.equal(evaluateGate({ cases: [] }, baseline).ok, false);
  assert.equal(evaluateGate(results({ 'm01-a': 1 }), {}).ok, false);
  assert.equal(evaluateGate(null, baseline).ok, false);
});

test('accepts raw `claude plugin eval --json` output (arms and aggregates)', () => {
  const run = (passed) => ({ passed });
  const raw = { cases: [
    { name: 'm01-a', arms: { with: [run(true), run(true), run(true)], without: [run(false)] }, aggregates: { score: 1, scoreWithout: 0, delta: 1 } },
    { name: 'm02-b', arms: { with: [run(true), run(false), run(true)], without: [run(true)] }, aggregates: { score: 0.67, scoreWithout: 1, delta: -0.33 } },
  ] };
  const r = evaluateGate(raw, { withScore: 0.9, cases: {} });
  assert.equal(r.ok, false);
  assert.ok(Math.abs(r.withScore - 0.835) < 1e-9);
  const { normalizeResults } = require('../scripts/plugin-eval-gate');
  assert.deepEqual(normalizeResults(raw).cases.map((c) => c.pass3), [true, false]);
});

test('renderTable lists case, WITH, W/OUT, Delta and pass^3', () => {
  const table = renderTable(results({ 'm01-a': 1, 'm02-b': 0.5 }));
  assert.match(table, /\| case \| WITH \| W\/OUT \| Delta \| pass\^3 \|/);
  assert.match(table, /\| m01-a \| 1\.00 \| 0\.50 \| \+0\.50 \| yes \|/);
  assert.match(table, /\| m02-b \| 0\.50 \| 0\.50 \| 0\.00 \| no \|/);
});

test('CLI exits 0 on pass, 1 on regression, 2 on unreadable input', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-eval-gate-'));
  try {
    const good = path.join(dir, 'good.json');
    const bad = path.join(dir, 'bad.json');
    const base = path.join(dir, 'base.json');
    fs.writeFileSync(good, JSON.stringify(results({ 'm01-a': 1, 'm02-b': 1, 'a01-c': 1 })));
    fs.writeFileSync(bad, JSON.stringify(results({ 'm01-a': 0, 'm02-b': 0, 'a01-c': 1 })));
    fs.writeFileSync(base, JSON.stringify(baseline));
    const run = (file) => spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'plugin-eval-gate.js'), '--results', file, '--baseline', base], { encoding: 'utf8' });
    assert.equal(run(good).status, 0);
    assert.equal(run(bad).status, 1);
    assert.equal(run(path.join(dir, 'missing.json')).status, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the shipped baseline is well formed and matches the shipped results', () => {
  const root = path.join(__dirname, '..', 'evals', 'plugin');
  const shippedBaseline = JSON.parse(fs.readFileSync(path.join(root, 'baseline.json'), 'utf8'));
  const shippedResults = JSON.parse(fs.readFileSync(path.join(root, 'results.json'), 'utf8'));
  assert.equal(typeof shippedBaseline.withScore, 'number');
  assert.equal(evaluateGate(shippedResults, shippedBaseline).ok, true);
});
