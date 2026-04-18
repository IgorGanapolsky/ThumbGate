'use strict';

/**
 * Tests for buildRecentCorrectiveActionsContext.
 *
 * Verifies that recently captured mistakes surface as additionalContext on
 * every tool call — plugging the cold-start gap where a mistake just
 * captured via capture_feedback would otherwise wait for the
 * recurring-pattern threshold (≥2 occurrences) before being enforced.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildRecentCorrectiveActionsContext } = require('../scripts/gates-engine');

function createTempFeedbackDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-recent-test-'));
}

function writeMemoryLog(dir, entries) {
  fs.writeFileSync(
    path.join(dir, 'memory-log.jsonl'),
    entries.map((e) => JSON.stringify(e)).join('\n') + '\n',
  );
}

describe('buildRecentCorrectiveActionsContext', () => {
  let tempDir;
  const originalFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
  const originalHome = process.env.HOME;

  beforeEach(() => {
    tempDir = createTempFeedbackDir();
    process.env.THUMBGATE_FEEDBACK_DIR = tempDir;
  });

  afterEach(() => {
    if (originalFeedbackDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = originalFeedbackDir;
    if (originalHome !== undefined) process.env.HOME = originalHome;
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  test('returns null when memory-log.jsonl does not exist', () => {
    const ctx = buildRecentCorrectiveActionsContext();
    assert.equal(ctx, null);
  });

  test('returns null when memory log has no recent entries', () => {
    // All entries older than 24h
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    writeMemoryLog(tempDir, [
      { title: 'MISTAKE: Stale issue', content: 'What went wrong: x\nHow to avoid: y', category: 'error', timestamp: old },
    ]);
    const ctx = buildRecentCorrectiveActionsContext();
    assert.equal(ctx, null);
  });

  test('returns the 3 most recent error entries within 24h', () => {
    const now = Date.now();
    const fresh = (offsetMs) => new Date(now - offsetMs).toISOString();
    writeMemoryLog(tempDir, [
      // Oldest first
      { title: 'MISTAKE: First thing', content: 'What went wrong: a\nHow to avoid: do not a', category: 'error', timestamp: fresh(5 * 60_000) },
      { title: 'MISTAKE: Second thing', content: 'What went wrong: b\nHow to avoid: do not b', category: 'error', timestamp: fresh(4 * 60_000) },
      { title: 'MISTAKE: Third thing', content: 'What went wrong: c\nHow to avoid: do not c', category: 'error', timestamp: fresh(3 * 60_000) },
      { title: 'MISTAKE: Fourth thing', content: 'What went wrong: d\nHow to avoid: do not d', category: 'error', timestamp: fresh(2 * 60_000) },
    ]);
    const ctx = buildRecentCorrectiveActionsContext();
    assert.ok(ctx, 'expected context string');
    assert.ok(ctx.startsWith('[ThumbGate] Recent mistakes'), 'has ThumbGate prefix');
    // Walks tail-first, so Fourth is included, First is excluded (exceeds limit=3)
    assert.ok(ctx.includes('Fourth thing'), 'includes most recent');
    assert.ok(ctx.includes('Third thing'));
    assert.ok(ctx.includes('Second thing'));
    assert.ok(!ctx.includes('First thing'), 'excludes oldest when limit exceeded');
  });

  test('includes avoidance advice when How to avoid line is present', () => {
    const now = new Date().toISOString();
    writeMemoryLog(tempDir, [
      { title: 'MISTAKE: Removed address1 to silence bot', content: 'What went wrong: deleted field\nHow to avoid: read swagger before removing', category: 'error', timestamp: now },
    ]);
    const ctx = buildRecentCorrectiveActionsContext();
    assert.ok(ctx.includes('read swagger before removing'));
  });

  test('honors custom limit and maxAgeMs (append-only ordering)', () => {
    const now = Date.now();
    // Memory log is append-only: older entries first, newer last
    writeMemoryLog(tempDir, [
      { title: 'MISTAKE: ZZ_OLDER_ENTRY', content: '', category: 'error', timestamp: new Date(now - 2000).toISOString() },
      { title: 'MISTAKE: QQ_NEWER_ENTRY', content: '', category: 'error', timestamp: new Date(now - 1000).toISOString() },
    ]);
    const ctx = buildRecentCorrectiveActionsContext({ limit: 1, maxAgeMs: 60_000 });
    assert.ok(ctx.includes('QQ_NEWER_ENTRY'), 'takes newest (tail)');
    assert.ok(!ctx.includes('ZZ_OLDER_ENTRY'), 'limit enforced, older excluded');
  });

  test('ignores malformed JSONL lines', () => {
    const now = new Date().toISOString();
    fs.writeFileSync(
      path.join(tempDir, 'memory-log.jsonl'),
      'not-json\n' +
      JSON.stringify({ title: 'MISTAKE: Good', content: '', category: 'error', timestamp: now }) + '\n',
    );
    const ctx = buildRecentCorrectiveActionsContext();
    assert.ok(ctx, 'should still produce context despite malformed line');
    assert.ok(ctx.includes('Good'));
  });

  test('ignores entries that are not error or learning category', () => {
    const now = new Date().toISOString();
    writeMemoryLog(tempDir, [
      { title: 'Random info', content: '', category: 'other', timestamp: now },
      { title: 'MISTAKE: Actual error', content: '', category: 'error', timestamp: now },
    ]);
    const ctx = buildRecentCorrectiveActionsContext();
    assert.ok(ctx.includes('Actual error'));
    assert.ok(!ctx.includes('Random info'));
  });
});
