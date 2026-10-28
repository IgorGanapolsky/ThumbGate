'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildBroadcastSwarmSowReport } = require('../scripts/broadcast-swarm-sow');

const PROMPT = 'New SOWs for the swarm';

function expectedHash(prompt) {
  const normalized = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

function expectedId(kind, hash) {
  return `SOW-${crypto.createHash('sha256').update(`${kind}:${hash}`).digest('hex').slice(0, 8).toUpperCase()}`;
}

function seats(extra) {
  return [
    { id: 'p', role: 'fast_proposer', harness: 'herdr' },
    { id: 'a', role: 'deep_architect', harness: 'gemini' },
    { id: 'v', role: 'adversarial_verifier', harness: 'antigravity' },
    { id: 'j', role: 'llm_judge', harness: 'herdr' },
    ...(extra || []),
  ];
}

function policy(overrides = {}) {
  return { prompt: PROMPT, seats: seats(), ...overrides };
}

function row(seat, correctness, tokenEfficiency, speed, minimalism) {
  return { seat, correctness, tokenEfficiency, speed, minimalism };
}

function efficientBoard() {
  return [
    row('p', 100, 0, 0, 0),
    row('a', 70, 100, 100, 100),
    row('v', 0, 0, 0, 0),
  ];
}

function report(action, overrides) {
  return buildBroadcastSwarmSowReport({
    policy: policy({ candidates: efficientBoard(), ...overrides }),
    action,
  });
}

test('map-only is ready and the report has no network address', () => {
  const result = buildBroadcastSwarmSowReport({ mapOnly: true });
  assert.equal(result.status, 'ready');
  assert.equal(result.evaluation, null);
  assert.equal(result.doctor, 'broadcast-swarm-sow');
  assert.equal(/https?:/.test(JSON.stringify(result)), false);
});

test('the module does not open a network or carry a vendor host', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'broadcast-swarm-sow.js'), 'utf8');
  assert.equal(/https?:\/\//.test(src), false);
  assert.equal(/\bfetch\s*\(/.test(src), false);
  assert.equal(/require\(['"](?:node:)?(?:https?|net|dns)['"]\)/.test(src), false);
  const vendorHost = 'herdr.' + 'dev';
  assert.equal(src.split(vendorHost).length, 1);
});

test('sow.open with four seats returns three ids for one prompt hash', () => {
  const result = buildBroadcastSwarmSowReport({
    policy: policy(),
    action: { point: 'sow.open' },
  });
  assert.equal(result.status, 'ready');
  const hash = expectedHash(PROMPT);
  assert.equal(result.sow.promptHash, hash);
  assert.equal(result.sow.broadcast, expectedId('broadcast', hash));
  assert.equal(result.sow.experts, expectedId('experts', hash));
  assert.equal(result.sow.judge, expectedId('judge', hash));
  assert.equal(new Set([result.sow.broadcast, result.sow.experts, result.sow.judge]).size, 3);
  const spaced = buildBroadcastSwarmSowReport({
    policy: { prompt: '  NEW   sows\nfor the swarm  ', seats: [] },
    action: { point: 'sow.open' },
  });
  assert.equal(spaced.sow.promptHash, hash);
});

test('an empty seat list can open, and a duplicate role or unknown harness denies', () => {
  const opened = buildBroadcastSwarmSowReport({
    policy: { prompt: PROMPT, seats: [] },
    action: { point: 'sow.open' },
  });
  assert.equal(opened.status, 'ready');

  const duplicated = buildBroadcastSwarmSowReport({
    policy: {
      prompt: PROMPT,
      seats: [
        { id: 'p', role: 'fast_proposer', harness: 'herdr' },
        { id: 'p2', role: 'fast_proposer', harness: 'gemini' },
      ],
    },
    action: { point: 'sow.open' },
  });
  assert.equal(duplicated.evaluation.reason, 'duplicate-role');

  const unknown = buildBroadcastSwarmSowReport({
    policy: {
      prompt: PROMPT,
      seats: [{ id: 'p', role: 'fast_proposer', harness: 'omp' }],
    },
    action: { point: 'sow.open' },
  });
  assert.equal(unknown.evaluation.reason, 'unknown-harness');
});

test('the fast proposer scouts once, then every later full read denies', () => {
  const scout = buildBroadcastSwarmSowReport({
    policy: policy({ capsule: false }),
    action: { point: 'context.read', seat: 'p', readScope: 'scout' },
  });
  assert.equal(scout.status, 'ready');

  const full = buildBroadcastSwarmSowReport({
    policy: policy({ capsule: false }),
    action: { point: 'context.read', seat: 'p', readScope: 'full' },
  });
  assert.equal(full.status, 'ready');

  const waiting = buildBroadcastSwarmSowReport({
    policy: policy({ capsule: false }),
    action: { point: 'context.read', seat: 'a', readScope: 'scout' },
  });
  assert.equal(waiting.evaluation.reason, 'wait-for-capsule');

  const second = report({ point: 'context.read', seat: 'p', readScope: 'full' }, { capsule: true });
  assert.equal(second.evaluation.reason, 'duplicate-read');

  const capsule = report({ point: 'context.read', seat: 'a', readScope: 'capsule' }, { capsule: true });
  assert.equal(capsule.status, 'ready');
});

test('a high-correctness wasteful patch loses to the efficient patch', () => {
  const judged = report({ point: 'judge.score', seat: 'j' });
  assert.equal(judged.status, 'ready');
  assert.equal(judged.evaluation.winner, 'a');
  assert.equal(judged.evaluation.weighted.p, 4000);
  assert.equal(judged.evaluation.weighted.a, 8800);

  const winner = report({ point: 'write.lease', seat: 'a' });
  assert.equal(winner.status, 'ready');
  assert.equal(winner.evaluation.winner, 'a');

  const loser = report({ point: 'write.lease', seat: 'p' });
  assert.equal(loser.evaluation.reason, 'not-the-winner');
});

test('a perfect score beats a near-perfect score, and equal totals tie', () => {
  const perfect = report({ point: 'judge.score', seat: 'j' }, {
    candidates: [
      row('p', 100, 100, 100, 100),
      row('a', 99, 100, 100, 100),
      row('v', 0, 0, 0, 0),
    ],
  });
  assert.equal(perfect.evaluation.winner, 'p');
  assert.equal(perfect.evaluation.weighted.p, 10000);
  assert.equal(perfect.evaluation.weighted.a, 9960);

  const tied = report({ point: 'write.lease', seat: 'p' }, {
    candidates: [
      row('p', 100, 0, 0, 0),
      row('a', 100, 0, 0, 0),
      row('v', 0, 0, 0, 0),
    ],
  });
  assert.equal(tied.evaluation.reason, 'tie');
  assert.equal(tied.evaluation.winner, '');
});

test('write.lease without scores, from the judge, or with the wrong winner denies', () => {
  const unscored = buildBroadcastSwarmSowReport({
    policy: policy(),
    action: { point: 'write.lease', seat: 'p' },
  });
  assert.equal(unscored.evaluation.reason, 'unscored');

  const judge = report({ point: 'write.lease', seat: 'j' });
  assert.equal(judge.evaluation.reason, 'judge-writes');

  const mismatch = report({ point: 'write.lease', seat: 'a', winner: 'p' });
  assert.equal(mismatch.evaluation.reason, 'winner-mismatch');
});

test('fixed weights, an unknown candidate, and a proposer-only capsule are enforced', () => {
  const shifted = report({ point: 'judge.score', seat: 'j' }, {
    weights: { correctness: 70, tokenEfficiency: 10, speed: 10, minimalism: 10 },
  });
  assert.equal(shifted.evaluation.reason, 'weights-are-fixed');

  const unknown = report({ point: 'judge.score', seat: 'j' }, {
    candidates: [...efficientBoard(), row('outsider', 1, 1, 1, 1)],
  });
  assert.equal(unknown.evaluation.reason, 'unknown-candidate');

  const published = buildBroadcastSwarmSowReport({
    policy: policy({ capsule: false }),
    action: { point: 'capsule.publish', seat: 'p' },
  });
  assert.equal(published.status, 'ready');

  const again = buildBroadcastSwarmSowReport({
    policy: policy({ capsule: true }),
    action: { point: 'capsule.publish', seat: 'p' },
  });
  assert.equal(again.evaluation.reason, 'capsule-exists');

  const other = buildBroadcastSwarmSowReport({
    policy: policy({ capsule: false }),
    action: { point: 'capsule.publish', seat: 'a' },
  });
  assert.equal(other.evaluation.reason, 'not-the-proposer');
});

test('install, fetch, spend, and all-write deny before the point', () => {
  const cases = [
    [{ install: true }, 'no-install'],
    [{ fetch: true }, 'no-fetch'],
    [{ spend: true }, 'no-spend'],
    [{ allWrite: true }, 'one-writer'],
  ];
  for (const [extra, reason] of cases) {
    const result = buildBroadcastSwarmSowReport({
      policy: policy(),
      action: { point: 'sow.open', ...extra },
    });
    assert.equal(result.evaluation.reason, reason);
  }
});

test('supplied null, false, or zero JSON fails closed', () => {
  const absent = buildBroadcastSwarmSowReport({ claim: 'four seats share one prompt' });
  assert.equal(absent.status, 'ready');
  assert.equal(absent.evaluation, null);

  const nulled = buildBroadcastSwarmSowReport({ policyJson: 'null', actionJson: 'null' });
  assert.equal(nulled.status, 'fail');
  assert.equal(nulled.evaluation.reason, 'missing-policy');

  const zeroed = buildBroadcastSwarmSowReport({ policyJson: 'false', actionJson: '0' });
  assert.equal(zeroed.evaluation.reason, 'missing-policy');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'broadcast-swarm-null-'));
  const policyPath = path.join(dir, 'policy.json');
  const actionPath = path.join(dir, 'action.json');
  fs.writeFileSync(policyPath, 'null');
  fs.writeFileSync(actionPath, 'null');
  const filed = buildBroadcastSwarmSowReport({ policyPath, actionPath });
  assert.equal(filed.evaluation.reason, 'missing-policy');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('installing Herdr or calling a judge API is a refusal, and a negation is not', () => {
  const cases = [
    ['install herdr', 'Install Herdr from this doctor'],
    ['curl the installer', 'Curl an installer'],
    ['call the judge api', 'Call an external judge API'],
    ['every seat writes the same files', 'Let every seat write'],
    ['spend on a second model', 'Spend on a second model'],
  ];
  for (const [claim, message] of cases) {
    const result = buildBroadcastSwarmSowReport({ claim });
    assert.equal(result.status, 'fail', claim);
    assert.equal(result.findings.some((item) => item.message === message), true, claim);
  }
  const benign = buildBroadcastSwarmSowReport({
    claim: "do not install herdr, do not call the judge api, and do not spend on a second model",
  });
  assert.equal(benign.status, 'ready');
  assert.equal(benign.evaluation, null);
});

test('the command map-only path exits ready', () => {
  const root = path.join(__dirname, '..');
  const run = spawnSync(process.execPath, ['scripts/broadcast-swarm-sow.js', '--json', '--map-only'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0);
  const body = JSON.parse(run.stdout);
  assert.equal(body.status, 'ready');
  assert.equal(/https?:/.test(run.stdout), false);

  const cli = spawnSync(process.execPath, ['bin/cli.js', 'broadcast-swarm-sow', '--json', '--map-only'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).doctor, 'broadcast-swarm-sow');
});
