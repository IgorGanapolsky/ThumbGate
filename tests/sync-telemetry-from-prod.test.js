'use strict';

/**
 * Unit tests for scripts/sync-telemetry-from-prod.js.
 *
 * Fully hermetic: no network (fetchImpl is injected), no secrets (a fake key is
 * passed via env + configPath points at a temp file), and all writes go to a
 * temp feedback dir. Exercises canonical dedupe, response-shape tolerance, auth
 * header correctness, opt-in funnel sync, and idempotency across repeat runs.
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sync = require('../scripts/sync-telemetry-from-prod');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-telemetry-'));
const MISSING_CONFIG = path.join(tmpRoot, 'no-such-operator.json');
const savedEnv = {};

function countLines(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  return fs.readFileSync(filePath, 'utf8').split('\n').filter((l) => l.trim()).length;
}

// A fake fetch that records the request and returns a canned export payload.
function makeFetch(payload, { ok = true, status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: new URL(url), init });
    return {
      ok,
      status,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

const SAMPLE_PAYLOAD = {
  generatedAt: '2026-06-11T00:00:00.000Z',
  since: '2026-05-12T00:00:00.000Z',
  source: 'both',
  telemetry: {
    rows: [
      { eventType: 'landing_page_view', path: '/', visitorId: 'v1', sessionId: 's1', timestamp: '2026-06-10T10:00:00.000Z' },
      { eventType: 'cta_clicked', ctaId: 'pricing_pro', path: '/pricing', visitorId: 'v2', sessionId: 's2', timestamp: '2026-06-10T11:00:00.000Z' },
    ],
    truncated: false,
    totalAfterSince: 2,
  },
  funnel: {
    rows: [
      { stage: 'discovery', event: 'landing_view', timestamp: '2026-06-10T10:00:00.000Z' },
    ],
    truncated: false,
    totalAfterSince: 1,
  },
  journeySummary: { sessionCount: 2, stageCounts: { landing: 2 }, dropoffCounts: {}, journeys: [] },
};

describe('sync-telemetry-from-prod', () => {
  before(() => {
    for (const k of ['THUMBGATE_OPERATOR_KEY', 'THUMBGATE_API_KEY', 'THUMBGATE_SYNC_BASE_URL', 'THUMBGATE_BILLING_API_BASE_URL']) {
      savedEnv[k] = process.env[k];
    }
  });

  after(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    delete process.env.THUMBGATE_API_KEY;
    delete process.env.THUMBGATE_SYNC_BASE_URL;
    delete process.env.THUMBGATE_BILLING_API_BASE_URL;
    process.env.THUMBGATE_OPERATOR_KEY = 'fake-operator-key-for-tests';
  });

  describe('canonicalize / stableRowId', () => {
    it('is independent of key order', () => {
      const a = { b: 2, a: 1, nested: { y: 1, x: 2 } };
      const b = { a: 1, nested: { x: 2, y: 1 }, b: 2 };
      assert.equal(sync.stableRowId(a), sync.stableRowId(b));
    });

    it('differs for different content and is a sha256 hex digest', () => {
      const id = sync.stableRowId({ a: 1 });
      assert.notEqual(id, sync.stableRowId({ a: 2 }));
      assert.match(id, /^[0-9a-f]{64}$/);
    });
  });

  describe('extractRows', () => {
    it('accepts the { rows: [...] } shape', () => {
      assert.equal(sync.extractRows({ rows: [1, 2, 3] }).length, 3);
    });
    it('accepts a bare array', () => {
      assert.equal(sync.extractRows([1, 2]).length, 2);
    });
    it('returns [] for null/undefined/garbage', () => {
      assert.deepEqual(sync.extractRows(null), []);
      assert.deepEqual(sync.extractRows(undefined), []);
      assert.deepEqual(sync.extractRows({ nope: true }), []);
    });
  });

  describe('mergeRowsIntoLedger', () => {
    it('appends new rows and dedupes on repeat, skipping non-objects', () => {
      const file = path.join(tmpRoot, 'merge', 'telemetry-pings.jsonl');
      const rows = [{ a: 1 }, { b: 2 }, 'not-an-object', null];
      const first = sync.mergeRowsIntoLedger(file, rows);
      assert.equal(first.added, 2);
      assert.equal(first.skipped, 2);
      assert.equal(countLines(file), 2);
      // Repeat run: the two objects already exist → 0 added.
      const second = sync.mergeRowsIntoLedger(file, rows);
      assert.equal(second.added, 0);
      assert.equal(countLines(file), 2);
    });

    it('honors dry-run (no write)', () => {
      const file = path.join(tmpRoot, 'dry', 'telemetry-pings.jsonl');
      const res = sync.mergeRowsIntoLedger(file, [{ a: 1 }], { dryRun: true });
      assert.equal(res.added, 1);
      assert.equal(fs.existsSync(file), false);
    });
  });

  describe('resolveOperatorConfig', () => {
    it('prefers THUMBGATE_OPERATOR_KEY and records its source without leaking the value', () => {
      const cfg = sync.resolveOperatorConfig({ configPath: MISSING_CONFIG, baseUrl: 'https://example.test' });
      assert.equal(cfg.keySource, 'env:THUMBGATE_OPERATOR_KEY');
      assert.equal(cfg.baseUrl, 'https://example.test');
      assert.ok(cfg.apiKey);
    });

    it('falls back to THUMBGATE_API_KEY when no operator key is present', () => {
      delete process.env.THUMBGATE_OPERATOR_KEY;
      process.env.THUMBGATE_API_KEY = 'fake-admin-key';
      const cfg = sync.resolveOperatorConfig({ configPath: MISSING_CONFIG });
      assert.equal(cfg.keySource, 'env:THUMBGATE_API_KEY');
      assert.equal(cfg.baseUrl, sync.DEFAULT_BASE_URL);
    });

    it('returns no key when none configured', () => {
      delete process.env.THUMBGATE_OPERATOR_KEY;
      const cfg = sync.resolveOperatorConfig({ configPath: MISSING_CONFIG });
      assert.equal(cfg.apiKey, null);
      assert.equal(cfg.keySource, null);
    });
  });

  describe('fetchTelemetryExport', () => {
    it('builds the URL, sends a Bearer token, and parses JSON', async () => {
      const fetchImpl = makeFetch(SAMPLE_PAYLOAD);
      const body = await sync.fetchTelemetryExport({
        baseUrl: 'https://prod.test',
        operatorKey: 'k',
        since: '2026-05-12T00:00:00.000Z',
        limit: 500,
        source: 'both',
        fetchImpl,
      });
      assert.equal(body.source, 'both');
      const { url, init } = fetchImpl.calls[0];
      assert.equal(url.pathname, '/v1/telemetry/export');
      assert.equal(url.searchParams.get('source'), 'both');
      assert.equal(url.searchParams.get('limit'), '500');
      assert.equal(url.searchParams.get('since'), '2026-05-12T00:00:00.000Z');
      // Auth is Bearer (server reads Authorization/x-api-key, NOT x-operator-key).
      assert.equal(init.headers.authorization, 'Bearer k');
      assert.equal(init.headers['x-operator-key'], undefined);
    });

    it('clamps limit to the hard cap', async () => {
      const fetchImpl = makeFetch(SAMPLE_PAYLOAD);
      await sync.fetchTelemetryExport({ baseUrl: 'https://prod.test', operatorKey: 'k', limit: 999999, fetchImpl });
      assert.equal(fetchImpl.calls[0].url.searchParams.get('limit'), String(sync.HARD_LIMIT));
    });

    it('throws no_key when the key is missing', async () => {
      await assert.rejects(
        () => sync.fetchTelemetryExport({ baseUrl: 'https://prod.test', operatorKey: null, fetchImpl: makeFetch({}) }),
        (e) => e.code === 'no_key'
      );
    });

    it('throws http_error on a non-2xx response', async () => {
      const fetchImpl = makeFetch({ error: 'nope' }, { ok: false, status: 401 });
      await assert.rejects(
        () => sync.fetchTelemetryExport({ baseUrl: 'https://prod.test', operatorKey: 'k', fetchImpl }),
        (e) => e.code === 'http_error' && e.status === 401
      );
    });
  });

  describe('syncTelemetryFromProd (end-to-end, injected fetch)', () => {
    it('merges telemetry only by default, then is idempotent on a repeat run', async () => {
      const feedbackDir = path.join(tmpRoot, 'e2e-default');
      const fetchImpl = makeFetch(SAMPLE_PAYLOAD);
      const first = await sync.syncTelemetryFromProd({ feedbackDir, configPath: MISSING_CONFIG, fetchImpl });
      assert.equal(first.source, 'telemetry'); // funnel off → source telemetry
      assert.equal(first.telemetry.added, 2);
      assert.equal(first.funnel, null);
      assert.equal(countLines(path.join(feedbackDir, 'telemetry-pings.jsonl')), 2);
      // funnel ledger must NOT be written when --funnel is off
      assert.equal(fs.existsSync(path.join(feedbackDir, 'funnel-events.jsonl')), false);

      const second = await sync.syncTelemetryFromProd({ feedbackDir, configPath: MISSING_CONFIG, fetchImpl });
      assert.equal(second.telemetry.added, 0);
      assert.equal(second.telemetry.skipped, 2);
      assert.equal(countLines(path.join(feedbackDir, 'telemetry-pings.jsonl')), 2);
    });

    it('persists funnel rows when funnel:true', async () => {
      const feedbackDir = path.join(tmpRoot, 'e2e-funnel');
      const fetchImpl = makeFetch(SAMPLE_PAYLOAD);
      const res = await sync.syncTelemetryFromProd({ feedbackDir, configPath: MISSING_CONFIG, funnel: true, fetchImpl });
      assert.equal(res.source, 'both');
      assert.equal(res.telemetry.added, 2);
      assert.equal(res.funnel.added, 1);
      assert.equal(countLines(path.join(feedbackDir, 'funnel-events.jsonl')), 1);
    });

    it('never includes the operator key in the returned summary', async () => {
      const feedbackDir = path.join(tmpRoot, 'e2e-nosecret');
      const fetchImpl = makeFetch(SAMPLE_PAYLOAD);
      const res = await sync.syncTelemetryFromProd({ feedbackDir, configPath: MISSING_CONFIG, fetchImpl });
      const serialized = JSON.stringify(res);
      assert.equal(serialized.includes('fake-operator-key-for-tests'), false);
      assert.equal('apiKey' in res, false);
    });

    it('computes a since timestamp from sinceDays relative to nowMs', async () => {
      const feedbackDir = path.join(tmpRoot, 'e2e-since');
      const fetchImpl = makeFetch({ ...SAMPLE_PAYLOAD, since: undefined });
      const nowMs = Date.parse('2026-06-11T00:00:00.000Z');
      await sync.syncTelemetryFromProd({ feedbackDir, configPath: MISSING_CONFIG, sinceDays: 7, nowMs, fetchImpl });
      assert.equal(fetchImpl.calls[0].url.searchParams.get('since'), '2026-06-04T00:00:00.000Z');
    });
  });

  describe('parseArgs', () => {
    it('parses flags and numeric options with sane defaults', () => {
      const opts = sync.parseArgs(['--funnel', '--since-days=14', '--limit=500', '--source=telemetry', '--json', '--dry-run']);
      assert.equal(opts.funnel, true);
      assert.equal(opts.sinceDays, 14);
      assert.equal(opts.limit, 500);
      assert.equal(opts.source, 'telemetry');
      assert.equal(opts.json, true);
      assert.equal(opts.dryRun, true);
    });

    it('defaults sinceDays to 30 and funnel off', () => {
      const opts = sync.parseArgs([]);
      assert.equal(opts.sinceDays, 30);
      assert.equal(opts.funnel, false);
    });

    it('recovers from a non-numeric since-days', () => {
      const opts = sync.parseArgs(['--since-days=banana']);
      assert.equal(opts.sinceDays, 30);
    });
  });
});
