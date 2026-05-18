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
  normalizeCommandSignature,
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

test('threshold constants: 1 warn (first-capture activation) / 3 block (escalation)', () => {
  // WARN_THRESHOLD was 2; lowered to 1 so cold buyers see a working gate after their
  // first 👎 (activation-loop fix). Hard block still requires 3 captures to avoid noise.
  assert.strictEqual(WARN_THRESHOLD, 1);
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

// ============================================================
// Rule TTL / expiry (Reddit reviewer @MomSausageandPeppers, 2026-05-13)
// ============================================================

const {
  expireGates,
  recordGateFire,
  getRuleTtlDays,
  getRuleTtlMs,
  DEFAULT_RULE_TTL_DAYS,
} = require('../scripts/auto-promote-gates');

test('buildGateRule sets expiresAt for auto-promoted gates (default 90 day TTL)', () => {
  const group = {
    key: 'destructive',
    latestContext: 'rm -rf production',
    count: 2,
    source: 'auto-promote',
  };
  const gate = buildGateRule(group);
  assert.ok(gate.expiresAt, 'auto-promoted gates must have expiresAt set');
  const expiresMs = Date.parse(gate.expiresAt);
  const promotedMs = Date.parse(gate.promotedAt);
  const deltaDays = (expiresMs - promotedMs) / (24 * 60 * 60 * 1000);
  assert.ok(deltaDays > 89 && deltaDays < 91, `default TTL should be ~90 days, got ${deltaDays}`);
  assert.equal(gate.lastFiredAt, null);
});

test('buildGateRule sets expiresAt=null for MANUAL force-promoted gates', () => {
  const group = {
    key: 'manual-override',
    latestContext: 'manual-override',
    count: 'MANUAL',
    manualAction: 'block',
    source: 'force-promote',
  };
  const gate = buildGateRule(group);
  assert.equal(gate.expiresAt, null, 'force-promoted gates are permanent (expiresAt=null)');
});

test('expireGates drops gates whose expiresAt is past and lastFiredAt is also stale', () => {
  const longAgo = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(); // 200d ago
  const data = {
    version: 1,
    gates: [
      { id: 'stale', expiresAt: longAgo, lastFiredAt: null, pattern: 'stale-rule' },
      { id: 'fresh', expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), pattern: 'fresh-rule' },
      { id: 'permanent', expiresAt: null, pattern: 'permanent-rule' },
    ],
    promotionLog: [],
  };
  const { data: result, expired } = expireGates(data);
  const keptIds = result.gates.map((g) => g.id);
  assert.ok(!keptIds.includes('stale'), 'stale gate should be expired');
  assert.ok(keptIds.includes('fresh'), 'fresh gate should be kept');
  assert.ok(keptIds.includes('permanent'), 'permanent (null expiresAt) gate should be kept');
  assert.equal(expired.length, 1);
  assert.equal(expired[0].id, 'stale');
  assert.ok(result.promotionLog.some((p) => p.type === 'expired' && p.gateId === 'stale'));
});

test('expireGates keeps gates that fired recently even if original expiresAt is past', () => {
  const longAgoExpiry = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30d past
  const recentFire = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();      // 5d ago
  const data = {
    version: 1,
    gates: [
      { id: 'high-signal', expiresAt: longAgoExpiry, lastFiredAt: recentFire, pattern: 'still-useful' },
    ],
    promotionLog: [],
  };
  const { data: result, expired } = expireGates(data);
  assert.equal(expired.length, 0, 'high-signal gate should not expire');
  const renewed = result.gates.find((g) => g.id === 'high-signal');
  assert.ok(renewed, 'gate should still be present');
  // expiresAt should have been pushed forward
  assert.ok(Date.parse(renewed.expiresAt) > Date.parse(longAgoExpiry));
});

test('expireGates tolerates malformed input without throwing', () => {
  assert.doesNotThrow(() => expireGates(null));
  assert.doesNotThrow(() => expireGates(undefined));
  assert.doesNotThrow(() => expireGates({ gates: 'not-an-array' }));
});

test('recordGateFire updates lastFiredAt and pushes expiresAt forward', () => {
  const originalExpiry = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
  const data = {
    version: 1,
    gates: [{ id: 'gate-x', expiresAt: originalExpiry, lastFiredAt: null, pattern: 'p' }],
    promotionLog: [],
  };
  const updated = recordGateFire(data, 'gate-x');
  assert.ok(updated.lastFiredAt, 'lastFiredAt must be set after fire');
  // After fire, expiresAt should be ~90d from now (push forward), not the original 10d
  const newExpiryMs = Date.parse(updated.expiresAt);
  const originalExpiryMs = Date.parse(originalExpiry);
  assert.ok(newExpiryMs > originalExpiryMs, 'expiresAt must be pushed forward after fire');
});

test('recordGateFire on a permanent gate keeps expiresAt=null', () => {
  const data = {
    version: 1,
    gates: [{ id: 'manual-gate', expiresAt: null, lastFiredAt: null, pattern: 'p' }],
    promotionLog: [],
  };
  const updated = recordGateFire(data, 'manual-gate');
  assert.equal(updated.expiresAt, null, 'permanent gate stays permanent after fire');
  assert.ok(updated.lastFiredAt);
});

test('recordGateFire returns null for unknown gate ID', () => {
  const data = { version: 1, gates: [], promotionLog: [] };
  assert.equal(recordGateFire(data, 'nope'), null);
});

test('getRuleTtlDays defaults to 90 and honors THUMBGATE_RULE_TTL_DAYS', () => {
  const savedEnv = process.env.THUMBGATE_RULE_TTL_DAYS;
  try {
    delete process.env.THUMBGATE_RULE_TTL_DAYS;
    assert.equal(getRuleTtlDays(), 90);
    assert.equal(DEFAULT_RULE_TTL_DAYS, 90);

    process.env.THUMBGATE_RULE_TTL_DAYS = '30';
    assert.equal(getRuleTtlDays(), 30);
    assert.equal(getRuleTtlMs(), 30 * 24 * 60 * 60 * 1000);

    process.env.THUMBGATE_RULE_TTL_DAYS = '-5';
    assert.equal(getRuleTtlDays(), 90, 'negative TTL falls back to default');

    process.env.THUMBGATE_RULE_TTL_DAYS = 'banana';
    assert.equal(getRuleTtlDays(), 90, 'non-numeric TTL falls back to default');
  } finally {
    if (savedEnv === undefined) delete process.env.THUMBGATE_RULE_TTL_DAYS;
    else process.env.THUMBGATE_RULE_TTL_DAYS = savedEnv;
  }
});

// --- Command-signature normalization (Reddit critique: command-equality matching) ---

test('normalizeCommandSignature: collapses whitespace + case', () => {
  assert.strictEqual(
    normalizeCommandSignature('  RM   -rf   node_modules  '),
    'rm -rf node_modules'
  );
});

test('normalizeCommandSignature: strips leading ./ on path tokens', () => {
  assert.strictEqual(
    normalizeCommandSignature('rm -rf ./node_modules'),
    normalizeCommandSignature('rm -rf node_modules')
  );
});

test('normalizeCommandSignature: strips outer quotes/backticks per token', () => {
  assert.strictEqual(
    normalizeCommandSignature('rm -rf "node_modules"'),
    normalizeCommandSignature('rm -rf node_modules')
  );
  assert.strictEqual(
    normalizeCommandSignature("git push 'origin' main"),
    normalizeCommandSignature('git push origin main')
  );
  assert.strictEqual(
    normalizeCommandSignature('echo `whoami`'),
    normalizeCommandSignature('echo whoami')
  );
});

test('normalizeCommandSignature: strips /Users/<name>/ and /home/<name>/ prefixes', () => {
  assert.strictEqual(
    normalizeCommandSignature('cat /Users/igor/workspace/repo/README.md'),
    'cat ~/workspace/repo/readme.md'
  );
  assert.strictEqual(
    normalizeCommandSignature('cat /home/alice/notes.txt'),
    'cat ~/notes.txt'
  );
});

test('normalizeCommandSignature: strips :line and :line:col refs', () => {
  assert.strictEqual(
    normalizeCommandSignature('edit src/foo.js:42'),
    normalizeCommandSignature('edit src/foo.js')
  );
  assert.strictEqual(
    normalizeCommandSignature('edit src/foo.js:42:7'),
    normalizeCommandSignature('edit src/foo.js')
  );
});

test('normalizeCommandSignature: does NOT reorder flags (semantics preserved)', () => {
  // Different flag order = different intent; we must NOT collapse these.
  assert.notStrictEqual(
    normalizeCommandSignature('git push origin main --force'),
    normalizeCommandSignature('git push --force origin main')
  );
});

test('normalizeCommandSignature: does NOT collapse && chains', () => {
  // Multi-step commands must not collapse with single steps.
  assert.notStrictEqual(
    normalizeCommandSignature('rm x && rm y'),
    normalizeCommandSignature('rm x')
  );
});

test('normalizeCommandSignature: empty/null input → empty string', () => {
  assert.strictEqual(normalizeCommandSignature(''), '');
  assert.strictEqual(normalizeCommandSignature(null), '');
  assert.strictEqual(normalizeCommandSignature(undefined), '');
});

test('extractPatternKey: variants of rm -rf node_modules produce the same gate key', () => {
  const variants = [
    'rm -rf node_modules',
    'rm -rf ./node_modules',
    'rm -rf "node_modules"',
    '  RM   -rf   node_modules  ',
    'rm -rf node_modules:42',
  ];
  const keys = variants.map((ctx) => extractPatternKey({ context: ctx }));
  // Every variant should collapse to the same key.
  for (const k of keys) {
    assert.strictEqual(k, keys[0], `expected all variants to match: ${JSON.stringify(keys)}`);
  }
  assert.ok(keys[0] && keys[0].includes('rm -rf node_modules'));
});

test('extractPatternKey: still prefers tags when present', () => {
  const k = extractPatternKey({
    tags: ['feedback', 'destructive-fs', 'negative'],
    context: 'rm -rf node_modules',
  });
  // Tag-based key wins over command normalization.
  assert.strictEqual(k, 'destructive-fs');
});
