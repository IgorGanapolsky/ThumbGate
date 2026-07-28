'use strict';

// Regression benchmark mined from REAL production gate decisions
// (scripts/mine-eval-set.js -> evals/gate-decisions.golden.jsonl).
//
// The eval-engineering argument this follows: production traces, not invented examples, are
// the source of good evals — recurring real failures become measurable cases. Before this,
// `evals/` did not exist, so enforcement quality was not comparable between runs and a
// behaviour change could only be noticed by someone remembering what used to happen.
//
// It asserts DRIFT (verdict changed vs a recorded baseline), not correctness-vs-production —
// see the long comment above the drift test for why production verdicts cannot serve as
// expectations here.

const test = require('node:test');
const { before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const gatesEngine = require('../scripts/gates-engine.js');
const { evaluateGatesAsync } = gatesEngine;

const GOLDEN = path.join(__dirname, '..', 'evals', 'gate-decisions.golden.jsonl');

function loadCases() {
  if (!fs.existsSync(GOLDEN)) return [];
  return fs.readFileSync(GOLDEN, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

const ORIGINAL_PATHS = {
  STATE_PATH: gatesEngine.STATE_PATH,
  STATS_PATH: gatesEngine.STATS_PATH,
  CONSTRAINTS_PATH: gatesEngine.CONSTRAINTS_PATH,
  SESSION_ACTIONS_PATH: gatesEngine.SESSION_ACTIONS_PATH,
  GOVERNANCE_STATE_PATH: gatesEngine.GOVERNANCE_STATE_PATH,
};

let repo;
let sandbox;

before(() => {
  // Isolated state. Several gates are stateful (push-without-thread-check is satisfied by
  // prior activity; workflow-sentinel accumulates risk), so replaying 60 cases against one
  // shared state directory measures the session rather than the engine. That exact mistake
  // produced 8 phantom findings against a healthy build earlier.
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-golden-state-'));
  gatesEngine.STATE_PATH = path.join(sandbox, 'gate-state.json');
  gatesEngine.STATS_PATH = path.join(sandbox, 'gate-stats.json');
  gatesEngine.CONSTRAINTS_PATH = path.join(sandbox, 'session-constraints.json');
  gatesEngine.SESSION_ACTIONS_PATH = path.join(sandbox, 'session-actions.json');
  gatesEngine.GOVERNANCE_STATE_PATH = path.join(sandbox, 'governance-state.json');

  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-golden-repo-'));
  const git = (args) => execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
  git(['init']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(repo, 'seed.txt'), 'seed\n');
  git(['add', 'seed.txt']);
  git(['commit', '-m', 'init']);
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'app.js'), 'code\n');
});

after(() => {
  Object.assign(gatesEngine, ORIGINAL_PATHS);
  fs.rmSync(sandbox, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
});

test('the mined benchmark exists and is not vacuous', () => {
  const cases = loadCases();
  assert.ok(fs.existsSync(GOLDEN), `missing benchmark at ${GOLDEN} — run: npm run eval:mine`);
  assert.ok(cases.length >= 20, `benchmark has only ${cases.length} cases; expected >= 20`);
  // Every case must be replayable. Mining the wrong log once produced entries with empty
  // commands, which pass trivially and look like coverage.
  const unreplayable = cases.filter((c) => !c.command);
  assert.deepEqual(unreplayable, [], 'benchmark contains cases with no command to replay');
  // And it must span more than one gate, or it is measuring one code path.
  const gates = new Set(cases.map((c) => c.expect?.gateId));
  assert.ok(gates.size >= 5, `benchmark covers only ${gates.size} gate(s); expected >= 5`);
});

test('the benchmark carries no home paths or credentials', () => {
  const raw = fs.existsSync(GOLDEN) ? fs.readFileSync(GOLDEN, 'utf8') : '';
  // Mined from a real machine, so redaction is a correctness property, not hygiene.
  assert.doesNotMatch(raw, /\/Users\/(?!redacted)[A-Za-z0-9._]+/, 'unredacted /Users/ path');
  assert.doesNotMatch(raw, /-Users-(?!redacted)[A-Za-z0-9._]+/, 'unredacted dash-encoded home path');
  assert.doesNotMatch(raw, /\b(gh[pousr]_|sk-|npm_)[A-Za-z0-9]{8,}/, 'possible credential');
});

// WHY THIS ASSERTS DRIFT, NOT CORRECTNESS-VS-PRODUCTION.
//
// The first version asserted "production denied it, so the engine must still deny it" and
// immediately reported 14 regressions that were not regressions. Almost every gate in this
// trace window is STATE-conditional: pr-thread-resolution needs a prior commit in the
// session, memory-high-risk needs the learned corpus, self-protect-kill needs a running
// process, local-only-* needs governance config. A fresh sandbox cannot reproduce any of
// that, and the trace does not record the state that produced the verdict — so production's
// verdict is simply not a valid expectation for an isolated replay.
//
// What IS valid, and is what went undetected for months: whether the engine's verdict for a
// real production command CHANGES. The baseline is captured from the current engine
// (npm run eval:baseline) and this test fails when a command's verdict moves. That catches a
// gate silently going quiet, which is the signature of every bypass found in this codebase.
const BASELINE = path.join(__dirname, '..', 'evals', 'gate-decisions.baseline.json');

test('no enforcement drift on real production commands', async () => {
  const cases = loadCases();
  if (!fs.existsSync(BASELINE)) {
    assert.fail(`missing baseline at ${BASELINE} — run: npm run eval:baseline`);
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  assert.ok(Object.keys(baseline.verdicts || {}).length >= 20,
    'baseline is too small to be meaningful');

  const drift = [];
  let compared = 0;
  for (const testCase of cases) {
    const key = `${testCase.toolName}|${testCase.command}`;
    const expected = baseline.verdicts[key];
    if (expected === undefined) continue;   // new case, not yet baselined
    compared += 1;
    const verdict = await evaluateGatesAsync(testCase.toolName, {
      command: testCase.command,
      cwd: repo,
    });
    const actual = verdict ? verdict.decision : 'none';
    if (actual !== expected) {
      drift.push(`${JSON.stringify(testCase.command.slice(0, 60))}: ${expected} -> ${actual}`);
    }
  }

  // Vacuity guard: a drift check that compared nothing is not a passing check.
  assert.ok(compared >= 20, `only ${compared} case(s) compared against baseline`);
  assert.deepEqual(drift, [],
    `enforcement changed for real production commands:\n  ${drift.join('\n  ')}\n`
    + 'If intended, re-run: npm run eval:baseline');
});
