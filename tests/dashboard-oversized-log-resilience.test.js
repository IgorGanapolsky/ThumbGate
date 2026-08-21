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

/**
 * Follow-ups from the PR #3602 review (chatgpt-codex-connector, two P1 threads).
 *
 * Bounding the readers fixed the 503, but it introduced two honesty problems:
 *   1. Retraining the intervention model inherited the dashboard's 4 MiB tail
 *      and then OVERWROTE the persisted model, silently discarding history.
 *   2. getTelemetrySummary() still labelled its window `lifetime` even when the
 *      underlying telemetry log had been read as a tail, so partial acquisition
 *      and conversion counts were presented as complete.
 *
 * These tests pin both fixes.
 */

test('retraining reads a larger window than the dashboard tail', (t) => {
  const dir = makeTempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const learner = require('../scripts/intervention-policy');
  assert.ok(
    learner.TRAINING_TAIL_BYTES > DEFAULT_JSONL_TAIL_BYTES,
    'training must not be capped at the dashboard tail budget'
  );

  const now = new Date().toISOString();
  const lines = [];
  for (let i = 0; i < 40; i += 1) {
    lines.push(JSON.stringify({
      timestamp: now,
      signal: i % 2 === 0 ? 'down' : 'up',
      context: `training example ${i}`,
    }));
  }
  fs.writeFileSync(path.join(dir, 'feedback-log.jsonl'), `${lines.join('\n')}\n`);

  const { model } = learner.trainAndPersistInterventionPolicy(dir);
  assert.ok(model.trainingWindow, 'the persisted model must record its training window');
  assert.equal(model.trainingWindow.maxBytes, learner.TRAINING_TAIL_BYTES);
  assert.equal(model.trainingWindow.complete, true, 'a small log must train on complete history');
  assert.deepEqual(model.trainingWindow.truncatedSources, []);
});

test('a truncated training read is reported, not silently dropped', (t) => {
  const dir = makeTempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const now = new Date().toISOString();
  const lines = [];
  for (let i = 0; i < 50; i += 1) {
    lines.push(JSON.stringify({ timestamp: now, signal: 'down', context: `entry ${i}` }));
  }
  fs.writeFileSync(path.join(dir, 'feedback-log.jsonl'), `${lines.join('\n')}\n`);

  const learner = require('../scripts/intervention-policy');
  const bounded = learner.buildExamplesFromFeedbackDir(dir, { maxEntries: 5 });
  assert.equal(bounded.readWindow.complete, false, 'a capped read must not claim completeness');
  assert.ok(
    bounded.readWindow.truncatedSources.includes('feedback'),
    'the truncated source must be named'
  );
});

test('telemetry summary does not present a tail read as complete', (t) => {
  const dir = makeTempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const now = new Date().toISOString();
  const lines = [];
  for (let i = 0; i < 500; i += 1) {
    lines.push(JSON.stringify({
      receivedAt: now,
      eventType: 'cta_click',
      clientType: 'web',
      page: `/p/${i}`,
    }));
  }
  fs.writeFileSync(path.join(dir, 'telemetry-pings.jsonl'), `${lines.join('\n')}\n`);

  const telemetry = require('../scripts/telemetry-analytics');

  // Tiny tail budget forces truncation without a multi-megabyte fixture.
  const truncated = telemetry.getTelemetrySummary(dir, { window: '7d', telemetryTailBytes: 512 });
  assert.equal(truncated.window.truncated, true, 'truncation must be surfaced on the window');
  assert.equal(truncated.window.complete, false);
  assert.equal(truncated.telemetrySource.truncated, true);
  assert.ok(truncated.telemetrySource.truncatedPaths.length > 0, 'the truncated file must be named');

  // The same log read whole must report completeness honestly.
  const whole = telemetry.getTelemetrySummary(dir, { window: 'lifetime' });
  assert.equal(whole.window.window, 'lifetime');
  assert.equal(whole.window.complete, true);
  assert.equal(whole.window.truncated, false);
});

test('an oversized telemetry log is never labelled complete lifetime', (t) => {
  const dir = makeTempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  writeOversizedJsonl(path.join(dir, 'telemetry-pings.jsonl'), {
    receivedAt: new Date().toISOString(),
    eventType: 'cta_click',
    clientType: 'web',
  });

  const telemetry = require('../scripts/telemetry-analytics');
  // Unbounded window: readTextTail()'s hard ceiling still tail-caps this read.
  const summary = telemetry.getTelemetrySummary(dir, { window: 'lifetime' });
  assert.equal(summary.window.window, 'lifetime');
  assert.equal(
    summary.window.complete,
    false,
    'a >64 MiB log is read as a tail, so lifetime counts are partial'
  );
  assert.equal(summary.window.truncated, true);
});
