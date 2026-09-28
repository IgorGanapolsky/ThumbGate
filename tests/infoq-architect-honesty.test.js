'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  buildInfoqArchitectHonestyReport,
  timeInQueue,
} = require('../scripts/infoq-architect-honesty');

const NOW = Date.parse('2026-09-28T21:00:00.000Z');

test('map-only is ready and does not claim vendor speed numbers', () => {
  const report = buildInfoqArchitectHonestyReport({ mapOnly: true });
  assert.equal(report.ok, true);
  assert.equal(report.status, 'ready');
  const blob = JSON.stringify(report.map);
  assert.equal(blob.includes('20%'), false);
  assert.equal(blob.includes('gigabit'), false);
  assert.equal(report.refuses.includes('Second workflow engine'), true);
});

test('registration, Vortex, Temporal, and a borrowed percent are refusals', () => {
  const cases = [
    ['register for the InfoQ certification', 'InfoQ certification registration'],
    ['npm install vortex', 'Vortex install'],
    ['adopt Temporal as the workflow orchestrator', 'Second workflow engine'],
    ['our productivity boost is twenty percent', 'Unmeasured vendor number'],
  ];
  for (const [claim, message] of cases) {
    const report = buildInfoqArchitectHonestyReport({ claim });
    assert.equal(report.status, 'fail', claim);
    assert.equal(report.findings.some((item) => item.message === message), true, claim);
  }
});

test('a new host language fails and javascript is allowed', () => {
  const denied = buildInfoqArchitectHonestyReport({ claim: 'Host: kotlin', host: 'kotlin' });
  assert.equal(denied.status, 'fail');
  assert.equal(denied.findings[0].gateId, 'typed-host');
  const allowed = buildInfoqArchitectHonestyReport({ claim: 'Host: javascript' });
  assert.equal(allowed.status, 'ready');
});

test('a done claim names an existing file and a provenance id', () => {
  const missing = buildInfoqArchitectHonestyReport({ claim: 'shipped the doctor' });
  assert.equal(missing.status, 'fail');
  assert.equal(missing.findings[0].gateId, 'code-as-truth');

  const report = buildInfoqArchitectHonestyReport({
    cwd: path.resolve(__dirname, '..'),
    claim: [
      'shipped the lease check',
      'Code as truth: scripts/session-lease.js',
      'Provenance: session-lease',
    ].join('\n'),
  });
  assert.equal(report.status, 'ready');
});

test('time-in-queue uses the oldest stamp and ignores depth', () => {
  const queue = timeInQueue([
    { id: 'young', enqueuedAt: '2026-09-28T20:59:00.000Z' },
    { id: 'old', enqueuedAt: '2026-09-28T18:00:00.000Z' },
    { id: 'blank', enqueuedAt: '' },
  ], NOW);
  assert.equal(queue.count, 3);
  assert.equal(queue.oldest.id, 'old');
  assert.equal(queue.oldest.ageMs, 3 * 60 * 60 * 1000);
  assert.deepEqual(queue.missingTimestamps, ['blank']);

  const deepButFresh = buildInfoqArchitectHonestyReport({
    now: '2026-09-28T21:00:00.000Z',
    maxAgeMs: 60 * 60 * 1000,
    queueJson: JSON.stringify(Array.from({ length: 40 }, (_, index) => ({
      id: `item-${index}`,
      enqueuedAt: '2026-09-28T20:50:00.000Z',
    }))),
  });
  assert.equal(deepButFresh.status, 'ready');
  assert.equal(deepButFresh.queue.count, 40);

  const stale = buildInfoqArchitectHonestyReport({
    now: '2026-09-28T21:00:00.000Z',
    maxAgeMs: 60 * 60 * 1000,
    queueJson: JSON.stringify([{ id: 'stuck', enqueuedAt: '2026-09-28T18:00:00.000Z' }]),
  });
  assert.equal(stale.status, 'fail');
  assert.equal(stale.findings[0].gateId, 'time-in-queue');
});

test('a lease file without claimedAt is review, not an invented age', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infoq-lease-'));
  const lease = path.join(dir, 'lease.json');
  fs.writeFileSync(lease, JSON.stringify({ agent: 'grok' }));
  const report = buildInfoqArchitectHonestyReport({ lease, now: NOW });
  assert.equal(report.status, 'review');
  assert.equal(report.queue.oldest, null);
  assert.equal(report.queue.timedCount, 0);
});
