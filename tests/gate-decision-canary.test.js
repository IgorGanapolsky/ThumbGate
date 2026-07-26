'use strict';

// The canary's whole job is catching the failure mode that has no error: a gate that stops
// firing. These tests drive diffDecisions() directly so they assert the detection logic
// rather than the filesystem.

const test = require('node:test');
const assert = require('node:assert');

const { diffDecisions, MIN_TRAFFIC } = require('../scripts/gate-decision-canary.js');

function baselineOf(byGate, totalBlocked, totalWarned = 0) {
  return { recordedAtMs: 0, totalBlocked, totalWarned, byGate };
}

test('a gate that goes silent is reported as a possible bypass', () => {
  const baseline = baselineOf({ 'git-reset-hard': { blocked: 100, warned: 0 } }, 100);
  const current = { blocked: 100, warned: 500, byGate: { 'git-reset-hard': { blocked: 100, warned: 0 } } };

  const result = diffDecisions(baseline, current);
  assert.equal(result.evaluated, true);
  const silent = result.findings.filter((f) => f.kind === 'silent');
  assert.equal(silent.length, 1);
  assert.equal(silent[0].gate, 'git-reset-hard');
});

test('a gate still firing proportionally is not reported', () => {
  const baseline = baselineOf({ 'git-reset-hard': { blocked: 100, warned: 0 } }, 100);
  const current = { blocked: 150, warned: 400, byGate: { 'git-reset-hard': { blocked: 150, warned: 0 } } };

  const result = diffDecisions(baseline, current);
  assert.deepEqual(result.findings.filter((f) => f.kind === 'silent'), []);
});

test('a low-volume gate going quiet is treated as noise, not signal', () => {
  // Below MIN_BASELINE_BLOCKS: absence here means nothing.
  const baseline = baselineOf({ 'rare-gate': { blocked: 3, warned: 0 } }, 3);
  const current = { blocked: 3, warned: 500, byGate: { 'rare-gate': { blocked: 3, warned: 0 } } };

  const result = diffDecisions(baseline, current);
  assert.deepEqual(result.findings, []);
});

test('a gate taking a much larger share of blocks is reported as a spike', () => {
  const baseline = baselineOf({
    'noisy-gate': { blocked: 10, warned: 0 },
    'other-gate': { blocked: 90, warned: 0 },
  }, 100);
  // noisy-gate goes from 10% of blocks to ~99%.
  const current = {
    blocked: 300,
    warned: 0,
    byGate: {
      'noisy-gate': { blocked: 208, warned: 0 },
      'other-gate': { blocked: 92, warned: 0 },
    },
  };

  const result = diffDecisions(baseline, current);
  const spikes = result.findings.filter((f) => f.kind === 'spike');
  assert.equal(spikes.length, 1);
  assert.equal(spikes[0].gate, 'noisy-gate');
});

test('a gate that vanishes from the config entirely is reported', () => {
  const baseline = baselineOf({ 'removed-gate': { blocked: 80, warned: 0 } }, 80);
  const current = { blocked: 80, warned: 500, byGate: {} };

  const result = diffDecisions(baseline, current);
  assert.ok(result.findings.some((f) => f.kind === 'disappeared' && f.gate === 'removed-gate'));
});

test('no verdict is issued below the traffic floor', () => {
  const baseline = baselineOf({ 'git-reset-hard': { blocked: 100, warned: 0 } }, 100);
  const current = { blocked: 100, warned: 1, byGate: { 'git-reset-hard': { blocked: 100, warned: 0 } } };

  const result = diffDecisions(baseline, current);
  assert.equal(result.evaluated, false, 'must not cry drift on a handful of events');
  assert.deepEqual(result.findings, []);
  assert.ok(result.traffic < MIN_TRAFFIC);
});

test('the real 2026-07-26 shape is caught: all four catastrophic gates go silent', () => {
  // What a shipped bypass actually looked like: the gates were configured, the system kept
  // running, and enforcement simply stopped. No error was raised anywhere.
  const gates = ['git-reset-hard', 'git-clean-force', 'force-push', 'rm-rf-home-or-root'];
  const byGate = Object.fromEntries(gates.map((g) => [g, { blocked: 50, warned: 0 }]));
  const baseline = baselineOf(byGate, 200);
  const current = { blocked: 200, warned: 900, byGate };

  const result = diffDecisions(baseline, current);
  const silent = result.findings.filter((f) => f.kind === 'silent').map((f) => f.gate).sort();
  assert.deepEqual(silent, gates.slice().sort(), 'every silenced gate must be named');
});

