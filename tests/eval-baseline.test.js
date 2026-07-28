'use strict';

// Tests for the baseline recorder behind the enforcement-drift check.
//
// This script defines what "no drift" means: it records the current engine's verdict for every
// mined production command, and tests/gate-golden-set.test.js later fails when a verdict moves.
// If it silently records nothing, or records a verdict for the wrong command, the drift test
// keeps passing while enforcement changes underneath it — the exact failure mode this whole
// benchmark exists to catch.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function withFixture(cases) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-baseline-test-'));
  const golden = path.join(dir, 'golden.jsonl');
  const out = path.join(dir, 'baseline.json');
  fs.writeFileSync(golden, cases.map((entry) => JSON.stringify(entry)).join('\n') + (cases.length ? '\n' : ''));
  return { dir, golden, out };
}

/**
 * The module reads its paths at load time, so each case needs a fresh require with the env set.
 * Deleting the cache entry is what makes the override actually take effect.
 */
function loadWith(golden, out) {
  const modulePath = require.resolve('../scripts/eval-baseline.js');
  delete require.cache[modulePath];
  const previous = {
    golden: process.env.THUMBGATE_EVAL_GOLDEN,
    baseline: process.env.THUMBGATE_EVAL_BASELINE,
  };
  process.env.THUMBGATE_EVAL_GOLDEN = golden;
  process.env.THUMBGATE_EVAL_BASELINE = out;
  const loaded = require(modulePath);
  return {
    module: loaded,
    restore() {
      if (previous.golden === undefined) delete process.env.THUMBGATE_EVAL_GOLDEN;
      else process.env.THUMBGATE_EVAL_GOLDEN = previous.golden;
      if (previous.baseline === undefined) delete process.env.THUMBGATE_EVAL_BASELINE;
      else process.env.THUMBGATE_EVAL_BASELINE = previous.baseline;
      delete require.cache[modulePath];
    },
  };
}

test('exits non-zero and writes nothing when the golden set is missing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-baseline-test-'));
  const golden = path.join(dir, 'absent.jsonl');
  const out = path.join(dir, 'baseline.json');
  const { module: baseline, restore } = loadWith(golden, out);

  const code = await baseline.main();
  assert.strictEqual(code, 2, 'a missing golden set must be an error, not an empty success');
  assert.strictEqual(fs.existsSync(out), false, 'no baseline should be written without a corpus');

  restore();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('records a verdict for every case and reports a decision histogram', async () => {
  const { dir, golden, out } = withFixture([
    { toolName: 'Bash', command: 'sudo rm -rf /', expect: { gateId: 'x', decision: 'deny' } },
    { toolName: 'Bash', command: 'npm test', expect: { gateId: 'y', decision: 'none' } },
    { toolName: 'Bash', command: 'git status', expect: { gateId: 'z', decision: 'none' } },
  ]);
  const { module: baseline, restore } = loadWith(golden, out);

  const code = await baseline.main();
  assert.strictEqual(code, 0);
  assert.ok(fs.existsSync(out), 'baseline file was not written');

  const recorded = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.strictEqual(recorded.cases, 3, 'every case must be baselined');
  assert.strictEqual(Object.keys(recorded.verdicts).length, 3);

  // Keys must be toolName|command so the drift test can look a case up by what it replays.
  assert.ok(Object.hasOwn(recorded.verdicts, 'Bash|npm test'),
    `verdict keys are not toolName|command: ${Object.keys(recorded.verdicts).join(', ')}`);

  // The histogram must account for every case, or a silently-dropped case looks like coverage.
  const histogramTotal = Object.values(recorded.counts).reduce((sum, value) => sum + value, 0);
  assert.strictEqual(histogramTotal, recorded.cases, 'counts do not sum to the number of cases');

  restore();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a catastrophic command baselines as denied, not as an absent verdict', async () => {
  // If this ever records `none`, the drift benchmark would happily enshrine a dead gate as the
  // expected behaviour. That is the specific way a benchmark becomes worse than no benchmark.
  const { dir, golden, out } = withFixture([
    { toolName: 'Bash', command: 'sudo rm -rf /', expect: { gateId: 'x', decision: 'deny' } },
  ]);
  const { module: baseline, restore } = loadWith(golden, out);

  await baseline.main();
  const recorded = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.strictEqual(recorded.verdicts['Bash|sudo rm -rf /'], 'deny',
    'the engine no longer denies `sudo rm -rf /` — enforcement, not the benchmark, is broken');

  restore();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('corrupt lines in the golden set do not abort the run', async () => {
  const { dir, golden, out } = withFixture([
    { toolName: 'Bash', command: 'npm test', expect: { gateId: 'y', decision: 'none' } },
  ]);
  fs.appendFileSync(golden, '{ not json at all\n');
  const { module: baseline, restore } = loadWith(golden, out);

  const code = await baseline.main();
  assert.strictEqual(code, 0, 'one unparseable line should not lose the rest of the corpus');
  const recorded = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.strictEqual(recorded.cases, 1);

  restore();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the run leaves no sandbox or scratch repo behind', async () => {
  const before = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('tg-baseline-')).length;
  const { dir, golden, out } = withFixture([
    { toolName: 'Bash', command: 'git status', expect: { gateId: 'z', decision: 'none' } },
  ]);
  const { module: baseline, restore } = loadWith(golden, out);

  await baseline.main();

  const after = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('tg-baseline-')).length;
  // `withFixture` adds one directory (tg-baseline-test-); the script's own sandbox and repo
  // must both be cleaned up, so the count should not grow beyond that.
  assert.ok(after <= before + 1, `run leaked ${after - before - 1} temp director(ies)`);

  restore();
  fs.rmSync(dir, { recursive: true, force: true });
});
