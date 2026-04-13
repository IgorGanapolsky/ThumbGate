// tests/auto-promote-gates.test.js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  promote,
  runCli,
  loadAutoGates,
  saveAutoGates,
  groupNegativeFeedback,
  patternToGateId,
  buildGateRule,
  extractPatternKey,
  isNegative,
  MAX_AUTO_GATES,
  WARN_THRESHOLD,
  BLOCK_THRESHOLD,
  WINDOW_DAYS,
  getAutoGatesPath,
} = require('../scripts/auto-promote-gates');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-gate-test-'));
}

function appendJSONL(filePath, record) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
}

function recentTimestamp(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

function makeNegativeEntry(tags, context, daysAgo = 0) {
  return {
    signal: 'negative',
    tags,
    context: context || `Error context for ${tags.join(',')}`,
    whatWentWrong: 'Something broke',
    timestamp: recentTimestamp(daysAgo),
  };
}

// -- isNegative --

test('isNegative: returns true for negative signals', () => {
  assert.ok(isNegative({ signal: 'negative' }));
  assert.ok(isNegative({ signal: 'down' }));
  assert.ok(isNegative({ signal: 'thumbs_down' }));
});

test('isNegative: returns false for positive/unknown signals', () => {
  assert.ok(!isNegative({ signal: 'positive' }));
  assert.ok(!isNegative({ signal: 'up' }));
  assert.ok(!isNegative({}));
});

// -- extractPatternKey --

test('extractPatternKey: uses sorted tags as key', () => {
  const key = extractPatternKey({ tags: ['git-workflow', 'push'], signal: 'negative' });
  assert.strictEqual(key, 'git-workflow+push');
});

test('extractPatternKey: falls back to normalized context', () => {
  const key = extractPatternKey({ tags: [], context: 'this is a long enough context string for grouping', signal: 'negative' });
  assert.ok(key);
  assert.ok(!key.includes('/Users/'));
});

test('extractPatternKey: returns null for short context and no tags', () => {
  const key = extractPatternKey({ tags: [], context: 'short', signal: 'negative' });
  assert.strictEqual(key, null);
});

test('getAutoGatesPath: resolves inside the active feedback directory', () => {
  const tmpDir = makeTmpDir();
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  try {
    assert.strictEqual(getAutoGatesPath(), path.join(tmpDir, 'auto-promoted-gates.json'));
  } finally {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('threshold constants preserve the 2 warn / 3 block contract', () => {
  assert.strictEqual(WARN_THRESHOLD, 2);
  assert.strictEqual(BLOCK_THRESHOLD, 3);
});

// -- patternToGateId --

test('patternToGateId: converts pattern to kebab-case id', () => {
  const id = patternToGateId('git-workflow+push');
  assert.ok(id.startsWith('auto-'));
  assert.ok(!id.includes('+'));
});

// -- groupNegativeFeedback --

test('groupNegativeFeedback: groups by tags within window', () => {
  const entries = [
    makeNegativeEntry(['testing'], 'test failure 1', 1),
    makeNegativeEntry(['testing'], 'test failure 2', 2),
    makeNegativeEntry(['testing'], 'test failure 3', 3),
    makeNegativeEntry(['security'], 'sec issue', 1),
  ];
  const groups = groupNegativeFeedback(entries, WINDOW_DAYS);
  assert.strictEqual(groups['testing'].count, 3);
  assert.strictEqual(groups['security'].count, 1);
});

test('groupNegativeFeedback: excludes entries outside window', () => {
  const entries = [
    makeNegativeEntry(['testing'], 'old failure', 35), // outside 30-day window
    makeNegativeEntry(['testing'], 'recent failure', 1),
  ];
  const groups = groupNegativeFeedback(entries, WINDOW_DAYS);
  assert.strictEqual(groups['testing'].count, 1);
});

test('groupNegativeFeedback: ignores positive signals', () => {
  const entries = [
    { signal: 'positive', tags: ['testing'], context: 'good job', timestamp: recentTimestamp(1) },
    makeNegativeEntry(['testing'], 'failure', 1),
  ];
  const groups = groupNegativeFeedback(entries, WINDOW_DAYS);
  assert.strictEqual(groups['testing'].count, 1);
});

test('groupNegativeFeedback: also groups repeated diagnostic categories', () => {
  const entries = [
    {
      ...makeNegativeEntry(['testing'], 'failure 1', 1),
      diagnosis: {
        rootCauseCategory: 'guardrail_triggered',
        violations: [{ constraintId: 'rubric:verification_evidence' }],
      },
    },
    {
      ...makeNegativeEntry(['testing'], 'failure 2', 2),
      diagnosis: {
        rootCauseCategory: 'guardrail_triggered',
        violations: [{ constraintId: 'rubric:verification_evidence' }],
      },
    },
  ];
  const groups = groupNegativeFeedback(entries, WINDOW_DAYS);
  assert.strictEqual(groups['diagnosis:guardrail_triggered'].count, 2);
  assert.strictEqual(groups['constraint:rubric:verification_evidence'].count, 2);
});

// -- promote: repeated failures below block threshold trigger warn gate --

test('promote: repeated failures below block threshold trigger warn gate', (t) => {
  const tmpDir = makeTmpDir();
  const logPath = path.join(tmpDir, 'feedback-log.jsonl');
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  const warnCount = BLOCK_THRESHOLD - 1;
  for (let i = 0; i < warnCount; i++) {
    appendJSONL(logPath, makeNegativeEntry(['pr-review'], 'forgot thread check', i));
  }

  const result = promote(logPath);
  assert.ok(result.promotions.length > 0, 'should have promotions');
  const newPromo = result.promotions.find((p) => p.type === 'new');
  assert.ok(newPromo, 'should have a new promotion');
  assert.strictEqual(newPromo.action, 'warn');

  // Verify file was written
  const data = loadAutoGates();
  const gate = data.gates.find((g) => g.id === newPromo.gateId);
  assert.ok(gate, 'gate should exist in auto-promoted.json');
  assert.strictEqual(gate.action, 'warn');
});

// -- promote: block threshold upgrades an existing warn gate --

test('promote: block threshold upgrades gate from warn to block', (t) => {
  const tmpDir = makeTmpDir();
  const logPath = path.join(tmpDir, 'feedback-log.jsonl');
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  const warnCount = BLOCK_THRESHOLD - 1;
  // First create a warn gate below the block threshold.
  for (let i = 0; i < warnCount; i++) {
    appendJSONL(logPath, makeNegativeEntry(['execution-gap'], 'did not push', i));
  }
  promote(logPath);

  // Add enough additional failures to reach the block threshold.
  for (let i = warnCount; i < BLOCK_THRESHOLD; i++) {
    appendJSONL(logPath, makeNegativeEntry(['execution-gap'], 'did not push again', i));
  }
  const result = promote(logPath);
  const upgrade = result.promotions.find((p) => p.type === 'upgrade');
  assert.ok(upgrade, 'should have an upgrade promotion');
  assert.strictEqual(upgrade.to, 'block');

  const data = loadAutoGates();
  const gate = data.gates.find((g) => g.pattern === 'execution-gap');
  assert.strictEqual(gate.action, 'block');
});

// -- promote: deduplication --

test('promote: does not create duplicate gates', (t) => {
  const tmpDir = makeTmpDir();
  const logPath = path.join(tmpDir, 'feedback-log.jsonl');
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  for (let i = 0; i < 4; i++) {
    appendJSONL(logPath, makeNegativeEntry(['dedup-test'], 'same error', i));
  }

  promote(logPath);
  const first = loadAutoGates();
  const countBefore = first.gates.filter((g) => g.pattern === 'dedup-test').length;

  // Run again — should not create duplicate
  promote(logPath);
  const second = loadAutoGates();
  const countAfter = second.gates.filter((g) => g.pattern === 'dedup-test').length;

  assert.strictEqual(countBefore, 1);
  assert.strictEqual(countAfter, 1);
});

// -- promote: max gate limit and rotation --

test('promote: rotates oldest when exceeding MAX_AUTO_GATES', (t) => {
  const tmpDir = makeTmpDir();
  const logPath = path.join(tmpDir, 'feedback-log.jsonl');
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  // Create MAX_AUTO_GATES + 1 distinct patterns, each with 3 occurrences
  for (let p = 0; p <= MAX_AUTO_GATES; p++) {
    for (let i = 0; i < 3; i++) {
      appendJSONL(logPath, makeNegativeEntry([`pattern-${p}`], `error ${p}`, i));
    }
  }

  const result = promote(logPath);
  const data = loadAutoGates();
  assert.ok(data.gates.length <= MAX_AUTO_GATES, `should not exceed ${MAX_AUTO_GATES} gates, got ${data.gates.length}`);

  // Should have at least one rotation event
  const rotated = result.promotions.filter((p) => p.type === 'rotated');
  assert.ok(rotated.length > 0, 'should have rotated at least one gate');
});

// -- promote: below warn threshold does not create gate --

test('promote: fewer than WARN_THRESHOLD occurrences does not create a gate', (t) => {
  const tmpDir = makeTmpDir();
  const logPath = path.join(tmpDir, 'feedback-log.jsonl');
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  const autoGatesPath = getAutoGatesPath();

  // Save and clear auto-promoted.json to isolate this test
  const savedData = fs.existsSync(autoGatesPath) ? fs.readFileSync(autoGatesPath, 'utf-8') : null;
  saveAutoGates({ version: 1, gates: [], promotionLog: [] });

  t.after(() => {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    // Restore original auto-promoted.json
    if (savedData !== null) {
      fs.writeFileSync(autoGatesPath, savedData);
    } else if (fs.existsSync(autoGatesPath)) {
      fs.unlinkSync(autoGatesPath);
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  for (let i = 0; i < WARN_THRESHOLD - 1; i++) {
    appendJSONL(logPath, makeNegativeEntry(['rare-error'], `happened ${i + 1} times`, i + 1));
  }

  const result = promote(logPath);
  assert.strictEqual(result.promotions.length, 0);
  assert.strictEqual(result.totalGates, 0);
});

// -- promote: integration with feedback capture pipeline --

test('promote: called from feedback-loop on negative capture', (t) => {
  const tmpDir = makeTmpDir();
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  const { captureFeedback } = require('../scripts/feedback-loop');

  const warnCount = BLOCK_THRESHOLD - 1;
  // Capture repeated negative feedback without crossing the block threshold.
  for (let i = 0; i < warnCount; i++) {
    captureFeedback({
      signal: 'down',
      context: `Pipeline integration test failure ${i}`,
      whatWentWrong: 'Integration broke',
      tags: ['pipeline-integration-test'],
    });
  }

  // The auto-promote should create a warn gate before the hard block threshold.
  const data = loadAutoGates();
  const gate = data.gates.find((g) => g.pattern === 'pipeline-integration-test');
  assert.ok(gate, 'auto-promoted gate should exist before the block threshold is reached');
  assert.strictEqual(gate.action, 'warn');
});

// -- buildGateRule --

test('buildGateRule: returns gate object with correct fields', () => {
  const group = {
    key: 'testing',
    count: BLOCK_THRESHOLD - 1,
    entries: [],
    latestContext: 'Test failure context',
    latestTimestamp: new Date().toISOString(),
  };
  const gate = buildGateRule(group);
  assert.ok(gate.id.startsWith('auto-'));
  assert.strictEqual(gate.action, 'warn');
  assert.strictEqual(gate.severity, 'medium');
  assert.ok(gate.message.includes(`${BLOCK_THRESHOLD - 1} occurrences`));
  assert.strictEqual(gate.source, 'auto-promote');
});

test('buildGateRule: count at block threshold produces block action', () => {
  const group = {
    key: 'critical-error',
    count: BLOCK_THRESHOLD,
    entries: [],
    latestContext: 'Critical failure',
    latestTimestamp: new Date().toISOString(),
  };
  const gate = buildGateRule(group);
  assert.strictEqual(gate.action, 'block');
  assert.strictEqual(gate.severity, 'critical');
});

test('runCli: supports force-block without falling through to a second entrypoint', (t) => {
  const tmpDir = makeTmpDir();
  const lines = [];
  const originalLog = console.log;
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  console.log = (line) => lines.push(line);
  t.after(() => {
    console.log = originalLog;
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  const exitCode = runCli(['--force-block=pipeline-regression']);
  assert.strictEqual(exitCode, 0);
  assert.ok(lines.some((line) => line.includes('Forced block gate created')));

  const data = loadAutoGates();
  const gate = data.gates.find((entry) => entry.pattern === 'pipeline-regression');
  assert.ok(gate);
  assert.strictEqual(gate.action, 'block');
});
