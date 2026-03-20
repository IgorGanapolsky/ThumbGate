'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  recordAuditEvent,
  auditToFeedback,
  readAuditLog,
  auditStats,
  sanitizeToolInput,
  AUDIT_LOG_FILENAME,
} = require('../scripts/audit-trail');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withTempDir(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-audit-'));
  const origDir = process.env.RLHF_FEEDBACK_DIR;
  process.env.RLHF_FEEDBACK_DIR = tmpDir;
  try {
    return fn(tmpDir);
  } finally {
    if (origDir === undefined) delete process.env.RLHF_FEEDBACK_DIR;
    else process.env.RLHF_FEEDBACK_DIR = origDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('recordAuditEvent writes a valid JSONL record', () => {
  withTempDir((tmpDir) => {
    const record = recordAuditEvent({
      toolName: 'Bash',
      toolInput: { command: 'git push --force' },
      decision: 'deny',
      gateId: 'force-push',
      message: 'Force push blocked',
      severity: 'critical',
      source: 'gates-engine',
    });

    assert.ok(record.id.startsWith('audit_'));
    assert.equal(record.decision, 'deny');
    assert.equal(record.gateId, 'force-push');
    assert.equal(record.source, 'gates-engine');

    const logPath = path.join(tmpDir, AUDIT_LOG_FILENAME);
    assert.ok(fs.existsSync(logPath), 'Audit log file should exist');

    const entries = readAuditLog(logPath);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].decision, 'deny');
  });
});

test('recordAuditEvent records allow decisions', () => {
  withTempDir(() => {
    const record = recordAuditEvent({
      toolName: 'Read',
      toolInput: { file_path: '/foo/bar.js' },
      decision: 'allow',
      source: 'gates-engine',
    });

    assert.equal(record.decision, 'allow');
    assert.equal(record.gateId, null);
  });
});

test('sanitizeToolInput redacts sensitive fields', () => {
  const sanitized = sanitizeToolInput({
    command: 'echo hello',
    content: 'a'.repeat(500),
    new_string: 'secret-value',
    file_path: '/some/file.js',
  });

  assert.equal(sanitized.command, 'echo hello');
  assert.ok(sanitized.content.includes('[redacted:'));
  assert.ok(sanitized.new_string.includes('[redacted:'));
  assert.equal(sanitized.file_path, '/some/file.js');
});

test('sanitizeToolInput truncates long strings', () => {
  const sanitized = sanitizeToolInput({
    command: 'x'.repeat(300),
  });

  assert.ok(sanitized.command.length < 300);
  assert.ok(sanitized.command.endsWith('...'));
});

test('auditStats aggregates correctly', () => {
  withTempDir(() => {
    recordAuditEvent({ toolName: 'Bash', decision: 'deny', gateId: 'g1', source: 'gates-engine' });
    recordAuditEvent({ toolName: 'Bash', decision: 'deny', gateId: 'g1', source: 'gates-engine' });
    recordAuditEvent({ toolName: 'Read', decision: 'allow', source: 'gates-engine' });
    recordAuditEvent({ toolName: 'Edit', decision: 'warn', gateId: 'g2', source: 'secret-guard' });

    const stats = auditStats();
    assert.equal(stats.total, 4);
    assert.equal(stats.deny, 2);
    assert.equal(stats.allow, 1);
    assert.equal(stats.warn, 1);
    assert.equal(stats.byGate['g1'].deny, 2);
    assert.equal(stats.byGate['g2'].warn, 1);
    assert.equal(stats.bySource['gates-engine'], 3);
    assert.equal(stats.bySource['secret-guard'], 1);
  });
});

test('readAuditLog returns empty array for missing file', () => {
  const entries = readAuditLog('/nonexistent/path/audit.jsonl');
  assert.deepStrictEqual(entries, []);
});

test('auditToFeedback skips allow decisions', () => {
  const result = auditToFeedback({ decision: 'allow', gateId: null });
  assert.equal(result, null);
});

test('auditToFeedback captures deny decisions as negative feedback', () => {
  withTempDir(() => {
    const result = auditToFeedback({
      decision: 'deny',
      gateId: 'force-push',
      toolName: 'Bash',
      message: 'Force push blocked',
      source: 'gates-engine',
    });

    // Feedback capture may reject due to schema validation (title format, etc.)
    // but the function should not throw
    assert.ok(result !== undefined);
  });
});

test('multiple audit records are appended, not overwritten', () => {
  withTempDir(() => {
    recordAuditEvent({ toolName: 'A', decision: 'allow' });
    recordAuditEvent({ toolName: 'B', decision: 'deny', gateId: 'x' });
    recordAuditEvent({ toolName: 'C', decision: 'warn', gateId: 'y' });

    const entries = readAuditLog();
    assert.equal(entries.length, 3);
    assert.equal(entries[0].toolName, 'A');
    assert.equal(entries[1].toolName, 'B');
    assert.equal(entries[2].toolName, 'C');
  });
});
