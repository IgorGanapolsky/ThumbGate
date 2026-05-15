'use strict';

/**
 * Integration tests for GET /v1/telemetry/export — the operator-key-gated
 * endpoint that exposes recent telemetry-pings + funnel-events ledgers so
 * CI can join CTA-click attribution into the unified revenue rollup.
 *
 * Tests use a temporary feedback dir and pre-seed both ledgers so we don't
 * depend on a live server's accumulated data. Auth, time-window filtering,
 * source selection, and truncation are all exercised here.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-export-'));
const savedEnv = {};
const ENV = {
  _TEST_API_KEYS_PATH: path.join(tmpRoot, 'api-keys.json'),
  _TEST_FUNNEL_LEDGER_PATH: path.join(tmpRoot, 'funnel-events.jsonl'),
  _TEST_REVENUE_LEDGER_PATH: path.join(tmpRoot, 'revenue-events.jsonl'),
  _TEST_LOCAL_CHECKOUT_SESSIONS_PATH: path.join(tmpRoot, 'local-checkout-sessions.json'),
  THUMBGATE_FEEDBACK_DIR: path.join(tmpRoot, 'feedback'),
  THUMBGATE_API_KEY: 'admin-key-for-telemetry-export-test',
  THUMBGATE_OPERATOR_KEY: 'operator-key-for-telemetry-export-test',
  STRIPE_SECRET_KEY: '',
};
for (const [k, v] of Object.entries(ENV)) {
  savedEnv[k] = process.env[k];
  process.env[k] = v;
}
fs.mkdirSync(ENV.THUMBGATE_FEEDBACK_DIR, { recursive: true });

// Seed a telemetry-pings.jsonl with three rows: one well outside the window,
// two inside.
const NOW_MS = Date.now();
const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * ONE_HOUR;

const telemetryRows = [
  { eventType: 'page_view', path: '/', timestamp: new Date(NOW_MS - 3 * ONE_DAY).toISOString() }, // outside 24h
  { eventType: 'cta_clicked', ctaId: 'pricing_pro', path: '/pricing', timestamp: new Date(NOW_MS - 2 * ONE_HOUR).toISOString() }, // inside
  { eventType: 'cta_clicked', ctaId: 'workflow_sprint_intake', path: '/', timestamp: new Date(NOW_MS - 30 * 60 * 1000).toISOString() }, // inside
];
fs.writeFileSync(
  path.join(ENV.THUMBGATE_FEEDBACK_DIR, 'telemetry-pings.jsonl'),
  telemetryRows.map((r) => JSON.stringify(r)).join('\n') + '\n'
);

// Seed funnel-events.jsonl on the canonical billing path (matches the
// _TEST_FUNNEL_LEDGER_PATH override above).
const funnelRows = [
  { stage: 'discovery', event: 'landing_view', timestamp: new Date(NOW_MS - 4 * ONE_DAY).toISOString() }, // outside
  { stage: 'discovery', event: 'landing_view', timestamp: new Date(NOW_MS - 1 * ONE_HOUR).toISOString() }, // inside
];
fs.writeFileSync(
  ENV._TEST_FUNNEL_LEDGER_PATH,
  funnelRows.map((r) => JSON.stringify(r)).join('\n') + '\n'
);

const { startServer } = require('../src/api/server');

let handle;
let origin = '';

async function get(p, headers = {}) {
  return fetch(`${origin}${p}`, { headers });
}

describe('GET /v1/telemetry/export', () => {
  before(async () => {
    handle = await startServer({ port: 0, host: '127.0.0.1' });
    origin = `http://127.0.0.1:${handle.port}`;
  });

  after(async () => {
    if (handle) handle.server.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await get('/v1/telemetry/export');
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.match(body.error, /operator or admin key/i);
  });

  it('rejects requests with a wrong token with 401', async () => {
    const res = await get('/v1/telemetry/export', { Authorization: 'Bearer not-the-right-key' });
    assert.equal(res.status, 401);
  });

  it('returns 503 when neither THUMBGATE_API_KEY nor THUMBGATE_OPERATOR_KEY is configured (dev-mode lock)', async () => {
    // Codex P2 regression guard: an unconfigured dev/preview server must
    // not silently fall through to public reads of the raw telemetry
    // ledger. Spin up a second server instance with both keys cleared
    // and confirm it refuses with 503 + a helpful diagnostic.
    const savedAdmin = process.env.THUMBGATE_API_KEY;
    const savedOperator = process.env.THUMBGATE_OPERATOR_KEY;
    const savedAllow = process.env.THUMBGATE_ALLOW_INSECURE;
    delete process.env.THUMBGATE_API_KEY;
    delete process.env.THUMBGATE_OPERATOR_KEY;
    // The server normally refuses to boot without THUMBGATE_API_KEY. Dev
    // mode opts into that explicitly via THUMBGATE_ALLOW_INSECURE=true —
    // and THAT is the scenario the strict-auth check defends against.
    process.env.THUMBGATE_ALLOW_INSECURE = 'true';
    let altHandle;
    let altOrigin = '';
    try {
      altHandle = await startServer({ port: 0, host: '127.0.0.1' });
      altOrigin = `http://127.0.0.1:${altHandle.port}`;
      const res = await fetch(`${altOrigin}/v1/telemetry/export`);
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.match(body.error, /Telemetry export disabled/);
      assert.match(body.error, /THUMBGATE_API_KEY/);
      assert.match(body.error, /THUMBGATE_OPERATOR_KEY/);
    } finally {
      if (altHandle) altHandle.server.close();
      if (savedAdmin !== undefined) process.env.THUMBGATE_API_KEY = savedAdmin;
      if (savedOperator !== undefined) process.env.THUMBGATE_OPERATOR_KEY = savedOperator;
      if (savedAllow === undefined) delete process.env.THUMBGATE_ALLOW_INSECURE;
      else process.env.THUMBGATE_ALLOW_INSECURE = savedAllow;
    }
  });

  it('accepts the operator key and returns both telemetry + funnel rows within the default 24h window', async () => {
    const res = await get('/v1/telemetry/export', { Authorization: `Bearer ${ENV.THUMBGATE_OPERATOR_KEY}` });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.source, 'both');
    assert.equal(body.limit, 1000);
    // Two telemetry rows are inside the 24h window; the 3-day-old one is out.
    assert.equal(body.telemetry.rows.length, 2);
    assert.equal(body.telemetry.totalAfterSince, 2);
    assert.equal(body.telemetry.truncated, false);
    // One funnel row inside the window.
    assert.equal(body.funnel.rows.length, 1);
    assert.equal(body.funnel.totalAfterSince, 1);
  });

  it('accepts the admin key as an alternate auth path', async () => {
    const res = await get('/v1/telemetry/export', { Authorization: `Bearer ${ENV.THUMBGATE_API_KEY}` });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.telemetry);
    assert.ok(body.funnel);
  });

  it('source=telemetry returns only the telemetry stream', async () => {
    const res = await get('/v1/telemetry/export?source=telemetry', { Authorization: `Bearer ${ENV.THUMBGATE_OPERATOR_KEY}` });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.source, 'telemetry');
    assert.equal(body.telemetry.rows.length, 2);
    assert.equal(body.funnel.rows.length, 0);
    assert.equal(body.funnel.totalAfterSince, 0);
  });

  it('source=funnel returns only the funnel stream', async () => {
    const res = await get('/v1/telemetry/export?source=funnel', { Authorization: `Bearer ${ENV.THUMBGATE_OPERATOR_KEY}` });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.source, 'funnel');
    assert.equal(body.telemetry.rows.length, 0);
    assert.equal(body.funnel.rows.length, 1);
  });

  it('honors the since query parameter for ISO8601 timestamps', async () => {
    const sinceIso = new Date(NOW_MS - 5 * ONE_DAY).toISOString();
    const res = await get(`/v1/telemetry/export?since=${encodeURIComponent(sinceIso)}`, {
      Authorization: `Bearer ${ENV.THUMBGATE_OPERATOR_KEY}`,
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    // Expanding the window to 5 days picks up all 3 telemetry rows and both funnel rows.
    assert.equal(body.telemetry.rows.length, 3);
    assert.equal(body.funnel.rows.length, 2);
  });

  it('falls back to the default 24h window when since is not a valid ISO8601 string', async () => {
    const res = await get('/v1/telemetry/export?since=banana', {
      Authorization: `Bearer ${ENV.THUMBGATE_OPERATOR_KEY}`,
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    // Default 24h window, same as the no-param call.
    assert.equal(body.telemetry.rows.length, 2);
  });

  it('truncates to limit and reports truncated=true with totalAfterSince intact', async () => {
    const res = await get('/v1/telemetry/export?limit=1', {
      Authorization: `Bearer ${ENV.THUMBGATE_OPERATOR_KEY}`,
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.limit, 1);
    assert.equal(body.telemetry.rows.length, 1);
    assert.equal(body.telemetry.totalAfterSince, 2);
    assert.equal(body.telemetry.truncated, true);
    // Keeps the MOST RECENT row when truncating (slice(-limit)).
    const keptCta = body.telemetry.rows[0].ctaId;
    assert.equal(keptCta, 'workflow_sprint_intake');
  });

  it('clamps limit to the 10000 hard cap', async () => {
    const res = await get('/v1/telemetry/export?limit=999999', {
      Authorization: `Bearer ${ENV.THUMBGATE_OPERATOR_KEY}`,
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.limit, 10000);
  });

  it('falls back to default 1000 limit on negative or non-numeric input', async () => {
    const res = await get('/v1/telemetry/export?limit=-5', {
      Authorization: `Bearer ${ENV.THUMBGATE_OPERATOR_KEY}`,
    });
    const body = await res.json();
    assert.equal(body.limit, 1000);
  });

  it('returns a stable schema (rows / truncated / totalAfterSince) for both streams', async () => {
    const res = await get('/v1/telemetry/export', { Authorization: `Bearer ${ENV.THUMBGATE_OPERATOR_KEY}` });
    const body = await res.json();
    for (const key of ['telemetry', 'funnel']) {
      assert.ok(Array.isArray(body[key].rows), `${key}.rows must be an array`);
      assert.equal(typeof body[key].truncated, 'boolean');
      assert.equal(typeof body[key].totalAfterSince, 'number');
    }
    assert.ok(body.generatedAt);
    assert.ok(body.since);
  });
});
