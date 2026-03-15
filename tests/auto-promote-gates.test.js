// tests/auto-promote-gates.test.js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  promote,
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
  AUTO_GATES_PATH,
} = require('../scripts/auto-promote-gates');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-gate-test-'));
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

// -- promote: threshold triggers warn gate --

test('promote: 3 occurrences triggers warn gate', (t) => {
  const tmpDir = makeTmpDir();
  const logPath = path.join(tmpDir, 'feedback-log.jsonl');
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.RLHF_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  for (let i = 0; i < 3; i++) {
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

// -- promote: 5 occurrences upgrades to block --

test('promote: 5 occurrences upgrades gate from warn to block', (t) => {
  const tmpDir = makeTmpDir();
  const logPath = path.join(tmpDir, 'feedback-log.jsonl');
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.RLHF_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  // First create 3 entries -> warn gate
  for (let i = 0; i < 3; i++) {
    appendJSONL(logPath, makeNegativeEntry(['execution-gap'], 'did not push', i));
  }
  promote(logPath);

  // Add 2 more -> 5 total -> should upgrade to block
  for (let i = 0; i < 2; i++) {
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
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.RLHF_FEEDBACK_DIR;
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
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.RLHF_FEEDBACK_DIR;
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

// -- promote: below threshold does not create gate --

test('promote: fewer than 3 occurrences does not create a gate', (t) => {
  const tmpDir = makeTmpDir();
  const logPath = path.join(tmpDir, 'feedback-log.jsonl');
  process.env.RLHF_FEEDBACK_DIR = tmpDir;

  // Save and clear auto-promoted.json to isolate this test
  const savedData = fs.existsSync(AUTO_GATES_PATH) ? fs.readFileSync(AUTO_GATES_PATH, 'utf-8') : null;
  saveAutoGates({ version: 1, gates: [], promotionLog: [] });

  t.after(() => {
    delete process.env.RLHF_FEEDBACK_DIR;
    // Restore original auto-promoted.json
    if (savedData !== null) {
      fs.writeFileSync(AUTO_GATES_PATH, savedData);
    } else if (fs.existsSync(AUTO_GATES_PATH)) {
      fs.unlinkSync(AUTO_GATES_PATH);
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  appendJSONL(logPath, makeNegativeEntry(['rare-error'], 'happened once', 1));
  appendJSONL(logPath, makeNegativeEntry(['rare-error'], 'happened twice', 2));

  const result = promote(logPath);
  assert.strictEqual(result.promotions.length, 0);
  assert.strictEqual(result.totalGates, 0);
});

// -- promote: integration with feedback capture pipeline --

test('promote: called from feedback-loop on negative capture', (t) => {
  const tmpDir = makeTmpDir();
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  t.after(() => {
    delete process.env.RLHF_FEEDBACK_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  const { captureFeedback } = require('../scripts/feedback-loop');

  // Capture 3 negative feedbacks with the same tag
  for (let i = 0; i < 3; i++) {
    captureFeedback({
      signal: 'down',
      context: `Pipeline integration test failure ${i}`,
      whatWentWrong: 'Integration broke',
      tags: ['pipeline-integration-test'],
    });
  }

  // The auto-promote should have been triggered by the 3rd capture
  const data = loadAutoGates();
  const gate = data.gates.find((g) => g.pattern === 'pipeline-integration-test');
  assert.ok(gate, 'auto-promoted gate should exist after 3 negative captures');
  assert.strictEqual(gate.action, 'warn');
});

// -- buildGateRule --

test('buildGateRule: returns gate object with correct fields', () => {
  const group = {
    key: 'testing',
    count: 4,
    entries: [],
    latestContext: 'Test failure context',
    latestTimestamp: new Date().toISOString(),
  };
  const gate = buildGateRule(group);
  assert.ok(gate.id.startsWith('auto-'));
  assert.strictEqual(gate.action, 'warn');
  assert.strictEqual(gate.severity, 'medium');
  assert.ok(gate.message.includes('4 occurrences'));
  assert.strictEqual(gate.source, 'auto-promote');
});

test('buildGateRule: count >= 5 produces block action', () => {
  const group = {
    key: 'critical-error',
    count: 5,
    entries: [],
    latestContext: 'Critical failure',
    latestTimestamp: new Date().toISOString(),
  };
  const gate = buildGateRule(group);
  assert.strictEqual(gate.action, 'block');
  assert.strictEqual(gate.severity, 'critical');
});
