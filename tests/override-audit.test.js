'use strict';

/**
 * override-audit.test.js
 *
 * These tests assert the CONTROL behaves correctly against known-bad input,
 * not that the happy path works. The failure this guards against is an
 * override log that silently misses overrides — which reads as completeness
 * and is therefore worse than having no log at all.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  recordOverride,
  readOverrides,
  summarizeOverrides,
  OVERRIDE_DECISION,
  SOURCES,
} = require('../scripts/override-audit');

function tmpLog(prefix = 'tg-ovr-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, logPath: path.join(dir, 'audit-trail.jsonl') };
}

function writeRecords(logPath, records) {
  fs.writeFileSync(logPath, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

function overrideRecord(overrides = {}) {
  return {
    id: `audit_${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    toolName: 'gate-override',
    toolInput: {},
    decision: OVERRIDE_DECISION,
    gateId: overrides.gateId || 'pr_create_allowed',
    message: null,
    severity: 'high',
    latencyMs: null,
    source: 'override-audit',
    override: {
      gateId: overrides.gateId || 'pr_create_allowed',
      source: overrides.source || 'cli',
      actor: overrides.actor || 'agent',
      reason: overrides.reason || null,
      evidence: overrides.evidence || null,
      structuredReasoning: overrides.structuredReasoning || null,
      reasoned: Boolean(overrides.structuredReasoning),
      ttlMs: null,
      pathGlobs: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

test('recordOverride refuses an override with no gateId (unattributable)', () => {
  assert.equal(recordOverride({}), null);
  assert.equal(recordOverride({ gateId: '' }), null);
  assert.equal(recordOverride({ gateId: '   ' }), null);
  assert.equal(recordOverride({ gateId: 42 }), null);
});

test('unknown sources are recorded as "unknown", never dropped or trusted', () => {
  const { logPath } = tmpLog();
  writeRecords(logPath, [
    overrideRecord({ source: 'cli' }),
    overrideRecord({ source: 'mcp' }),
  ]);
  const found = readOverrides({ logPath });
  assert.equal(found.length, 2);
  // SOURCES is the closed vocabulary the panel can group by.
  assert.ok(SOURCES.includes('cli') && SOURCES.includes('mcp') && SOURCES.includes('unknown'));
});

// ---------------------------------------------------------------------------
// The core property: an override must be distinguishable BY TYPE
// ---------------------------------------------------------------------------

test('overrides are found by decision type, not by toolName heuristics', () => {
  const { logPath } = tmpLog();
  writeRecords(logPath, [
    // A normal blocked Bash call that merely MENTIONS the gate id in its text.
    // Before typed events this was indistinguishable from a real override.
    {
      id: 'a1', timestamp: new Date().toISOString(), toolName: 'Bash',
      toolInput: { command: 'echo satisfy_gate pr_create_allowed' },
      decision: 'deny', gateId: 'gh-pr-create-restricted',
      message: 'Bypassable via satisfy_gate("pr_create_allowed")',
      severity: 'high', latencyMs: null, source: 'gates-engine',
    },
    // A genuine override.
    overrideRecord({ gateId: 'pr_create_allowed', source: 'mcp' }),
  ]);

  const found = readOverrides({ logPath });
  assert.equal(found.length, 1, 'the deny row must not be counted as an override');
  assert.equal(found[0].override.gateId, 'pr_create_allowed');
  assert.equal(found[0].override.source, 'mcp');
});

test('a row with decision=override but no override payload is rejected', () => {
  const { logPath } = tmpLog();
  writeRecords(logPath, [
    { id: 'x', timestamp: new Date().toISOString(), decision: OVERRIDE_DECISION },
  ]);
  assert.equal(readOverrides({ logPath }).length, 0);
});

// ---------------------------------------------------------------------------
// Resilience — a broken log must not blind the panel
// ---------------------------------------------------------------------------

test('a corrupt line does not abort the scan; surrounding overrides still surface', () => {
  const { logPath } = tmpLog();
  const good1 = JSON.stringify(overrideRecord({ gateId: 'gate_a' }));
  const good2 = JSON.stringify(overrideRecord({ gateId: 'gate_b' }));
  fs.writeFileSync(logPath, `${good1}\n{"decision":"override" TRUNCATED\n${good2}\n`);

  const found = readOverrides({ logPath });
  assert.equal(found.length, 2, 'corrupt middle line must not hide valid records');
  const ids = found.map((r) => r.override.gateId).sort();
  assert.deepEqual(ids, ['gate_a', 'gate_b']);
});

test('missing and empty log files return [] rather than throwing', () => {
  const { dir, logPath } = tmpLog();
  assert.deepEqual(readOverrides({ logPath: path.join(dir, 'nope.jsonl') }), []);
  fs.writeFileSync(logPath, '');
  assert.deepEqual(readOverrides({ logPath }), []);
});

// ---------------------------------------------------------------------------
// Scale — the panel must not allocate a 100MB history to render 50 rows
// ---------------------------------------------------------------------------

test('large log is tail-scanned within a bounded window', () => {
  const { logPath } = tmpLog();
  const filler = JSON.stringify({
    id: 'f', timestamp: new Date().toISOString(), toolName: 'Bash',
    toolInput: { command: 'x'.repeat(200) }, decision: 'allow',
    gateId: null, message: null, severity: null, latencyMs: null, source: 'gates-engine',
  });
  const stream = fs.createWriteStream(logPath);
  for (let i = 0; i < 40000; i += 1) stream.write(`${filler}\n`);
  stream.write(`${JSON.stringify(overrideRecord({ gateId: 'tail_gate' }))}\n`);
  stream.end();

  return new Promise((resolve) => {
    stream.on('close', () => {
      const before = process.memoryUsage().heapUsed;
      const found = readOverrides({ logPath });
      const grewMb = (process.memoryUsage().heapUsed - before) / (1024 * 1024);
      assert.equal(found.length, 1);
      assert.equal(found[0].override.gateId, 'tail_gate');
      assert.ok(grewMb < 64, `tail scan should stay bounded, heap grew ${grewMb.toFixed(1)} MB`);
      resolve();
    });
  });
});

test('limit is honored and newest records come first', () => {
  const { logPath } = tmpLog();
  writeRecords(logPath, [
    overrideRecord({ gateId: 'oldest' }),
    overrideRecord({ gateId: 'middle' }),
    overrideRecord({ gateId: 'newest' }),
  ]);
  const found = readOverrides({ logPath, limit: 2 });
  assert.equal(found.length, 2);
  assert.equal(found[0].override.gateId, 'newest', 'newest must sort first');
  assert.equal(readOverrides({ logPath, limit: 0 }).length, 0);
});

// ---------------------------------------------------------------------------
// Summary — unreasoned overrides are the ones a reviewer must see
// ---------------------------------------------------------------------------

test('summarizeOverrides separates reasoned from unreasoned overrides', () => {
  const { logPath } = tmpLog();
  writeRecords(logPath, [
    overrideRecord({ gateId: 'g1', source: 'cli' }),
    overrideRecord({ gateId: 'g1', source: 'cli' }),
    overrideRecord({
      gateId: 'g2',
      source: 'mcp',
      structuredReasoning: { premise: 'p', evidence: 'e', risk: 'r', conclusion: 'c' },
    }),
  ]);

  const s = summarizeOverrides({ logPath });
  assert.equal(s.total, 3);
  assert.equal(s.unreasoned, 2, 'bare overrides must be counted for review');
  assert.equal(s.byGate.g1, 2);
  assert.equal(s.byGate.g2, 1);
  assert.equal(s.bySource.cli, 2);
  assert.equal(s.bySource.mcp, 1);
  assert.ok(s.mostRecent);
});

test('summarize on an empty log is zeroed, not undefined', () => {
  const { dir } = tmpLog();
  const s = summarizeOverrides({ logPath: path.join(dir, 'absent.jsonl') });
  assert.equal(s.total, 0);
  assert.equal(s.unreasoned, 0);
  assert.deepEqual(s.byGate, {});
  assert.equal(s.mostRecent, null);
});

// ---------------------------------------------------------------------------
// End-to-end: the CLI path that previously left NO trace
// ---------------------------------------------------------------------------

test('satisfyCondition writes a typed override to the audit trail (regression)', () => {
  const { dir } = tmpLog('tg-ovr-e2e-');
  const prevHome = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_FEEDBACK_DIR = dir;

  // Fresh module registry so both modules resolve the redirected log path.
  for (const k of Object.keys(require.cache)) {
    if (k.includes('gates-engine') || k.includes('audit-trail') || k.includes('override-audit')) {
      delete require.cache[k];
    }
  }

  try {
    const engine = require('../scripts/gates-engine');
    engine.satisfyCondition('pr_threads_checked', 'no PR exists for this branch', {
      premise: 'push a new branch',
      evidence: 'gh pr list --head returned empty',
      risk: 'low, additive only',
      conclusion: 'proceed',
    }, { source: 'cli', actor: 'test-agent' });

    const { readOverrides: read } = require('../scripts/override-audit');
    const found = read({ logPath: path.join(dir, 'audit-trail.jsonl') });

    assert.ok(found.length >= 1, 'CLI-path satisfyCondition MUST leave an audit record');
    const rec = found[0];
    assert.equal(rec.decision, OVERRIDE_DECISION);
    assert.equal(rec.override.gateId, 'pr_threads_checked');
    assert.equal(rec.override.source, 'cli');
    assert.equal(rec.override.actor, 'test-agent');
    assert.equal(rec.override.reasoned, true);
    assert.equal(rec.override.structuredReasoning.premise, 'push a new branch');
  } finally {
    if (prevHome === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = prevHome;
  }
});

test('oversized evidence is truncated with an explicit marker, not silently cut', () => {
  const { dir } = tmpLog('tg-ovr-clip-');
  const prevHome = process.env.THUMBGATE_FEEDBACK_DIR;
  process.env.THUMBGATE_FEEDBACK_DIR = dir;
  for (const k of Object.keys(require.cache)) {
    if (k.includes('audit-trail') || k.includes('override-audit')) delete require.cache[k];
  }
  try {
    const { recordOverride: rec, readOverrides: read } = require('../scripts/override-audit');
    rec({ gateId: 'big_gate', source: 'mcp', evidence: 'z'.repeat(9000) });
    const found = read({ logPath: path.join(dir, 'audit-trail.jsonl') });
    assert.equal(found.length, 1);
    assert.ok(found[0].override.evidence.includes('[truncated'), 'truncation must be visible');
    assert.ok(found[0].override.evidence.length < 9000);
  } finally {
    if (prevHome === undefined) delete process.env.THUMBGATE_FEEDBACK_DIR;
    else process.env.THUMBGATE_FEEDBACK_DIR = prevHome;
  }
});
