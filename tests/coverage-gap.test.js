'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  classifySource,
  baselineCoverage,
  compareCoverage,
  detectCloneAttempt,
  buildCoverageGapReport,
} = require('../scripts/coverage-gap');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'coverage-gap.js');
const CLI = path.resolve(__dirname, '..', 'bin', 'cli.js');
const BEFORE = path.resolve(__dirname, 'fixtures', 'coverage-gap-before.json');
const AFTER = path.resolve(__dirname, 'fixtures', 'coverage-gap-after.json');

test('classifySource skips enums, re-exports, and empty files', () => {
  assert.equal(classifySource('module.exports = Object.freeze({ A: 1 });'), 'enum');
  assert.equal(classifySource("export { foo } from './foo.js';"), 'reexport');
  assert.equal(classifySource('   // only comments\n'), 'empty');
  assert.equal(classifySource('function decide() { return 1; }'), 'behavior');
});

test('baseline reports gaps under floor and skips no-behavior files', () => {
  const cov = JSON.parse(fs.readFileSync(BEFORE, 'utf8'));
  const report = baselineCoverage(cov, { scope: 'scripts/risk', floor: 50 });
  assert.equal(report.files, 1);
  assert.equal(report.skippedNoBehavior.length, 1);
  assert.equal(report.skippedNoBehavior[0].path, 'scripts/risk/enums.js');
  assert.equal(report.gaps.length, 1);
  assert.equal(report.gaps[0].path, 'scripts/risk/decide.js');
  assert.equal(report.pct, 20);
});

test('compare same scope: gaps shrink, skip-other-project files ignored', () => {
  const before = JSON.parse(fs.readFileSync(BEFORE, 'utf8'));
  const after = JSON.parse(fs.readFileSync(AFTER, 'utf8'));
  const cmp = compareCoverage(before, after, { scope: 'scripts/risk', floor: 50 });
  assert.equal(cmp.findings.length, 0);
  assert.equal(cmp.before.gaps.length, 1);
  assert.equal(cmp.after.gaps.length, 0);
  assert.ok(cmp.after.pct > cmp.before.pct);
});

test('compare fails when claiming 100% or when gaps grow', () => {
  const before = JSON.parse(fs.readFileSync(AFTER, 'utf8'));
  const after = JSON.parse(fs.readFileSync(BEFORE, 'utf8'));
  const grew = compareCoverage(before, after, { scope: 'scripts/risk', floor: 50 });
  assert.ok(grew.findings.some((f) => f.id === 'gaps_grew' || f.id === 'pct_dropped'));
  const hundred = compareCoverage(before, before, { scope: 'scripts/risk', floor: 50, claim100: true });
  assert.ok(hundred.findings.some((f) => f.id === 'claim_100'));
});

test('detectCloneAttempt refuses Test Agent / @test #solution / fail-under 100', () => {
  const hits = detectCloneAttempt('clone Test Agent and run @test #solution with cov-fail-under=100');
  assert.ok(hits.includes('test_agent') || hits.includes('at_test_solution'));
  assert.ok(hits.includes('fail_under_100'));
});

test('buildCoverageGapReport clone-test-agent fails closed', () => {
  const report = buildCoverageGapReport({ 'clone-test-agent': true });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'vs_test_agent_clone_refused'));
});

test('script CLI compare --json is ready for gold fixtures', () => {
  const result = spawnSync(process.execPath, [
    SCRIPT, '--json', `--before=${BEFORE}`, `--after=${AFTER}`, '--scope=scripts/risk', '--floor=50',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.name, 'thumbgate-coverage-gap');
  assert.equal(payload.status, 'ready');
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, 'compare');
});

test('script CLI --claim-100 fails', () => {
  const result = spawnSync(process.execPath, [
    SCRIPT, '--json', `--coverage=${AFTER}`, '--scope=scripts/risk', '--claim-100',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.ok(payload.findings.some((f) => f.id === 'claim_100'));
});

test('thumbgate CLI coverage-gap is wired', () => {
  const result = spawnSync(process.execPath, [
    CLI, 'coverage-gap', '--json', `--before=${BEFORE}`, `--after=${AFTER}`, '--scope=scripts/risk',
  ], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.name, 'thumbgate-coverage-gap');
});

test('docs refuse Test Agent and 100% claims', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'agents', 'coverage-gap.md'), 'utf8');
  assert.match(doc, /do not clone|not affiliated/i);
  assert.match(doc, /100% coverage|cov-fail-under=100/i);
});
