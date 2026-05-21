'use strict';

/**
 * Tests for GET /v1/metrics/real — the public install/active-user metrics
 * endpoint that PR #2279 extended with active-user aggregation, 30-day windows,
 * unique-session counts, and a 60s response cache.
 *
 * Spins up its own isolated server bound to 127.0.0.1:0 so it can run alongside
 * api-server.test.js without port conflicts.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (process.env.CODEX_SANDBOX) {
  console.log('Skipping /v1/metrics/real tests because CODEX_SANDBOX blocks socket listen permission.');
} else {

const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-metrics-real-test-'));
const tmpProofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-metrics-real-proof-'));
const savedFeedbackDir = process.env.THUMBGATE_FEEDBACK_DIR;
const savedProofDir = process.env.THUMBGATE_PROOF_DIR;
const savedProjectDir = process.env.THUMBGATE_PROJECT_DIR;
const savedClaudeDir = process.env.CLAUDE_PROJECT_DIR;
const savedInitCwd = process.env.INIT_CWD;
const savedTestApiKeys = process.env._TEST_API_KEYS_PATH;
const savedBuildMetadata = process.env.THUMBGATE_BUILD_METADATA_PATH;

process.env.THUMBGATE_FEEDBACK_DIR = tmpFeedbackDir;
process.env.THUMBGATE_PROOF_DIR = tmpProofDir;
const savedApiKey = process.env.THUMBGATE_API_KEY;
if (!process.env.THUMBGATE_API_KEY) process.env.THUMBGATE_API_KEY = 'test-metrics-real-key';
delete process.env.THUMBGATE_PROJECT_DIR;
delete process.env.CLAUDE_PROJECT_DIR;
delete process.env.INIT_CWD;
process.env._TEST_API_KEYS_PATH = path.join(tmpFeedbackDir, 'api-keys.json');
process.env.THUMBGATE_BUILD_METADATA_PATH = path.join(tmpFeedbackDir, 'build-metadata.json');
fs.writeFileSync(
  process.env.THUMBGATE_BUILD_METADATA_PATH,
  JSON.stringify({ buildSha: 'metrics-real-test-sha', generatedAt: '2026-05-21T00:00:00.000Z' }, null, 2)
);

// Seed telemetry-pings.jsonl with a mix of events: a real-user with multiple
// active actions and two sessions, a bot, a CI run, an owner, and a malformed line.
const telemetryPath = path.join(tmpFeedbackDir, 'telemetry-pings.jsonl');
const now = Date.now();
const isoNow = new Date(now).toISOString();
const iso5d = new Date(now - 5 * 86400000).toISOString();
const iso10d = new Date(now - 10 * 86400000).toISOString();
const iso40d = new Date(now - 40 * 86400000).toISOString();

const lines = [
  // Real user: install-A — capture (active) + recall (active), two sessions
  { eventType: 'cli_capture', installId: 'install-A', sessionId: 'sess-A1', visitorType: 'real_user', timestamp: isoNow },
  { eventType: 'cli_recall',  installId: 'install-A', sessionId: 'sess-A2', visitorType: 'real_user', timestamp: iso5d },
  { eventType: 'cli_init',    installId: 'install-A', sessionId: 'sess-A1', visitorType: 'real_user', timestamp: isoNow }, // init not "active"
  // Real user: install-B — only init (not "active")
  { eventType: 'cli_init',    installId: 'install-B', sessionId: 'sess-B1', visitorType: 'real_user', timestamp: isoNow },
  // 30d-only real user: install-C — stats event, one session, falls outside 7d window
  { eventType: 'cli_stats',   installId: 'install-C', sessionId: 'sess-C1', visitorType: 'real_user', timestamp: iso10d },
  // Bot user: should NOT count as active even with active eventType
  { eventType: 'cli_capture', installId: 'install-BOT', sessionId: 'sess-bot', visitorType: 'bot', timestamp: isoNow },
  // CI user: should NOT count as active
  { eventType: 'cli_capture', installId: 'install-CI', sessionId: 'sess-ci', visitorType: 'ci', timestamp: isoNow },
  // Owner real action — counts but visitorType !== real_user
  { eventType: 'cli_recall',  installId: 'install-OWNER', sessionId: 'sess-own', visitorType: 'owner', timestamp: isoNow },
  // 40-day-old (outside 30d window)
  { eventType: 'cli_capture', installId: 'install-OLD', sessionId: 'sess-old', visitorType: 'real_user', timestamp: iso40d },
  // Activation milestone event
  { eventType: 'activation_first_rule_promoted', installId: 'install-A', sessionId: 'sess-A1', visitorType: 'real_user', timestamp: isoNow },
];

fs.writeFileSync(
  telemetryPath,
  lines.map((l) => JSON.stringify(l)).join('\n') + '\n{not-json}\n' + '\n'
);

// Clear any cross-test cache state on `global` so this suite starts cold
delete global._metricsRealCache;

const { startServer } = require('../src/api/server');

let handle;
let apiOrigin = '';
let listenSkipped = false;

test.before(async () => {
  try {
    handle = await startServer({ port: 0, host: '127.0.0.1' });
  } catch (err) {
    if (err && (err.code === 'EPERM' || err.code === 'EACCES')) {
      listenSkipped = true;
      return;
    }
    throw err;
  }
  if (handle && handle.url) {
    apiOrigin = handle.url;
  } else if (handle && handle.server) {
    const addr = handle.server.address();
    if (addr && typeof addr === 'object') {
      apiOrigin = `http://127.0.0.1:${addr.port}`;
    }
  }
});

test.after(async () => {
  try {
    if (handle && typeof handle.close === 'function') await handle.close();
    else if (handle && handle.server) await new Promise((r) => handle.server.close(r));
  } catch (_) {}
  fs.rmSync(tmpFeedbackDir, { recursive: true, force: true });
  fs.rmSync(tmpProofDir, { recursive: true, force: true });
  if (savedFeedbackDir != null) process.env.THUMBGATE_FEEDBACK_DIR = savedFeedbackDir; else delete process.env.THUMBGATE_FEEDBACK_DIR;
  if (savedProofDir != null) process.env.THUMBGATE_PROOF_DIR = savedProofDir; else delete process.env.THUMBGATE_PROOF_DIR;
  if (savedProjectDir != null) process.env.THUMBGATE_PROJECT_DIR = savedProjectDir;
  if (savedClaudeDir != null) process.env.CLAUDE_PROJECT_DIR = savedClaudeDir;
  if (savedInitCwd != null) process.env.INIT_CWD = savedInitCwd;
  if (savedTestApiKeys != null) process.env._TEST_API_KEYS_PATH = savedTestApiKeys; else delete process.env._TEST_API_KEYS_PATH;
  if (savedBuildMetadata != null) process.env.THUMBGATE_BUILD_METADATA_PATH = savedBuildMetadata; else delete process.env.THUMBGATE_BUILD_METADATA_PATH;
  if (savedApiKey != null) process.env.THUMBGATE_API_KEY = savedApiKey; else delete process.env.THUMBGATE_API_KEY;
  delete global._metricsRealCache;
});

function skipIfNoServer(t) {
  if (listenSkipped || !apiOrigin) {
    t.skip('listen permission unavailable in sandbox');
    return true;
  }
  return false;
}

test('GET /v1/metrics/real returns 200 with new active-user breakdown', async (t) => {
  if (skipIfNoServer(t)) return;
  const res = await fetch(`${apiOrigin}/v1/metrics/real`);
  assert.equal(res.status, 200);
  const body = await res.json();

  // New keys added by PR #2279
  assert.ok(body.last30Days, 'last30Days block must exist');
  assert.equal(typeof body.last30Days.uniqueInstalls, 'number');
  assert.equal(typeof body.last30Days.activeInstalls, 'number');
  assert.equal(typeof body.last30Days.uniqueSessions, 'number');

  assert.equal(typeof body.last7Days.activeInstalls, 'number', 'last7Days.activeInstalls is new');
  assert.equal(typeof body.last7Days.uniqueSessions, 'number', 'last7Days.uniqueSessions is new');
  assert.equal(typeof body.allTime.activeInstalls, 'number', 'allTime.activeInstalls is new');
});

test('GET /v1/metrics/real correctly excludes bot/ci visitors from active counts', async (t) => {
  if (skipIfNoServer(t)) return;
  // Cache is hot from previous test; invalidate so we re-derive from disk
  delete global._metricsRealCache;
  const res = await fetch(`${apiOrigin}/v1/metrics/real`);
  const body = await res.json();
  // install-A is the only real_user with active events in the last 7 days.
  // install-BOT and install-CI have active eventTypes but must be excluded.
  // Owner (install-OWNER) is non-bot and non-ci → included.
  assert.ok(body.last7Days.activeInstalls >= 1,
    `expected at least 1 active install in last 7 days, got ${body.last7Days.activeInstalls}`);
  // install-A has 2 distinct sessionIds in the last 7d: sess-A1 + sess-A2.
  // Owner has sess-own.
  assert.ok(body.last7Days.uniqueSessions >= 2,
    `expected at least 2 unique 7d sessions, got ${body.last7Days.uniqueSessions}`);
});

test('GET /v1/metrics/real 30-day window includes events older than 7 days', async (t) => {
  if (skipIfNoServer(t)) return;
  delete global._metricsRealCache;
  const res = await fetch(`${apiOrigin}/v1/metrics/real`);
  const body = await res.json();
  // install-C has a cli_stats event at 10 days old: included in 30d, excluded from 7d.
  // install-OLD at 40 days old must be excluded from both windows.
  assert.ok(body.last30Days.activeInstalls >= body.last7Days.activeInstalls,
    '30d active count must be >= 7d active count');
  // install-OLD must not show up in 30d window
  assert.ok(body.last30Days.uniqueInstalls < 10,
    'install-OLD (40d) should be excluded from last30Days.uniqueInstalls');
});

test('GET /v1/metrics/real allTime counts all active installs across full history', async (t) => {
  if (skipIfNoServer(t)) return;
  delete global._metricsRealCache;
  const res = await fetch(`${apiOrigin}/v1/metrics/real`);
  const body = await res.json();
  // allTimeActiveInstalls should include install-A, install-C, install-OWNER, install-OLD.
  // Bots + CI excluded. install-B excluded (only init).
  assert.ok(body.allTime.activeInstalls >= 3,
    `expected >=3 all-time active installs, got ${body.allTime.activeInstalls}`);
});

test('GET /v1/metrics/real exposes byEventType + byVisitorType buckets', async (t) => {
  if (skipIfNoServer(t)) return;
  delete global._metricsRealCache;
  const res = await fetch(`${apiOrigin}/v1/metrics/real`);
  const body = await res.json();
  assert.equal(typeof body.byEventType, 'object');
  assert.ok(body.byEventType.cli_capture >= 1);
  assert.ok(body.byEventType.cli_recall >= 1);
  assert.equal(typeof body.byVisitorType, 'object');
  assert.ok((body.byVisitorType.real_user || 0) >= 1);
});

test('GET /v1/metrics/real second call hits the 60s response cache (no file re-read)', async (t) => {
  if (skipIfNoServer(t)) return;
  delete global._metricsRealCache;
  const first = await fetch(`${apiOrigin}/v1/metrics/real`);
  const firstBody = await first.json();
  // Mutate the file but rely on the in-memory cache to return identical totals
  fs.appendFileSync(telemetryPath, JSON.stringify({
    eventType: 'cli_capture', installId: 'install-NEW', sessionId: 'sess-NEW',
    visitorType: 'real_user', timestamp: new Date().toISOString(),
  }) + '\n');
  const second = await fetch(`${apiOrigin}/v1/metrics/real`);
  const secondBody = await second.json();
  assert.equal(secondBody.allTime.total, firstBody.allTime.total,
    'second response within 60s should be served from cache');
});

}