// ---------------------------------------------------------------------------
// CLI surface, driven as a child process so the env-derived paths are exercised
// exactly as an operator would hit them.
// ---------------------------------------------------------------------------

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'gate-decision-canary.js');

function runCanary(args, env) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function canaryEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-canary-cli-'));
  return {
    dir,
    env: {
      THUMBGATE_STATS_PATH: path.join(dir, 'gate-stats.json'),
      THUMBGATE_CANARY_BASELINE: path.join(dir, 'baseline.json'),
    },
  };
}

test('CLI exits 2 when there are no stats to read', () => {
  const { env } = canaryEnv();
  const result = runCanary(['--snapshot'], env);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /no stats/);
});

test('CLI exits 2 when checking without a baseline', () => {
  const { dir, env } = canaryEnv();
  fs.writeFileSync(env.THUMBGATE_STATS_PATH, JSON.stringify({ blocked: 1, warned: 1, byGate: {} }));
  assert.ok(fs.existsSync(dir));
  const result = runCanary(['--check'], env);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /no baseline/);
});

test('CLI snapshot then check reports no drift when enforcement holds', () => {
  const { env } = canaryEnv();
  const byGate = { 'git-reset-hard': { blocked: 100, warned: 0 } };
  fs.writeFileSync(env.THUMBGATE_STATS_PATH, JSON.stringify({ blocked: 100, warned: 0, byGate }));

  const snap = runCanary(['--snapshot'], env);
  assert.equal(snap.status, 0);
  assert.match(snap.stdout, /Baseline recorded/);

  // Enforcement keeps pace with traffic.
  fs.writeFileSync(env.THUMBGATE_STATS_PATH, JSON.stringify({
    blocked: 200, warned: 100, byGate: { 'git-reset-hard': { blocked: 200, warned: 0 } },
  }));
  const check = runCanary(['--check'], env);
  assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.match(check.stdout, /No enforcement drift/);
});

test('CLI exits 1 and names the gate when enforcement goes silent', () => {
  const { env } = canaryEnv();
  const byGate = { 'git-reset-hard': { blocked: 100, warned: 0 } };
  fs.writeFileSync(env.THUMBGATE_STATS_PATH, JSON.stringify({ blocked: 100, warned: 0, byGate }));
  runCanary(['--snapshot'], env);

  // Traffic continues, blocking stops — the shipped-bypass shape.
  fs.writeFileSync(env.THUMBGATE_STATS_PATH, JSON.stringify({ blocked: 100, warned: 900, byGate }));
  const check = runCanary(['--check'], env);
  assert.equal(check.status, 1);
  assert.match(check.stdout, /ENFORCEMENT DRIFT/);
  assert.match(check.stdout, /SILENT \(possible bypass\)/);
  assert.match(check.stdout, /git-reset-hard/);
});

test('CLI --json emits machine-readable findings', () => {
  const { env } = canaryEnv();
  const byGate = { 'git-clean-force': { blocked: 60, warned: 0 } };
  fs.writeFileSync(env.THUMBGATE_STATS_PATH, JSON.stringify({ blocked: 60, warned: 0, byGate }));
  runCanary(['--snapshot'], env);
  fs.writeFileSync(env.THUMBGATE_STATS_PATH, JSON.stringify({ blocked: 60, warned: 600, byGate }));

  const check = runCanary(['--check', '--json'], env);
  assert.equal(check.status, 1);
  const parsed = JSON.parse(check.stdout);
  assert.equal(parsed.evaluated, true);
  assert.ok(parsed.findings.some((f) => f.kind === 'silent' && f.gate === 'git-clean-force'));
});

test('CLI prints usage and exits 0 with no arguments', () => {
  const { env } = canaryEnv();
  const result = runCanary([], env);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
});

test('CLI stays quiet below the traffic floor', () => {
  const { env } = canaryEnv();
  const byGate = { 'git-reset-hard': { blocked: 100, warned: 0 } };
  fs.writeFileSync(env.THUMBGATE_STATS_PATH, JSON.stringify({ blocked: 100, warned: 0, byGate }));
  runCanary(['--snapshot'], env);
  fs.writeFileSync(env.THUMBGATE_STATS_PATH, JSON.stringify({ blocked: 100, warned: 5, byGate }));

  const check = runCanary(['--check'], env);
  assert.equal(check.status, 0);
  assert.match(check.stdout, /Not enough traffic/);
});
