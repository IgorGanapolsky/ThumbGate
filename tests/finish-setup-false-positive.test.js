'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

test('computeTodayOverview hides Finish setup for Pro, first_block, and unknown signal, and shows it for brand-new Free', () => {
  const { computeTodayOverview } = require('../scripts/dashboard');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-finish-setup-unit-'));
  const empty = { gateStats: { totalGates: 1, blocked: 0, warned: 0 }, gateAudit: { days: [{ deny: 0, warn: 0, allow: 0 }] } };
  try {
    const free = computeTodayOverview(tmpDir, { ...empty, tier: 'Free', setupSignalKnown: true });
    assert.equal(free.firstBlockRecorded, false);
    assert.equal(free.upNext.kind, 'finish_setup');
    const pro = computeTodayOverview(tmpDir, { ...empty, tier: 'Pro', setupSignalKnown: true });
    assert.equal(pro.firstBlockRecorded, true);
    assert.equal(pro.upNext, null);
    const blocked = computeTodayOverview(tmpDir, { ...empty, tier: 'Free', firstBlockAt: '2026-11-12T18:00:00.000Z', setupSignalKnown: true });
    assert.equal(blocked.upNext, null);
    const unknown = computeTodayOverview(tmpDir, { ...empty, setupSignalKnown: false });
    assert.equal(unknown.upNext, null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('hosted session: Pro with zero blocks has no bar, first_block hides the Free bar, unknown session returns null', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-finish-setup-api-'));
  const prev = {
    THUMBGATE_FEEDBACK_DIR: process.env.THUMBGATE_FEEDBACK_DIR,
    THUMBGATE_API_KEY: process.env.THUMBGATE_API_KEY,
    _TEST_API_KEYS_PATH: process.env._TEST_API_KEYS_PATH,
    _TEST_FUNNEL_LEDGER_PATH: process.env._TEST_FUNNEL_LEDGER_PATH,
  };
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  process.env.THUMBGATE_API_KEY = 'tg_admin_test_setup_secret_key_12345';
  process.env._TEST_API_KEYS_PATH = path.join(tmpDir, 'api-keys.json');
  process.env._TEST_FUNNEL_LEDGER_PATH = path.join(tmpDir, 'funnel-events.jsonl');
  const { provisionApiKey } = require('../scripts/billing');
  const { startServer } = require('../src/api/server');
  const pro = provisionApiKey('cus_pro_zero_1', { customerEmail: 'pro-zero@example.com', plan: 'pro', tier: 'Pro', entitlementKind: 'subscription' });
  const free = provisionApiKey('cus_free_new_1', { customerEmail: 'brand-new-free@example.com', plan: 'free', tier: 'Free' });
  const handle = await startServer({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${handle.port}`;
  try {
    const anon = await fetch(`${base}/v1/auth/session`).then((r) => r.json());
    assert.equal(anon.firstBlockRecorded, null);
    assert.equal(anon.upNext, null);
    const login = await fetch(`${base}/v1/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: pro.key }),
    });
    const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    const proSession = await fetch(`${base}/v1/auth/session`, { headers: { Cookie: cookie } }).then((r) => r.json());
    assert.equal(proSession.tier, 'Pro');
    assert.equal(proSession.firstBlockRecorded, true);
    assert.equal(proSession.upNext, null);
    const before = await fetch(`${base}/v1/feedback/stats`, { headers: { Authorization: `Bearer ${free.key}` } }).then((r) => r.json());
    assert.equal(before.todayOverview.firstBlockRecorded, false);
    assert.equal(before.todayOverview.upNext.kind, 'finish_setup');
    const activated = await fetch(`${base}/v1/activation/first-block`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${free.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstBlockAt: new Date().toISOString(), installId: 'inst_free_1' }),
    });
    assert.equal(activated.status, 200);
    const after = await fetch(`${base}/v1/feedback/stats`, { headers: { Authorization: `Bearer ${free.key}` } }).then((r) => r.json());
    assert.equal(after.todayOverview.firstBlockRecorded, true);
    assert.equal(after.todayOverview.upNext, null);
  } finally {
    await new Promise((resolve) => handle.server.close(resolve));
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
