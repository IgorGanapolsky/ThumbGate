'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

// ── Isolated server with BOTH admin key AND operator key configured ─────────
// This verifies that the operator key can bypass the general isAuthorized gate
// when THUMBGATE_API_KEY is set alongside THUMBGATE_OPERATOR_KEY.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-opkey-auth-'));

const savedEnv = {};
const TEST_VARS = {
  THUMBGATE_API_KEY: 'admin-key-for-test',
  THUMBGATE_OPERATOR_KEY: 'tg_op_test_operatorkey9876543210',
  THUMBGATE_FEEDBACK_DIR: tmpDir,
  _TEST_API_KEYS_PATH: path.join(tmpDir, 'api-keys.json'),
  _TEST_FUNNEL_LEDGER_PATH: path.join(tmpDir, 'funnel-events.jsonl'),
  _TEST_REVENUE_LEDGER_PATH: path.join(tmpDir, 'revenue-events.jsonl'),
  _TEST_LOCAL_CHECKOUT_SESSIONS_PATH: path.join(tmpDir, 'local-checkout-sessions.json'),
  THUMBGATE_PROOF_DIR: tmpDir,
  THUMBGATE_BILLING_API_BASE_URL: 'https://billing.example.com',
  STRIPE_SECRET_KEY: '',
  STRIPE_PRICE_ID: '',
  THUMBGATE_BUILD_METADATA_PATH: path.join(tmpDir, 'build-metadata.json'),
};

for (const [k, v] of Object.entries(TEST_VARS)) {
  savedEnv[k] = process.env[k];
  process.env[k] = v;
}

fs.writeFileSync(
  TEST_VARS.THUMBGATE_BUILD_METADATA_PATH,
  JSON.stringify({ buildSha: 'test-opkey-sha', generatedAt: '2026-04-01T00:00:00.000Z' })
);

const { startServer } = require('../src/api/server');

let handle;
let origin = '';

describe('operator key auth', () => {
  before(async () => {
    handle = await startServer({ port: 0, host: '127.0.0.1' });
    origin = `http://127.0.0.1:${handle.port}`;
  });

  after(async () => {
    if (handle) handle.server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('operator key reaches /v1/billing/summary when admin key is also set', async () => {
    const res = await fetch(`${origin}/v1/billing/summary`, {
      headers: { authorization: `Bearer ${TEST_VARS.THUMBGATE_OPERATOR_KEY}` },
    });
    // Should be 200, not 401 (general gate) or 403 (endpoint gate)
    assert.equal(res.status, 200);
  });

  it('admin key still works for /v1/billing/summary', async () => {
    const res = await fetch(`${origin}/v1/billing/summary`, {
      headers: { authorization: `Bearer ${TEST_VARS.THUMBGATE_API_KEY}` },
    });
    assert.equal(res.status, 200);
  });

  it('unknown key is rejected by general gate with 401', async () => {
    const res = await fetch(`${origin}/v1/billing/summary`, {
      headers: { authorization: 'Bearer wrong-key' },
    });
    assert.equal(res.status, 401);
  });

  it('operator key is rejected for non-billing endpoints', async () => {
    // Operator key should NOT bypass the general gate for other endpoints
    const res = await fetch(`${origin}/v1/lessons`, {
      headers: { authorization: `Bearer ${TEST_VARS.THUMBGATE_OPERATOR_KEY}` },
    });
    // 401 from general gate (operator key not valid for non-billing paths)
    assert.equal(res.status, 401);
  });
});
