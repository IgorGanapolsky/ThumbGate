'use strict';

// AGENT-3667 item P: the table of which gate is enforced on which host is generated from real hook runs. This test
// fails the build when a cell says "enforced" without a recorded denial, when a host with no run says anything but
// "untested", or when the committed page, JSON or README block differ from a fresh run.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const matrix = require('../scripts/host-gate-matrix');

const committed = JSON.parse(fs.readFileSync(matrix.RESULTS_PATH, 'utf8'));
const clone = () => JSON.parse(JSON.stringify(committed));

test('the committed results have no cell that says "enforced" without a recorded denial', () => {
  assert.deepEqual(matrix.validateResults(committed), []);
});

test('a cell that says "enforced" with no recorded denial fails validation', () => {
  const bad = clone();
  bad.rows[0].cells['claude-code'] = { status: 'enforced', check: 'git push --force origin main -> exit 0, permissionDecision allow' };
  const errors = matrix.validateResults(bad);
  assert.ok(errors.some((e) => /force-push \/ claude-code: "enforced" without a recorded denial/.test(e)), errors.join('\n'));
});

test('a denial by a different gate does not count for this gate', () => {
  const bad = clone();
  bad.rows[0].cells.cursor = { status: 'enforced', check: 'git push --force origin main -> exit 2, permission deny by gate protected-branch-push' };
  assert.ok(matrix.validateResults(bad).length > 0);
});

test('a host with no run cannot be marked "enforced", and chat text can never be', () => {
  const bad = clone();
  bad.rows[0].cells.codex = { status: 'enforced', check: 'x -> permissionDecision deny by gate force-push' };
  const chat = bad.rows.find((r) => r.kind === 'chat');
  chat.cells['claude-code'] = { status: 'enforced', check: 'typed text' };
  const errors = matrix.validateResults(bad);
  assert.ok(errors.some((e) => /codex: "enforced" for a host with no runnable hook path/.test(e)), errors.join('\n'));
  assert.ok(errors.some((e) => /chat text can never be "enforced"/.test(e)), errors.join('\n'));
});

test('Codex and Gemini CLI are "untested" for every gate and chat text is "out of scope" on every host', () => {
  for (const row of committed.rows) {
    for (const host of committed.hosts) {
      const status = row.cells[host.id].status;
      if (row.kind === 'chat') assert.equal(status, 'out of scope', `${row.id} / ${host.id}`);
      else if (host.id === 'codex' || host.id === 'gemini-cli') assert.equal(status, 'untested', `${row.id} / ${host.id}`);
      else assert.ok(['enforced', 'not enforced'].includes(status), `${row.id} / ${host.id}: ${status}`);
    }
  }
});

test('a fresh run of every probe equals the committed JSON, docs page and README block', () => {
  const fresh = matrix.runProbes();
  assert.deepEqual(matrix.validateResults(fresh), []);
  const readme = fs.readFileSync(matrix.README_PATH, 'utf8');
  const next = matrix.render(fresh, readme);
  assert.equal(fs.readFileSync(matrix.RESULTS_PATH, 'utf8'), next.json, 'docs/compat/host-gate-results.json is stale: run npm run compat:matrix');
  assert.equal(fs.readFileSync(matrix.DOC_PATH, 'utf8'), next.doc, 'docs/host-compatibility.md is stale: run npm run compat:matrix');
  assert.equal(readme, next.readme, 'the README gate-coverage block is stale: run npm run compat:matrix');
});
