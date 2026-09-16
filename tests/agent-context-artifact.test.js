'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  REQUIRED_FIELDS,
  REQUIRED_WRONG_FIT,
  lintPack,
  detectCloneAttempt,
  buildAgentContextArtifactReport,
} = require('../scripts/agent-context-artifact');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'agent-context-artifact.js');
const CLI = path.resolve(__dirname, '..', 'bin', 'cli.js');
const GOLD = path.resolve(__dirname, 'fixtures', 'agent-context-artifact-gold.json');
const HUMAN = path.resolve(__dirname, 'fixtures', 'agent-context-artifact-human.json');
const GOLD_NOW = '2026-09-16T13:00:00Z';
const GOLD_CLOCK = { now: GOLD_NOW };

test('required fields and wrong-fit are the Wisdom artifact contract', () => {
  assert.deepEqual([...REQUIRED_FIELDS], ['goal', 'constraints', 'sources', 'freshness', 'verifier']);
  assert.equal(REQUIRED_WRONG_FIT, 'wisdom_ai');
});

test('lintPack accepts the gold agent pack', () => {
  const pack = JSON.parse(fs.readFileSync(GOLD, 'utf8'));
  assert.deepEqual(lintPack(pack, GOLD_CLOCK).filter((f) => f.severity === 'fail'), []);
});

test('lintPack fails human-consumer packs missing fields and wisdom_ai wrong-fit', () => {
  const pack = JSON.parse(fs.readFileSync(HUMAN, 'utf8'));
  const ids = lintPack(pack).map((f) => f.id);
  assert.ok(ids.includes('consumer_not_agent'));
  assert.ok(ids.includes('missing_goal'));
  assert.ok(ids.includes('missing_wrong_fit_wisdom_ai'));
});

test('lintPack fails stale freshness', () => {
  const pack = JSON.parse(fs.readFileSync(GOLD, 'utf8'));
  pack.freshness = { maxAgeHours: 1, asOf: '2026-09-01T00:00:00Z' };
  assert.ok(lintPack(pack, { now: '2026-09-16T00:00:00Z' }).some((f) => f.id === 'stale_context'));
});

test('pack freshness.now cannot bypass the staleness gate', () => {
  const pack = JSON.parse(fs.readFileSync(GOLD, 'utf8'));
  pack.freshness = {
    maxAgeHours: 1,
    asOf: '2026-09-01T00:00:00Z',
    now: '2026-09-01T00:00:00Z',
  };
  const findings = lintPack(pack, { now: '2026-09-16T00:00:00Z' });
  assert.ok(findings.some((f) => f.id === 'stale_context'));
  const spoofed = buildAgentContextArtifactReport({
    pack,
    now: '2026-09-16T00:00:00Z',
  });
  assert.equal(spoofed.ok, false);
  assert.ok(spoofed.findings.some((f) => f.id === 'stale_context'));
});

test('detectCloneAttempt refuses ACE / Foundry / OSI', () => {
  const hits = detectCloneAttempt('clone Adaptive Context Engine and vendor Palantir Foundry');
  assert.ok(hits.includes('ace_sku') || hits.includes('foundry_sku'));
  assert.ok(detectCloneAttempt('clone ACE').includes('ace_sku'));
});

test('buildAgentContextArtifactReport clone-ace fails closed', () => {
  const report = buildAgentContextArtifactReport({ 'clone-ace': true });
  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((f) => f.id === 'wisdom_clone_refused'));
});

test('script CLI --pack gold exits 0', () => {
  const result = spawnSync(process.execPath, [
    SCRIPT, '--json', `--pack=${GOLD}`, `--now=${GOLD_NOW}`,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.name, 'thumbgate-agent-context-artifact');
  assert.equal(payload.ok, true);
});

test('script CLI fails human fixture', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--json', `--pack=${HUMAN}`], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
});

test('thumbgate CLI agent-context-artifact is wired', () => {
  const result = spawnSync(process.execPath, [
    CLI, 'agent-context-artifact', '--json', `--pack=${GOLD}`, `--now=${GOLD_NOW}`,
  ], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
});

test('docs refuse ACE / Foundry / OSI clones', () => {
  const doc = fs.readFileSync(
    path.join(__dirname, '..', 'docs', 'agents', 'agent-context-artifact.md'),
    'utf8'
  );
  assert.match(doc, /not affiliated|do not clone/i);
  assert.match(doc, /wisdom_ai/);
});

test('lintPack fails empty pack and unidentified sources', () => {
  assert.ok(lintPack(null).some((f) => f.id === 'empty_pack'));
  const pack = JSON.parse(fs.readFileSync(GOLD, 'utf8'));
  pack.sources = [{ note: 'tribal knowledge' }];
  assert.ok(lintPack(pack, GOLD_CLOCK).some((f) => f.id === 'source_unidentified'));
});

test('lintPack fails unrunnable verifier and unmeasurable freshness', () => {
  const pack = JSON.parse(fs.readFileSync(GOLD, 'utf8'));
  pack.verifier = { note: 'looks good' };
  assert.ok(lintPack(pack, GOLD_CLOCK).some((f) => f.id === 'verifier_unrunnable'));
  pack.verifier = { command: 'npm run test:agent-context-artifact' };
  pack.freshness = { note: 'recent' };
  assert.ok(lintPack(pack, GOLD_CLOCK).some((f) => f.id === 'freshness_unmeasurable'));
  pack.freshness = { maxAgeHours: 24 };
  assert.ok(lintPack(pack, GOLD_CLOCK).some((f) => f.id === 'freshness_unmeasurable'));
});

test('no --pack warns instead of inventing a catalog', () => {
  const report = buildAgentContextArtifactReport({});
  assert.equal(report.status, 'ready_with_warnings');
  assert.ok(report.findings.some((f) => f.id === 'no_pack'));
});

test('missing pack file is pack_load_failed not a thrown CLI crash', () => {
  const report = buildAgentContextArtifactReport({
    pack: path.join(__dirname, 'fixtures', 'does-not-exist.json'),
    json: true,
  });
  assert.equal(report.ok, false);
  assert.ok(report.findings.some((f) => f.id === 'pack_load_failed'));
  assert.ok(!report.findings.some((f) => f.id === 'no_pack'));
});

test('thumbgate CLI --map=false still lints the gold pack', () => {
  const result = spawnSync(process.execPath, [
    CLI, 'agent-context-artifact', '--json', `--pack=${GOLD}`, `--now=${GOLD_NOW}`, '--map=false',
  ], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.ok(payload.pack);
});

test('script CLI --clone-ace exits 1', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--json', '--clone-ace'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.ok(payload.findings.some((f) => f.id === 'wisdom_clone_refused'));
});

test('skill is a six-block compare-not-clone pack', () => {
  const skill = fs.readFileSync(
    path.join(__dirname, '..', '.agents', 'skills', 'wisdom-context-artifact-not-clone', 'SKILL.md'),
    'utf8'
  );
  for (const heading of ['## Goal', '## Constraints', '## Reference', '## Examples', '## Procedures', '## Rubric']) {
    assert.ok(skill.includes(heading), `missing ${heading}`);
  }
  assert.match(skill, /Weak:/);
  assert.match(skill, /Gold:/);
  assert.match(skill, /wisdom_ai/);
  assert.match(skill, /Do NOT clone ACE/i);
});
