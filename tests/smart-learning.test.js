// tests/smart-learning.test.js
// Tests for #202 (time-weighted decay), #203 (tool attribution), #204 (rolling windows)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  captureFeedback,
  analyzeFeedback,
  buildPreventionRules,
  readJSONL,
} = require('../scripts/feedback-loop');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-smart-test-'));
}

function appendJSONL(filePath, record) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
}

// =============================================================================
// #204: Rolling windows + trend detection
// =============================================================================

test('analyzeFeedback returns windows and trend fields', () => {
  const tmp = makeTmpDir();
  const logPath = path.join(tmp, 'feedback-log.jsonl');
  const now = new Date();

  // 3 recent positives (within 7 days)
  for (let i = 0; i < 3; i++) {
    const ts = new Date(now - i * 60 * 1000);
    appendJSONL(logPath, { signal: 'positive', tags: [], timestamp: ts.toISOString() });
  }
  // 7 old negatives (20 days ago)
  for (let i = 0; i < 7; i++) {
    const ts = new Date(now - 20 * 24 * 60 * 60 * 1000 - i * 60 * 1000);
    appendJSONL(logPath, { signal: 'negative', tags: [], timestamp: ts.toISOString() });
  }

  const stats = analyzeFeedback(logPath);

  // Rolling windows exist
  assert.ok(stats.windows, 'should have windows field');
  assert.ok(stats.windows['7d'], 'should have 7d window');
  assert.ok(stats.windows['30d'], 'should have 30d window');
  assert.ok(stats.windows.lifetime, 'should have lifetime window');
  assert.ok(stats.trend, 'should have trend field');

  // 7d window: 3 positive out of 3 = 1.0
  assert.strictEqual(stats.windows['7d'].total, 3);
  assert.strictEqual(stats.windows['7d'].positive, 3);
  assert.strictEqual(stats.windows['7d'].rate, 1);

  // 30d window: 3 positive out of 10 = 0.3
  assert.strictEqual(stats.windows['30d'].total, 10);
  assert.strictEqual(stats.windows['30d'].positive, 3);
  assert.strictEqual(stats.windows['30d'].rate, 0.3);

  // Lifetime: 3/10 = 0.3
  assert.strictEqual(stats.windows.lifetime.total, 10);
  assert.strictEqual(stats.windows.lifetime.rate, 0.3);

  // Trend: 7d (1.0) > 30d (0.3) + 0.05 = improving
  assert.strictEqual(stats.trend, 'improving');

  fs.rmSync(tmp, { recursive: true });
});

test('analyzeFeedback trend is degrading when recent is worse', () => {
  const tmp = makeTmpDir();
  const logPath = path.join(tmp, 'feedback-log.jsonl');
  const now = new Date();

  // 5 recent negatives (within 7 days)
  for (let i = 0; i < 5; i++) {
    const ts = new Date(now - i * 60 * 1000);
    appendJSONL(logPath, { signal: 'negative', tags: [], timestamp: ts.toISOString() });
  }
  // 5 old positives (15 days ago, within 30d)
  for (let i = 0; i < 5; i++) {
    const ts = new Date(now - 15 * 24 * 60 * 60 * 1000 - i * 60 * 1000);
    appendJSONL(logPath, { signal: 'positive', tags: [], timestamp: ts.toISOString() });
  }

  const stats = analyzeFeedback(logPath);

  // 7d: 0/5 = 0.0, 30d: 5/10 = 0.5
  assert.strictEqual(stats.windows['7d'].rate, 0);
  assert.strictEqual(stats.windows['30d'].rate, 0.5);
  assert.strictEqual(stats.trend, 'degrading');

  fs.rmSync(tmp, { recursive: true });
});

