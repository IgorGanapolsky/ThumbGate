'use strict';

/**
 * Regression guard for the 2026-08-21 post-deploy verification outage.
 *
 * "Deploy to Railway" and "Verify Production Deploy" were red on 10 consecutive
 * main commits. Production was healthy and authenticated search/export worked;
 * only the `dashboard_data` check failed, with the server returning
 *   503 "Dashboard data too large"
 *   "... Cause: Cannot create a string longer than 0x1fffffe8 characters"
 *
 * Root cause: two JSONL readers on the /v1/dashboard assembly path did an
 * UNBOUNDED fs.readFileSync():
 *   - scripts/intervention-policy.js  readJSONL()          (feedback/audit/diagnostic logs)
 *   - scripts/telemetry-analytics.js  readTelemetryText()  (telemetry + funnel logs)
 * scripts/dashboard.js had already been tail-capped; these siblings were missed.
 * Once a production log passed V8's max string length, every /v1/dashboard call
 * threw.
 *
 * These tests assert the readers stay bounded and never throw on oversized input.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { DEFAULT_JSONL_TAIL_BYTES } = require('../scripts/fs-utils');

// Must exceed HARD_FULL_READ_BYTES (64 MiB) in scripts/fs-utils.js so the
// unconditional ceiling is what we are exercising, not a caller-supplied cap.
const OVERSIZED_BYTES = 68 * 1024 * 1024;

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tg-oversized-'));
}

function writeOversizedJsonl(filePath, record) {
  const line = `${JSON.stringify(record)}\n`;
  const chunk = line.repeat(2000);
  const fd = fs.openSync(filePath, 'w');
  try {
    let written = 0;
    while (written < OVERSIZED_BYTES) written += fs.writeSync(fd, chunk);
  } finally {
    fs.closeSync(fd);
  }
  return fs.statSync(filePath).size;
}

test('intervention-policy readJSONL stays bounded on an oversized log', (t) => {
  const dir = makeTempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const target = path.join(dir, 'feedback-log.jsonl');
  const size = writeOversizedJsonl(target, {
    timestamp: new Date().toISOString(),
    signal: 'down',
    context: 'x'.repeat(300),
  });
  assert.ok(size > DEFAULT_JSONL_TAIL_BYTES * 4, 'fixture must be far larger than the tail budget');

  // Exercised through the module's own export surface.
  const policy = require('../scripts/intervention-policy');
  const summary = policy.getInterventionPolicySummary(dir);
  assert.ok(summary && typeof summary === 'object', 'summary must assemble, not throw');
});

test('telemetry readTelemetryText caps an oversized log instead of throwing', (t) => {
  const dir = makeTempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const target = path.join(dir, 'telemetry-pings.jsonl');
  writeOversizedJsonl(target, {
    receivedAt: new Date().toISOString(),
    eventType: 'cta_click',
    clientType: 'web',
  });

  const telemetry = require('../scripts/telemetry-analytics');
  // No maxBytes supplied — this is the exact call shape that used to do a full
  // read and blow the V8 string limit for an unbounded analytics window.
  const events = telemetry.loadTelemetryEvents(dir, {});
  assert.ok(Array.isArray(events), 'telemetry events must load, not throw');
  // Tail-capped: far fewer than the ~68 MiB of records on disk.
  assert.ok(events.length > 0, 'the tail must still yield usable records');
});

test('generateDashboard assembles when feedback and telemetry logs are oversized', (t) => {
  const dir = makeTempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  writeOversizedJsonl(path.join(dir, 'feedback-log.jsonl'), {
    timestamp: new Date().toISOString(),
    signal: 'down',
    context: 'y'.repeat(300),
  });
  writeOversizedJsonl(path.join(dir, 'telemetry-pings.jsonl'), {
    receivedAt: new Date().toISOString(),
    eventType: 'cta_click',
  });
  for (const name of ['memory-log.jsonl', 'diagnostic-log.jsonl', 'audit-trail.jsonl']) {
    fs.writeFileSync(path.join(dir, name), `${JSON.stringify({ timestamp: new Date().toISOString() })}\n`);
  }

  const { generateDashboard } = require('../scripts/dashboard');
  const data = generateDashboard(dir, {});
  assert.ok(data && typeof data === 'object', '/v1/dashboard payload must assemble');
  assert.ok(Object.keys(data).length > 5, 'dashboard payload must not be a stub');
});

test('prove-production-authenticated names the failing check and its problem', () => {
  const { renderFailureSummary } = require('../scripts/prove-production-authenticated');

  const summary = renderFailureSummary({
    verdict: 'fail',
    baseUrl: 'https://thumbgate.ai',
    expectedVersion: '1.35.0',
    expectedSha: 'b4faaa2353c1086e9c090afbbe7bf8dc61cf8c67',
    checks: [
      { name: 'search', ok: true, status: 200, attempts: 1, durationMs: 10 },
      {
        name: 'dashboard_data',
        ok: false,
        status: 503,
        attempts: 6,
        durationMs: 5779,
        schemaValid: false,
        problemTitle: 'Dashboard data too large',
        problemDetail: 'Cause: Cannot create a string longer than 0x1fffffe8 characters',
      },
    ],
  });

  assert.match(summary, /AUTHENTICATED PRODUCTION PROOF FAILED/);
  assert.match(summary, /FAILED CHECK: dashboard_data/);
  assert.match(summary, /Dashboard data too large/);
  assert.match(summary, /status=503 attempts=6/);
  assert.ok(!summary.includes('FAILED CHECK: search'), 'passing checks must not be listed as failures');
});

test('prove-production-authenticated summary is empty on pass', () => {
  const { renderFailureSummary } = require('../scripts/prove-production-authenticated');
  assert.equal(renderFailureSummary({ verdict: 'pass', checks: [] }), '');
});

test('prove-production-authenticated flags an absent credential as an admin task', () => {
  const { renderFailureSummary } = require('../scripts/prove-production-authenticated');
  const summary = renderFailureSummary({
    verdict: 'fail',
    baseUrl: 'https://thumbgate.ai',
    reason: 'THUMBGATE_API_KEY is unavailable',
    checks: [],
  });
  assert.match(summary, /HARNESS FAILURE/);
  assert.match(summary, /rotation task for a repo admin/);
});
