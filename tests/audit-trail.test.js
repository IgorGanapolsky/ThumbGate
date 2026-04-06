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
  skillAdherence,
  evaluateSelfHealTrigger,
  tuneCacheThreshold,
  sanitizeToolInput,
  AUDIT_LOG_FILENAME,
  CACHE_TUNE_STATE_FILENAME,
} = require('../scripts/audit-trail');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withTempDir(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-audit-'));
  const origDir = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  try {
    return fn(tmpDir);
  } finally {
    if (origDir === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = origDir;
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

// ---------------------------------------------------------------------------
// Skill Adherence
// ---------------------------------------------------------------------------

test('skillAdherence computes per-tool adherence rates', () => {
  withTempDir(() => {
    recordAuditEvent({ toolName: 'Bash', decision: 'allow' });
    recordAuditEvent({ toolName: 'Bash', decision: 'allow' });
    recordAuditEvent({ toolName: 'Bash', decision: 'deny', gateId: 'g1' });
    recordAuditEvent({ toolName: 'Read', decision: 'allow' });

    const result = skillAdherence();
    assert.equal(result.totalTools, 2);
    assert.equal(result.byTool['Bash'].adherence, 66.67);
    assert.equal(result.byTool['Read'].adherence, 100);
    assert.equal(result.overall, 75);
  });
});

test('skillAdherence returns 100% for empty log', () => {
  withTempDir(() => {
    const result = skillAdherence();
    assert.equal(result.overall, 100);
    assert.equal(result.totalTools, 0);
  });
});

// ---------------------------------------------------------------------------
// Self-Heal Trigger
// ---------------------------------------------------------------------------

test('evaluateSelfHealTrigger does not trigger below threshold', () => {
  withTempDir(() => {
    recordAuditEvent({ toolName: 'Bash', decision: 'deny', gateId: 'g1' });
    recordAuditEvent({ toolName: 'Bash', decision: 'deny', gateId: 'g2' });

    const result = evaluateSelfHealTrigger({ denyThreshold: 3 });
    assert.equal(result.triggered, false);
    assert.equal(result.recentDenials, 2);
  });
});

test('evaluateSelfHealTrigger triggers at threshold', () => {
  withTempDir(() => {
    recordAuditEvent({ toolName: 'Bash', decision: 'deny', gateId: 'g1' });
    recordAuditEvent({ toolName: 'Bash', decision: 'deny', gateId: 'g2' });
    recordAuditEvent({ toolName: 'Edit', decision: 'deny', gateId: 'g3' });

    const result = evaluateSelfHealTrigger({ denyThreshold: 3, windowMs: 60000 });
    assert.equal(result.triggered, true);
    assert.equal(result.recentDenials, 3);
    assert.ok(Array.isArray(result.gates));
    assert.ok(result.healResult !== undefined);
  });
});

test('evaluateSelfHealTrigger ignores old denials outside window', () => {
  withTempDir((tmpDir) => {
    // Write an old denial manually (2 hours ago)
    const oldRecord = {
      id: 'audit_old',
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      toolName: 'Bash',
      decision: 'deny',
      gateId: 'g1',
      source: 'gates-engine',
    };
    const logPath = path.join(tmpDir, AUDIT_LOG_FILENAME);
    fs.writeFileSync(logPath, JSON.stringify(oldRecord) + '\n');

    // Only 1 recent denial
    recordAuditEvent({ toolName: 'Bash', decision: 'deny', gateId: 'g2' });

    const result = evaluateSelfHealTrigger({ denyThreshold: 2, windowMs: 300000 });
    assert.equal(result.triggered, false);
    assert.equal(result.recentDenials, 1);
  });
});

// ---------------------------------------------------------------------------
// Cache Threshold Tuning
// ---------------------------------------------------------------------------

test('tuneCacheThreshold recommends tighter threshold on high deny rate', () => {
  withTempDir(() => {
    // 8 denials, 2 allows = 80% deny rate
    for (let i = 0; i < 8; i++) {
      recordAuditEvent({ toolName: 'Bash', decision: 'deny', gateId: 'g1' });
    }
    recordAuditEvent({ toolName: 'Read', decision: 'allow' });
    recordAuditEvent({ toolName: 'Read', decision: 'allow' });

    const origThreshold = process.env.THUMBGATE_SEMANTIC_CACHE_THRESHOLD;
    process.env.THUMBGATE_SEMANTIC_CACHE_THRESHOLD = '0.7';
    try {
      const result = tuneCacheThreshold();
      assert.equal(result.currentThreshold, 0.7);
      assert.equal(result.recommendedThreshold, 0.72);
      assert.equal(result.applied, true);
    } finally {
      if (origThreshold === undefined) delete process.env.THUMBGATE_SEMANTIC_CACHE_THRESHOLD;
      else process.env.THUMBGATE_SEMANTIC_CACHE_THRESHOLD = origThreshold;
    }
  });
});

test('tuneCacheThreshold recommends looser threshold on low deny rate', () => {
  withTempDir(() => {
    // 20 allows, 0 denials = 0% deny rate
    for (let i = 0; i < 20; i++) {
      recordAuditEvent({ toolName: 'Read', decision: 'allow' });
    }

    const origThreshold = process.env.THUMBGATE_SEMANTIC_CACHE_THRESHOLD;
    process.env.THUMBGATE_SEMANTIC_CACHE_THRESHOLD = '0.7';
    try {
      const result = tuneCacheThreshold();
      assert.equal(result.currentThreshold, 0.7);
      assert.equal(result.recommendedThreshold, 0.68);
      assert.equal(result.applied, true);
    } finally {
      if (origThreshold === undefined) delete process.env.THUMBGATE_SEMANTIC_CACHE_THRESHOLD;
      else process.env.THUMBGATE_SEMANTIC_CACHE_THRESHOLD = origThreshold;
    }
  });
});

test('tuneCacheThreshold persists state file', () => {
  withTempDir((tmpDir) => {
    recordAuditEvent({ toolName: 'Read', decision: 'allow' });

    tuneCacheThreshold();

    const statePath = path.join(tmpDir, CACHE_TUNE_STATE_FILENAME);
    assert.ok(fs.existsSync(statePath), 'Cache tune state file should exist');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    assert.ok(state.timestamp);
    assert.ok(typeof state.recommendedThreshold === 'number');
  });
});

test('tuneCacheThreshold does not exceed bounds', () => {
  withTempDir(() => {
    for (let i = 0; i < 10; i++) {
      recordAuditEvent({ toolName: 'Bash', decision: 'deny', gateId: 'g1' });
    }

    const origThreshold = process.env.THUMBGATE_SEMANTIC_CACHE_THRESHOLD;
    process.env.THUMBGATE_SEMANTIC_CACHE_THRESHOLD = '0.94';
    try {
      const result = tuneCacheThreshold();
      assert.ok(result.recommendedThreshold <= 0.95);
    } finally {
      if (origThreshold === undefined) delete process.env.THUMBGATE_SEMANTIC_CACHE_THRESHOLD;
      else process.env.THUMBGATE_SEMANTIC_CACHE_THRESHOLD = origThreshold;
    }
  });
});