test('analyzeFeedback trend is stable when rates are similar', () => {
  const tmp = makeTmpDir();
  const logPath = path.join(tmp, 'feedback-log.jsonl');
  const now = new Date();

  // Mix of positive/negative within 7 days
  appendJSONL(logPath, { signal: 'positive', tags: [], timestamp: new Date(now - 1000).toISOString() });
  appendJSONL(logPath, { signal: 'negative', tags: [], timestamp: new Date(now - 2000).toISOString() });
  // Same mix 15 days ago
  appendJSONL(logPath, { signal: 'positive', tags: [], timestamp: new Date(now - 15 * 24 * 60 * 60 * 1000).toISOString() });
  appendJSONL(logPath, { signal: 'negative', tags: [], timestamp: new Date(now - 15 * 24 * 60 * 60 * 1000 - 1000).toISOString() });

  const stats = analyzeFeedback(logPath);
  assert.strictEqual(stats.trend, 'stable');

  fs.rmSync(tmp, { recursive: true });
});

test('analyzeFeedback treats an empty 7d window as stable, not degrading', () => {
  const tmp = makeTmpDir();
  const logPath = path.join(tmp, 'feedback-log.jsonl');
  const now = new Date();

  for (let i = 0; i < 4; i++) {
    const ts = new Date(now - 15 * 24 * 60 * 60 * 1000 - i * 60 * 1000);
    appendJSONL(logPath, { signal: 'positive', tags: [], timestamp: ts.toISOString() });
  }

  const stats = analyzeFeedback(logPath);
  assert.strictEqual(stats.windows['7d'].total, 0);
  assert.strictEqual(stats.windows['30d'].rate, 1);
  assert.strictEqual(stats.trend, 'stable');

  fs.rmSync(tmp, { recursive: true });
});

// =============================================================================
// #202: Time-weighted decay in prevention rules
// =============================================================================

test('buildPreventionRules applies time-weighted decay', () => {
  const tmp = makeTmpDir();
  const memLogPath = path.join(tmp, 'memory-log.jsonl');
  const now = new Date();

  // 5 old mistakes (60 days ago) — should decay heavily
  for (let i = 0; i < 5; i++) {
    const ts = new Date(now - 60 * 24 * 60 * 60 * 1000);
    appendJSONL(memLogPath, {
      category: 'error',
      tags: ['old-pattern'],
      title: 'MISTAKE: old error',
      content: 'How to avoid: check first',
      timestamp: ts.toISOString(),
    });
  }

  // 2 recent mistakes (1 day ago) — should have high weight
  for (let i = 0; i < 2; i++) {
    const ts = new Date(now - 1 * 24 * 60 * 60 * 1000);
    appendJSONL(memLogPath, {
      category: 'error',
      tags: ['recent-pattern'],
      title: 'MISTAKE: recent error',
      content: 'How to avoid: verify before push',
      timestamp: ts.toISOString(),
    });
  }

  process.env.THUMBGATE_FEEDBACK_DIR = tmp;
  try {
    // With decay half-life of 7 days, old mistakes (60 days) have weight ~0.0025 each
    // 5 * 0.0025 = 0.0125 (below threshold of 2)
    // Recent mistakes: 2 * ~0.91 = 1.82 (still below 2 with default, but above 1)
    const rules = buildPreventionRules(1, { decayHalfLifeDays: 7 });

    // Recent pattern should appear (weight ~1.82 > 1)
    assert.ok(rules.includes('recent-pattern'), 'recent-pattern should be in rules');
    // Old pattern should show weighted count much lower than raw count
    if (rules.includes('old-pattern')) {
      assert.ok(rules.includes('weighted:'), 'should show weighted count');
      // The weighted count should be much less than raw 5
      const match = rules.match(/old-pattern[\s\S]*?weighted:\s*([\d.]+)/);
      if (match) {
        assert.ok(parseFloat(match[1]) < 1, `weighted count ${match[1]} should be < 1 for 60-day old items`);
      }
    }
  } finally {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    fs.rmSync(tmp, { recursive: true });
  }
});

test('buildPreventionRules header mentions half-life', () => {
  const tmp = makeTmpDir();
  const memLogPath = path.join(tmp, 'memory-log.jsonl');
  appendJSONL(memLogPath, {
    category: 'error',
    tags: ['test'],
    title: 'MISTAKE: test',
    content: 'How to avoid: fix it',
    timestamp: new Date().toISOString(),
  });

  process.env.THUMBGATE_FEEDBACK_DIR = tmp;
  try {
    const rules = buildPreventionRules(1, { decayHalfLifeDays: 14 });
    assert.ok(rules.includes('half-life: 14d'), 'header should mention half-life');
  } finally {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    fs.rmSync(tmp, { recursive: true });
  }
});

