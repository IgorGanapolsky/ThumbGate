'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function jsonRequest(baseUrl, reqPath, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(`${baseUrl}${reqPath}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie') || '';
  const data = await res.json();
  return { status: res.status, setCookie, data };
}

test('computeTodayOverview treats Pro/Team, first_block, and CLI heartbeat as set up, hides when signal unknown, and shows bar for brand-new Free', () => {
  const { computeTodayOverview } = require('../scripts/dashboard');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-finish-setup-unit-'));
  try {
    // 1. Brand-new Free account with no blocks, no activation, no heartbeat -> shows bar
    const brandNewFree = computeTodayOverview(tmpDir, {
      tier: 'Free',
      setupSignalKnown: true,
      gateStats: { totalGates: 12, blocked: 0, warned: 0 },
      gateAudit: { days: [{ dayKey: '2026-11-12', deny: 0, warn: 0, allow: 0 }] },
    });
    assert.equal(brandNewFree.firstBlockRecorded, false);
    assert.equal(brandNewFree.upNext?.kind, 'finish_setup');

    // 2. Signed-in Pro with zero hosted blocks -> no bar
    const proZeroBlocks = computeTodayOverview(tmpDir, {
      tier: 'Pro',
      setupSignalKnown: true,
      gateStats: { totalGates: 12, blocked: 0, warned: 0 },
      gateAudit: { days: [{ dayKey: '2026-11-12', deny: 0, warn: 0, allow: 0 }] },
    });
    assert.equal(proZeroBlocks.firstBlockRecorded, true);
    assert.equal(proZeroBlocks.upNext, null);

    // 3. Signed-in Team with zero hosted blocks -> no bar
    const teamZeroBlocks = computeTodayOverview(tmpDir, {
      tier: 'Team',
      setupSignalKnown: true,
      gateStats: { totalGates: 12, blocked: 0, warned: 0 },
      gateAudit: { days: [{ dayKey: '2026-11-12', deny: 0, warn: 0, allow: 0 }] },
    });
    assert.equal(teamZeroBlocks.firstBlockRecorded, true);
    assert.equal(teamZeroBlocks.upNext, null);

    // 4. Free account with recorded firstBlockAt or CLI heartbeat -> no bar
    const freeWithFirstBlock = computeTodayOverview(tmpDir, {
      tier: 'Free',
      firstBlockAt: '2026-11-12T18:00:00.000Z',
      setupSignalKnown: true,
      gateStats: { totalGates: 12, blocked: 0, warned: 0 },
    });
    assert.equal(freeWithFirstBlock.firstBlockRecorded, true);
    assert.equal(freeWithFirstBlock.firstBlockAt, '2026-11-12T18:00:00.000Z');
    assert.equal(freeWithFirstBlock.upNext, null);

    const freeWithHeartbeat = computeTodayOverview(tmpDir, {
      tier: 'Free',
      cliHeartbeat: true,
      setupSignalKnown: true,
      gateStats: { totalGates: 12, blocked: 0, warned: 0 },
    });
    assert.equal(freeWithHeartbeat.firstBlockRecorded, true);
    assert.equal(freeWithHeartbeat.upNext, null);

    // 5. Hosted server has no signal either way -> show nothing rather than a wrong prompt
    const unknownSignal = computeTodayOverview(tmpDir, {
      setupSignalKnown: false,
      gateStats: { totalGates: 12, blocked: 0, warned: 0 },
    });
    assert.equal(unknownSignal.upNext, null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('dashboard.html renderUpNext shows bar ONLY when firstBlockRecorded === false and upNext object exists', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.html'), 'utf8');
  const startIdx = html.indexOf('var DEFAULT_FINISH_SETUP_BAR =');
  const endIdx = html.indexOf('function renderLessonStorageFooter');
  assert.ok(startIdx > 0 && endIdx > startIdx, 'renderUpNext snippet must exist in dashboard.html');
  const snippet = html.slice(startIdx, endIdx);

  function makeEl(display = 'none') {
    const attrs = new Map([['hidden', '']]);
    return {
      style: { display },
      textContent: '',
      onclick: null,
      setAttribute(k, v) { attrs.set(k, v); },
      removeAttribute(k) { attrs.delete(k); },
      hasAttribute(k) { return attrs.has(k); },
      getAttribute(k) { return attrs.get(k); },
    };
  }

  const els = {
    finishSetupWrap: makeEl('none'),
    upNextCard: makeEl('none'),
    upNextKicker: makeEl('block'),
    upNextTitle: makeEl('block'),
    upNextDetail: makeEl('block'),
    upNextActionBtn: makeEl('block'),
  };
  const ctx = vm.createContext({
    document: { getElementById: (id) => els[id] || null },
    switchTab: () => {},
  });
  vm.runInContext(snippet, ctx);

  // Unknown signal (null / undefined) -> stays hidden even if an upNext object were passed
  ctx.renderUpNext(ctx.DEFAULT_FINISH_SETUP_BAR, null);
  assert.equal(els.finishSetupWrap.style.display, 'none');
  assert.equal(els.upNextCard.style.display, 'none');

  ctx.renderUpNext(ctx.DEFAULT_FINISH_SETUP_BAR, undefined);
  assert.equal(els.finishSetupWrap.style.display, 'none');

  // Brand-new Free account (firstBlockRecorded === false + upNext object) -> shown
  ctx.renderUpNext(ctx.DEFAULT_FINISH_SETUP_BAR, false);
  assert.equal(els.finishSetupWrap.style.display, 'block');
  assert.equal(els.upNextCard.style.display, 'flex');
  assert.equal(els.upNextCard.hasAttribute('hidden'), false);

  // Pro or first_block recorded (firstBlockRecorded === true) -> hidden
  ctx.renderUpNext(null, true);
  assert.equal(els.finishSetupWrap.style.display, 'none');
  assert.equal(els.upNextCard.style.display, 'none');
  assert.equal(els.upNextCard.hasAttribute('hidden'), true);
});

test('hosted API end-to-end: Pro zero-blocks hides bar, CLI first_block event persists firstBlockAt once and hides bar, telemetry backfill covers Igor & CLI installs, brand-new Free shows bar', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-finish-setup-api-'));
  const cliStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-cli-state-'));
  const prevEnv = {
    THUMBGATE_FEEDBACK_DIR: process.env.THUMBGATE_FEEDBACK_DIR,
    THUMBGATE_API_KEY: process.env.THUMBGATE_API_KEY,
    _TEST_API_KEYS_PATH: process.env._TEST_API_KEYS_PATH,
    _TEST_FUNNEL_LEDGER_PATH: process.env._TEST_FUNNEL_LEDGER_PATH,
  };
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  process.env.THUMBGATE_API_KEY = 'tg_admin_test_setup_secret_key_12345';
  process.env._TEST_API_KEYS_PATH = path.join(tmpDir, 'api-keys.json');
  process.env._TEST_FUNNEL_LEDGER_PATH = path.join(tmpDir, 'funnel-events.jsonl');

  // Seed telemetry-pings.jsonl + marketing-install-emails.jsonl BEFORE server boot to verify backfill
  fs.writeFileSync(
    path.join(tmpDir, 'telemetry-pings.jsonl'),
    `${JSON.stringify({ eventType: 'cli_heartbeat', clientType: 'cli', installId: 'inst_existing_cli_1', timestamp: '2026-11-10T12:00:00.000Z', visitorType: 'real_user' })}\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(tmpDir, 'marketing-install-emails.jsonl'),
    `${JSON.stringify({ email: 'cli-tele-user@example.com', installId: 'inst_existing_cli_1', capturedAt: '2026-11-10T12:01:00.000Z' })}\n`,
    'utf8',
  );

  const { provisionApiKey, validateApiKey } = require('../scripts/billing');
  const { reportFirstBlockActivation } = require('../scripts/activation-tracker');
  const { startServer } = require('../src/api/server');

  const proProvisioned = provisionApiKey('cus_pro_zero_1', {
    customerEmail: 'pro-zero@example.com',
    plan: 'pro',
    tier: 'Pro',
    entitlementKind: 'subscription',
    subscriptionId: 'sub_pro_zero_1',
  });
  const freeBrandNew = provisionApiKey('cus_free_new_1', {
    customerEmail: 'brand-new-free@example.com',
    plan: 'free',
    tier: 'Free',
  });
  const freeCliTele = provisionApiKey('cus_free_tele_1', {
    customerEmail: 'cli-tele-user@example.com',
    plan: 'free',
    tier: 'Free',
    installId: 'inst_existing_cli_1',
  });
  const igorFreeKey = provisionApiKey('cus_igor_owner_1', {
    customerEmail: 'iganapolsky@gmail.com',
    plan: 'free',
    tier: 'Free',
  });

  const serverHandle = await startServer({ port: 0, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${serverHandle.port}`;

  try {
    // A. Unauthenticated /v1/auth/session -> no signal either way, returns null (never shows bar)
    const anonSession = await jsonRequest(baseUrl, '/v1/auth/session');
    assert.equal(anonSession.status, 200);
    assert.equal(anonSession.data.authenticated, false);
    assert.equal(anonSession.data.firstBlockRecorded, null);
    assert.equal(anonSession.data.upNext, null);

    // B. Signed-in Pro with 0 hosted blocks -> no bar on both /v1/auth/session and /v1/feedback/stats
    const proLogin = await jsonRequest(baseUrl, '/v1/auth/session', {
      method: 'POST',
      body: { apiKey: proProvisioned.key },
    });
    assert.equal(proLogin.status, 200);
    const proCookie = proLogin.setCookie.split(';')[0];

    const proSession = await jsonRequest(baseUrl, '/v1/auth/session', {
      headers: { Cookie: proCookie },
    });
    assert.equal(proSession.data.tier, 'Pro');
    assert.equal(proSession.data.firstBlockRecorded, true);
    assert.equal(proSession.data.upNext, null);

    const proStats = await jsonRequest(baseUrl, '/v1/feedback/stats', {
      headers: { Cookie: proCookie },
    });
    assert.equal(proStats.status, 200);
    assert.equal(proStats.data.tier, 'Pro');
    assert.equal(proStats.data.todayOverview.firstBlockRecorded, true);
    assert.equal(proStats.data.todayOverview.upNext, null);

    // C. Backfilled Igor account & backfilled telemetry CLI install -> no bar even with 0 hosted blocks
    const igorStats = await jsonRequest(baseUrl, '/v1/feedback/stats', {
      headers: { Authorization: `Bearer ${igorFreeKey.key}` },
    });
    assert.equal(igorStats.data.todayOverview.firstBlockRecorded, true);
    assert.equal(igorStats.data.todayOverview.upNext, null);
    assert.ok(igorStats.data.todayOverview.firstBlockAt, 'Igor account must have backfilled firstBlockAt');

    const teleStats = await jsonRequest(baseUrl, '/v1/feedback/stats', {
      headers: { Authorization: `Bearer ${freeCliTele.key}` },
    });
    assert.equal(teleStats.data.todayOverview.firstBlockRecorded, true);
    assert.equal(teleStats.data.todayOverview.upNext, null);
    assert.ok(teleStats.data.todayOverview.firstBlockAt, 'telemetry CLI install must backfill a firstBlockAt');

    // D. Brand-new Free account with no signal -> shows Finish setup bar (even after /v1/feedback/stats increments usageCount)
    const freeBefore = await jsonRequest(baseUrl, '/v1/feedback/stats', {
      headers: { Authorization: `Bearer ${freeBrandNew.key}` },
    });
    assert.equal(freeBefore.status, 200);
    assert.equal(freeBefore.data.tier, 'Free');
    assert.equal(freeBefore.data.todayOverview.firstBlockRecorded, false);
    assert.equal(freeBefore.data.todayOverview.upNext?.kind, 'finish_setup');

    // D2. /v1/dashboard ALSO keeps Finish setup bar visible for brand-new Free account (no hardcoded pro override)
    const freeDashBefore = await jsonRequest(baseUrl, '/v1/dashboard', {
      headers: { Authorization: `Bearer ${freeBrandNew.key}` },
    });
    assert.equal(freeDashBefore.status, 200);
    assert.equal(freeDashBefore.data.tier, 'Free');
    assert.equal(freeDashBefore.data.todayOverview.firstBlockRecorded, false);
    assert.equal(freeDashBefore.data.todayOverview.upNext?.kind, 'finish_setup');

    // E. Security: read-only operator key cannot spoof another customer's email/customerId, and Free user cannot spoof another tenant's installId
    const attackerFree = provisionApiKey('cus_attacker_free_1', {
      customerEmail: 'attacker@example.com',
      plan: 'free',
      tier: 'Free',
    });
    const spoofAttempt = await jsonRequest(baseUrl, '/v1/activation/first-block', {
      method: 'POST',
      headers: { Authorization: `Bearer ${attackerFree.key}` },
      body: {
        installId: 'inst_existing_cli_1',
        email: 'brand-new-free@example.com',
        customerId: 'cus_free_new_1',
        firstBlockAt: '1970-01-01T00:00:00.000Z',
      },
    });
    assert.equal(spoofAttempt.status, 200);
    assert.equal(validateApiKey(freeBrandNew.key).firstBlockAt, null, 'victim key must not be mutated by cross-tenant spoof');
    assert.notEqual(validateApiKey(attackerFree.key).firstBlockAt, '1970-01-01T00:00:00.000Z', 'epoch backdate must be bounded');

    // F. Upstream 500 does NOT stamp firstBlockReportedAt, allowing subsequent retry to succeed once
    const blockStamp = new Date().toISOString();
    let activationHits = 0;
    let failNext = true;
    const proxy = http.createServer(async (req, res) => {
      activationHits += 1;
      if (failNext) {
        failNext = false;
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'bad_gateway' }));
        return;
      }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const upstream = await fetch(`${baseUrl}${req.url}`, {
        method: req.method,
        headers: {
          'Content-Type': req.headers['content-type'] || 'application/json',
          ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
        },
        body: Buffer.concat(chunks),
      });
      res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
      res.end(await upstream.text());
    });
    const proxyUrl = await listen(proxy);
    try {
      const failedAttempt = await reportFirstBlockActivation({
        apiKey: freeBrandNew.key,
        apiBaseUrl: proxyUrl,
        stateDir: cliStateDir,
        installId: 'inst_brand_new_cli_1',
        firstBlockAt: blockStamp,
        gateId: 'gate:rm-rf',
        awaitDelivery: true,
      });
      assert.equal(failedAttempt.reported, false);
      assert.equal(activationHits, 1);

      // Retry succeeds and stamps firstBlockReportedAt
      const firstReport = await reportFirstBlockActivation({
        apiKey: freeBrandNew.key,
        apiBaseUrl: proxyUrl,
        stateDir: cliStateDir,
        installId: 'inst_brand_new_cli_1',
        firstBlockAt: blockStamp,
        gateId: 'gate:rm-rf',
        awaitDelivery: true,
      });
      assert.equal(firstReport.reported, true);
      assert.equal(activationHits, 2);

      // Third call is an idempotent local no-op (one-time report)
      const secondReport = await reportFirstBlockActivation({
        apiKey: freeBrandNew.key,
        apiBaseUrl: proxyUrl,
        stateDir: cliStateDir,
        installId: 'inst_brand_new_cli_1',
        gateId: 'gate:rm-rf',
        awaitDelivery: true,
      });
      assert.equal(secondReport.reported, false);
      assert.equal(secondReport.alreadyReported, true);
      assert.equal(activationHits, 2);
    } finally {
      await closeServer(proxy);
    }

    const updatedValidation = validateApiKey(freeBrandNew.key);
    assert.equal(updatedValidation.firstBlockAt, blockStamp);

    const freeAfter = await jsonRequest(baseUrl, '/v1/feedback/stats', {
      headers: { Authorization: `Bearer ${freeBrandNew.key}` },
    });
    assert.equal(freeAfter.data.todayOverview.firstBlockRecorded, true);
    assert.equal(freeAfter.data.todayOverview.firstBlockAt, blockStamp);
    assert.equal(freeAfter.data.todayOverview.upNext, null);

    // G. Detached PreToolUse CLI hook worker survives immediate process.exit(0) in parent hook process
    const detachedFree = provisionApiKey('cus_detached_cli_1', {
      customerEmail: 'detached-cli@example.com',
      plan: 'free',
      tier: 'Free',
    });
    const detachedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-detached-cli-'));
    try {
      const { spawnSync } = require('node:child_process');
      const trackerPath = path.join(__dirname, '..', 'scripts', 'activation-tracker.js');
      const childRes = spawnSync(
        process.execPath,
        ['-e', `const { reportFirstBlockActivation } = require(${JSON.stringify(trackerPath)}); reportFirstBlockActivation({ apiKey: process.env.TEST_KEY, apiBaseUrl: process.env.TEST_URL, stateDir: process.env.TEST_DIR, gateId: 'gate:force-push' }); process.exit(0);`],
        {
          env: {
            ...process.env,
            NODE_TEST_CONTEXT: '',
            NODE_ENV: 'production',
            TEST_KEY: detachedFree.key,
            TEST_URL: baseUrl,
            TEST_DIR: detachedDir,
          },
        },
      );
      assert.equal(childRes.status, 0);
      let delivered = false;
      for (let i = 0; i < 30; i += 1) {
        if (validateApiKey(detachedFree.key).firstBlockAt) {
          delivered = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.equal(delivered, true, 'detached first_block worker must deliver to API even when parent hook calls process.exit(0)');
    } finally {
      fs.rmSync(detachedDir, { recursive: true, force: true });
    }

    // H. Key lifecycle: Free -> Pro subscription upgrade updates tier, and rotateApiKey preserves plan/tier/firstBlockAt
    const { rotateApiKey } = require('../scripts/billing');
    const rotatedFree = rotateApiKey(freeBrandNew.key);
    assert.equal(rotatedFree.rotated, true);
    const rotatedVal = validateApiKey(rotatedFree.key);
    assert.equal(rotatedVal.plan, 'free');
    assert.equal(rotatedVal.firstBlockAt, blockStamp);
    provisionApiKey('cus_free_new_1', {
      customerEmail: 'brand-new-free@example.com',
      entitlementKind: 'subscription',
      subscriptionId: 'sub_upgraded_1',
    });
    assert.equal(validateApiKey(rotatedFree.key).plan, 'pro');

    // I. Feedback-only activation-recorded.json ({ at, feedbackId, signal }) does NOT masquerade as a gate block
    const { computeTodayOverview } = require('../scripts/dashboard');
    const fbOnlyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-fb-only-marker-'));
    try {
      fs.writeFileSync(path.join(fbOnlyDir, 'activation-recorded.json'), JSON.stringify({ at: new Date().toISOString(), feedbackId: 'fb_1', signal: 'negative' }));
      const fbOv = computeTodayOverview(fbOnlyDir, { tier: 'Free', setupSignalKnown: true, gateStats: { totalGates: 10, blocked: 0, warned: 0 } });
      assert.equal(fbOv.firstBlockRecorded, false);
      assert.equal(fbOv.upNext?.kind, 'finish_setup');
    } finally {
      fs.rmSync(fbOnlyDir, { recursive: true, force: true });
    }
  } finally {
    if (serverHandle?.server) await closeServer(serverHandle.server);
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(cliStateDir, { recursive: true, force: true });
  }
});
