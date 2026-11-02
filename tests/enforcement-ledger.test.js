'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { describeEnforcementLedger } = require('../scripts/enforcement-ledger');

test('describeEnforcementLedger subtracts repeats and does not treat zero passes as measured', () => {
  const ledger = describeEnforcementLedger({
    blocked: 15,
    recurringBlocks: 13,
    passed: 0,
    dailyBlocks: { '2026-10-02': 2 },
  });
  assert.equal(ledger.distinctBlocks, 2);
  assert.equal(ledger.repeatBlocks, 13);
  assert.equal(ledger.eventBlocks, 15);
  assert.equal(ledger.passesMeasured, false);
  assert.equal(ledger.dailyBlocksNewest, '2026-10-02');
});

test('describeEnforcementLedger clamps a repeat count above the event count', () => {
  const ledger = describeEnforcementLedger({ blocked: 1, recurringBlocks: 5, passed: 2 });
  assert.equal(ledger.distinctBlocks, 0);
  assert.equal(ledger.passesMeasured, true);
  assert.equal(ledger.passesRecorded, 2);
});

test('recordStat writes today on a block once and leaves a warn off the daily ledger', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-ledger-'));
  const statsPath = path.join(tmpDir, 'gate-stats.json');
  const ge = require('../scripts/gates-engine');
  const previous = ge.STATS_PATH;
  ge.STATS_PATH = statsPath;
  try {
    fs.writeFileSync(statsPath, JSON.stringify({ blocked: 0, warned: 0, passed: 0, byGate: {}, dailyBlocks: {} }));
    ge.recordStat('secret-exfiltration', 'block', null, { toolName: 'Bash', toolInput: { command: 'echo secret' } });
    ge.recordStat('secret-exfiltration', 'warn', null, { toolName: 'Bash', toolInput: { command: 'echo other' } });
    ge.recordStat('all', 'pass');
    const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
    const today = new Date().toISOString().slice(0, 10);
    assert.equal(stats.blocked, 1);
    assert.equal(stats.warned, 1);
    assert.equal(stats.passed, 1);
    assert.equal(stats.dailyBlocks[today], 1);
  } finally {
    ge.STATS_PATH = previous;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
