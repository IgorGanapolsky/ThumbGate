'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { runAll } = require('./scenarios/run');

const report = runAll();

for (const r of report.results.filter((x) => !x.gap)) {
  test(`scenario ${r.id}: prevented with the gate on, happens with it off`, () => {
    assert.equal(r.on.prevented, true, `gate ON should prevent it: ${r.on.evidence}`);
    assert.equal(r.offResult.prevented, false, `gate OFF should let it happen: ${r.offResult.evidence}`);
  });
}

test('known gaps are replayed and reported, never counted as passing', () => {
  const gaps = report.results.filter((x) => x.gap);
  assert.ok(gaps.length >= 1, 'at least one documented gap');
  for (const g of gaps) {
    assert.notEqual(g.on.prevented, null, `${g.id} must run with the gate on: ${g.on.evidence}`);
    assert.notEqual(g.offResult.prevented, null, `${g.id} must run with the gate off: ${g.offResult.evidence}`);
  }
});

test('classes that cannot be reproduced locally are named with a reason, not faked', () => {
  assert.ok(report.notReproduced.length >= 1);
  for (const n of report.notReproduced) {
    assert.ok(n.id && n.class && n.reason.length > 40, `${n.id} needs a real reason`);
    assert.ok(!report.results.some((r) => r.id === n.id), `${n.id} must not also appear as a result`);
  }
});

test('npm run scenarios exits 0 when every reproduced scenario holds', () => {
  const run = spawnSync(process.execPath, [path.join(__dirname, 'scenarios', 'run.js'), '--json'], {
    encoding: 'utf8',
    timeout: 120000,
  });
  assert.equal(run.status, 0, run.stderr);
  const parsed = JSON.parse(run.stdout.slice(run.stdout.indexOf('{')));
  assert.equal(parsed.ok, true);
});