test('buildPreventionRules keeps default threshold behavior for two recent mistakes', () => {
  const tmp = makeTmpDir();
  const memLogPath = path.join(tmp, 'memory-log.jsonl');
  const now = new Date();

  for (let i = 0; i < 2; i++) {
    const ts = new Date(now - 1 * 24 * 60 * 60 * 1000 - i * 60 * 1000);
    appendJSONL(memLogPath, {
      category: 'error',
      tags: ['recent-pattern'],
      title: 'MISTAKE: recent error',
      content: 'How to avoid: verify before push',
      timestamp: ts.toISOString(),
    });
  }

  process.env.THUMBGATE_FEEDBACK_DIR = tmp;
  try {
    const rules = buildPreventionRules(2, { decayHalfLifeDays: 7 });
    assert.ok(rules.includes('recent-pattern'), 'two recent mistakes should still meet the default threshold');
  } finally {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    fs.rmSync(tmp, { recursive: true });
  }
});

// =============================================================================
// #203: Tool-call attribution in captureFeedback
// =============================================================================

test('captureFeedback stores lastAction when provided', () => {
  const tmp = makeTmpDir();
  process.env.THUMBGATE_FEEDBACK_DIR = tmp;
  try {
    const result = captureFeedback({
      signal: 'down',
      context: 'wrong file edited',
      whatWentWrong: 'edited production config',
      whatToChange: 'check file path first',
      lastAction: {
        tool: 'Edit',
        contextKey: 'Edit:config',
        file: 'src/config/prod.ts',
        timestamp: '2026-03-15T17:00:00Z',
      },
      tags: ['test-attribution'],
    });

    assert.ok(result.accepted || result.status === 'promoted' || result.feedbackEvent,
      'should capture feedback');

    // Verify lastAction is in the event
    const event = result.feedbackEvent;
    assert.ok(event.lastAction, 'feedbackEvent should have lastAction');
    assert.strictEqual(event.lastAction.tool, 'Edit');
    assert.strictEqual(event.lastAction.contextKey, 'Edit:config');
    assert.strictEqual(event.lastAction.file, 'src/config/prod.ts');
  } finally {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    fs.rmSync(tmp, { recursive: true });
  }
});

test('captureFeedback lastAction is null when not provided', () => {
  const tmp = makeTmpDir();
  process.env.THUMBGATE_FEEDBACK_DIR = tmp;
  try {
    const result = captureFeedback({
      signal: 'up',
      context: 'good work',
      whatWorked: 'evidence-based approach',
      tags: ['test-no-attribution'],
    });

    const event = result.feedbackEvent;
    assert.strictEqual(event.lastAction, null, 'lastAction should be null when not provided');
  } finally {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    fs.rmSync(tmp, { recursive: true });
  }
});

test('captureFeedback lastAction persists to JSONL', () => {
  const tmp = makeTmpDir();
  process.env.THUMBGATE_FEEDBACK_DIR = tmp;
  try {
    captureFeedback({
      signal: 'down',
      context: 'bad push',
      whatWentWrong: 'pushed to main',
      lastAction: { tool: 'Bash', contextKey: 'Bash:git_push' },
      tags: ['test-persist'],
    });

    const logPath = path.join(tmp, 'feedback-log.jsonl');
    const entries = readJSONL(logPath);
    const last = entries[entries.length - 1];
    assert.ok(last.lastAction, 'persisted entry should have lastAction');
    assert.strictEqual(last.lastAction.tool, 'Bash');
    assert.strictEqual(last.lastAction.contextKey, 'Bash:git_push');
  } finally {
    delete process.env.THUMBGATE_FEEDBACK_DIR;
    fs.rmSync(tmp, { recursive: true });
  }
});
