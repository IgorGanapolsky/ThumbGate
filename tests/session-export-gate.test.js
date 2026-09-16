'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  detectCloneAttempt,
  runSeededStripTest,
  evaluateExport,
  buildSessionExportGateReport,
  SEED_SECRET,
} = require('../scripts/session-export-gate');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'session-export-gate.js');
const CLI = path.resolve(__dirname, '..', 'bin', 'cli.js');

test('seeded strip removes the planted live-shaped secret', () => {
  const seed = runSeededStripTest();
  assert.equal(seed.ok, true, seed.strippedSample);
  assert.equal(seed.leaked, false);
  assert.equal(seed.strippedSample.includes(SEED_SECRET), false);
});

test('operator lane is always deny', () => {
  const report = evaluateExport({
    lane: 'operator',
    optIn: true,
    irreversibleAck: true,
    text: 'hello',
  });
  assert.equal(report.allowed, false);
  assert.ok(report.findings.some((f) => f.id === 'operator_lane_deny'));
});

test('research without per-session opt-in is deny', () => {
  const report = evaluateExport({ lane: 'research', text: 'hello' });
  assert.equal(report.allowed, false);
  assert.ok(report.findings.some((f) => f.id === 'missing_opt_in'));
});

test('research opt-in without irreversible ack is deny', () => {
  const report = evaluateExport({
    lane: 'research',
    optIn: true,
    text: 'hello',
  });
  assert.ok(report.findings.some((f) => f.id === 'missing_irreversible_ack'));
});

test('research opt-in + irreversible + local dest applies strip and writes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-forge-'));
  const dest = path.join(dir, 'out.txt');
  const log = path.join(dir, 'export.jsonl');
  const report = buildSessionExportGateReport({
    lane: 'research',
    optIn: true,
    irreversibleAck: true,
    text: `hello api_key=${SEED_SECRET}`,
    dest,
    log,
    apply: true,
  });
  assert.equal(report.allowed, true, JSON.stringify(report.findings));
  assert.equal(report.ok, true);
  assert.equal(report.applied.written, true);
  const body = fs.readFileSync(dest, 'utf8');
  assert.equal(body.includes(SEED_SECRET), false);
  assert.match(fs.readFileSync(log, 'utf8'), /irreversible/);
});

test('remote dest and Arcee clone attempts fail closed', () => {
  const remote = evaluateExport({
    lane: 'research',
    optIn: true,
    irreversibleAck: true,
    dest: 'https://arcee.ai/v1/ingest',
    text: 'hello',
  });
  assert.ok(remote.findings.some((f) => f.id === 'remote_dest_refused'));
  const hits = detectCloneAttempt('clone Bolt Forge and send traces to Arcee');
  assert.ok(hits.length >= 1);
  const clone = evaluateExport({ 'clone-bolt-forge': true, argv: ['--clone-bolt-forge'] });
  assert.ok(clone.findings.some((f) => f.id === 'bolt_forge_clone_refused'));
});

test('already-exported log cannot be unexported by dropping opt-in', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-forge-log-'));
  const log = path.join(dir, 'export.jsonl');
  fs.writeFileSync(log, `${JSON.stringify({ dest: 'old.txt', irreversible: true })}\n`);
  const report = evaluateExport({
    lane: 'research',
    optIn: false,
    log,
  });
  assert.equal(report.alreadyExported, true);
  assert.equal(report.irreversible, true);
  assert.equal(report.allowed, false);
});

test('script CLI operator default exits 1', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.name, 'thumbgate-session-export-gate');
  assert.equal(payload.ok, false);
});

test('thumbgate CLI session-export-gate is wired', () => {
  const result = spawnSync(process.execPath, [
    CLI, 'session-export-gate', '--json', '--lane=research', '--opt-in-export', '--i-understand-irreversible', '--text=hi',
  ], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.lane, 'research');
});

test('docs refuse Bolt Forge clone and 50x claims', () => {
  const doc = fs.readFileSync(
    path.join(__dirname, '..', 'docs', 'agents', 'session-export-gate.md'),
    'utf8'
  );
  assert.match(doc, /not affiliated|do not clone/i);
  assert.match(doc, /50/i);
});
