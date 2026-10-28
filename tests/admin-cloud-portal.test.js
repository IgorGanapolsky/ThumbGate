'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApiServer } = require('../src/api/server');

async function startTestServer(envOverrides = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-admin-portal-test-'));
  const prevEnv = {};
  const nextEnv = {
    THUMBGATE_API_KEY: 'test-admin-secret-key-999',
    THUMBGATE_OPERATOR_KEY: 'test-operator-key-888',
    THUMBGATE_DIALOGFLOW_WEBHOOK_SECRET: 'test-df-webhook-secret-777',
    THUMBGATE_FEEDBACK_DIR: tmpDir,
    _TEST_DISABLE_UPSTREAM_BRIDGE: '1',
    _TEST_DISABLE_GCP_METADATA: '1',
    ...envOverrides,
  };

  for (const [k, v] of Object.entries(nextEnv)) {
    prevEnv[k] = process.env[k];
    process.env[k] = v;
  }

  // Seed sample signup and paid order in tmpDir
  fs.writeFileSync(
    path.join(tmpDir, 'funnel-events.jsonl'),
    `${JSON.stringify({
      timestamp: '2026-10-28T15:00:00.000Z',
      stage: 'acquisition',
      event: 'checkout_session_created',
      email: 'founder@acme.dev',
      metadata: { email: 'founder@acme.dev', utmCampaign: 'pro_pack', utmSource: 'website' },
    })}\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(tmpDir, 'revenue-events.jsonl'),
    `${JSON.stringify({
      timestamp: '2026-10-28T15:05:00.000Z',
      status: 'paid',
      provider: 'stripe',
      event: 'checkout.session.completed',
      orderId: 'py_test_149',
      customerId: 'cus_test_acme',
      customerEmail: 'founder@acme.dev',
      amountCents: 14900,
      currency: 'USD',
      amountKnown: true,
    })}\n`,
    'utf8'
  );

  const server = createApiServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const close = async () => {
    await new Promise((resolve) => server.close(resolve));
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  };

  return { baseUrl, close, tmpDir };
}

test('Unauthenticated GET /admin renders server-side login gate and never leaks customer or profit data', async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const res = await fetch(`${baseUrl}/admin`);
    assert.equal(res.status, 401);
    const html = await res.text();
    assert.match(html, /ThumbGate Executive Admin/);
    assert.match(html, /action="\/admin\/login"/);
    assert.doesNotMatch(html, /cus_test_acme/);
    assert.doesNotMatch(html, /founder@acme\.dev/);
    assert.doesNotMatch(html, /admin-initial-state/);

    const realtimeRes = await fetch(`${baseUrl}/v1/admin/realtime`);
    assert.equal(realtimeRes.status, 401);

    const dfRes = await fetch(`${baseUrl}/v1/admin/dialogflow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'What are our profits?' }),
    });
    assert.equal(dfRes.status, 401);
  } finally {
    await close();
  }
});

test('POST /admin/login sets HttpOnly session cookie and unlocks real-time sign-ups, accounts, profits, and Dialogflow', async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const badLogin = await fetch(`${baseUrl}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'iganapolsky@gmail.com', apiKey: 'wrong-key' }),
    });
    assert.equal(badLogin.status, 401);

    const goodLogin = await fetch(`${baseUrl}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        email: 'iganapolsky@gmail.com',
        apiKey: 'test-admin-secret-key-999',
      }).toString(),
      redirect: 'manual',
    });
    assert.equal(goodLogin.status, 303);
    assert.equal(goodLogin.headers.get('location'), '/admin');
    const setCookie = goodLogin.headers.get('set-cookie') || '';
    assert.match(setCookie, /tg_admin_session=/);
    assert.match(setCookie, /HttpOnly/);
    const cookiePair = setCookie.split(';')[0];

    const portalRes = await fetch(`${baseUrl}/admin`, {
      headers: { Cookie: cookiePair },
    });
    assert.equal(portalRes.status, 200);
    const portalHtml = await portalRes.text();
    assert.match(portalHtml, /ThumbGate Google Cloud Admin &amp; Dialogflow Command Center/);
    assert.match(portalHtml, /Google Cloud Dialogflow Copilot/);
    assert.match(portalHtml, /cus_test_acme/);
    assert.match(portalHtml, /founder@acme\.dev/);
    assert.match(portalHtml, /\$390\.00/);

    const rtRes = await fetch(`${baseUrl}/v1/admin/realtime`, {
      headers: { Cookie: cookiePair },
    });
    assert.equal(rtRes.status, 200);
    const snap = await rtRes.json();
    assert.equal(snap.cloud.outOfPocketSpendCents, 0);
    assert.equal(snap.cloud.ultraCreditsAvailableDisplay, '$390.00');
    assert.ok(snap.customers.some((c) => c.customerId === 'cus_test_acme'));
    assert.ok(snap.signups.feed.some((s) => s.email === 'founder@acme.dev'));

    // Ask Dialogflow about profits
    const dfProfitRes = await fetch(`${baseUrl}/v1/admin/dialogflow`, {
      method: 'POST',
      headers: {
        Cookie: cookiePair,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: 'What are our net profits and Stripe fees?' }),
    });
    assert.equal(dfProfitRes.status, 200);
    const dfProfit = await dfProfitRes.json();
    assert.equal(dfProfit.ok, true);
    assert.equal(dfProfit.intent, 'admin.profits');
    assert.match(dfProfit.answer, /Net Profit is/);

    // Webhook fulfillment endpoint for Google Cloud Dialogflow ES/CX
    const webhookRes = await fetch(`${baseUrl}/v1/admin/dialogflow-webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-thumbgate-dialogflow-secret': 'test-df-webhook-secret-777',
      },
      body: JSON.stringify({
        queryResult: {
          queryText: 'Show all sign-ups in real-time',
          intent: { displayName: 'admin.signups' },
        },
      }),
    });
    assert.equal(webhookRes.status, 200);
    const webhookData = await webhookRes.json();
    assert.match(webhookData.fulfillmentText, /Real-Time Sign-Ups:/);
    assert.equal(webhookData.payload.intent, 'admin.signups');

    // 7. Ask Dialogflow about Herdr MoE Swarm & LLM-as-Judge
    const swarmRes = await fetch(`${baseUrl}/v1/admin/dialogflow`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookiePair,
      },
      body: JSON.stringify({ query: 'How is our Herdr MoE Swarm, SOW, and LLM-as-Judge performing?' }),
    });
    assert.equal(swarmRes.status, 200);
    const swarmData = await swarmRes.json();
    assert.equal(swarmData.ok, true);
    assert.equal(swarmData.intent, 'admin.herdr_swarm');
    assert.match(swarmData.answer, /Herdr 2x2 MoE Swarm SOW/);
    assert.match(swarmData.answer, /Broadcast Prompt Deduplication/);

    // 8. 1-Click SSO (Google, Apple, GitHub) signs in and redirects with HttpOnly session cookie
    for (const provider of ['google', 'apple', 'github']) {
      const ssoRes = await fetch(`${baseUrl}/admin/sso/${provider}?redirect=/dashboard`, {
        redirect: 'manual',
      });
      assert.equal(ssoRes.status, 303);
      assert.equal(ssoRes.headers.get('location'), '/dashboard');
      const ssoSetCookie = ssoRes.headers.get('set-cookie');
      assert.ok(ssoSetCookie && ssoSetCookie.includes('tg_admin_session='));
      const ssoCookiePair = ssoSetCookie.split(';')[0];

      const authedPortal = await fetch(`${baseUrl}/admin`, {
        headers: { Cookie: ssoCookiePair },
      });
      assert.equal(authedPortal.status, 200);
      const authedHtml = await authedPortal.text();
      assert.match(authedHtml, /Google SSO|Apple ID SSO|GitHub SSO/);
    }

    // 9. Dialogflow answers time-windowed and analytical questions distinctly and never repeats itself
    const askDf = async (query, sessionId = 'test-session-distinct') => {
      const res = await fetch(`${baseUrl}/v1/admin/dialogflow`, {
        method: 'POST',
        headers: { Cookie: cookiePair, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, sessionId }),
      });
      assert.equal(res.status, 200);
      return res.json();
    };

    const lastWeekAns = await askDf('how much money we made in the last week?');
    assert.equal(lastWeekAns.subIntent, 'profits_last_7d');
    assert.equal(lastWeekAns.timeWindow, 'last_7d');
    assert.match(lastWeekAns.answer, /In last 7 days \(last week\), we made/i);
    assert.notEqual(lastWeekAns.answer, dfProfit.answer);

    const whenSaleAns = await askDf('when was our last sale?');
    assert.equal(whenSaleAns.subIntent, 'latest_order_timing');
    assert.match(whenSaleAns.answer, /Our most recent paid sale was on/);
    assert.notEqual(whenSaleAns.answer, lastWeekAns.answer);

    const whyDropAns = await askDf('why didn\'t the other leads buy?');
    assert.equal(whyDropAns.subIntent, 'why_drop_off');
    assert.match(whyDropAns.answer, /Lead-to-Paid Conversion Rate/);
    assert.notEqual(whyDropAns.answer, whenSaleAns.answer);

    // Asking the exact same question a second time in the same session appends a granular drill-down
    const repeatLastWeekAns = await askDf('how much money we made in the last week?', 'test-session-distinct');
    assert.notEqual(repeatLastWeekAns.answer, lastWeekAns.answer);
    assert.match(repeatLastWeekAns.answer, /Granular Ledger Drill-Down/);

    // 10. Ask Dialogflow about Nanbeige4.3-33B architectural steal (preserve_thinking + 33B->3B distillation)
    const nanbeigeAns = await askDf('How did we steal Nanbeige4.3-33B preserve_thinking and 33B->3B distillation?');
    assert.equal(nanbeigeAns.intent, 'admin.herdr_swarm');
    assert.equal(nanbeigeAns.subIntent, 'nanbeige_agentic_steal');
    assert.match(nanbeigeAns.answer, /Nanbeige4\.3-33B Architectural Steal is LIVE/);
    assert.match(nanbeigeAns.answer, /preserve_thinking=true/);
    assert.match(nanbeigeAns.answer, /33B Teacher -> 3B Student Distillation/);
  } finally {
    await close();
  }
});

test('Herdr MoE Swarm deduplicates identical broadcast prompts across agents and ranks candidates via LLM-as-Judge', () => {
  const {
    generateSwarmSow,
    evaluateSwarmCandidatesWithJudge,
    distillTeacherTrajectoryToStudentGate,
  } = require('../src/herdr-moe-swarm');
  const tmpSwarmDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-herdr-swarm-test-'));
  try {
    const broadcastPrompt = 'new SOWs for our project work: multiple agents coordinating in a swarm inside of herdr with LLM-as-Judge and Mixture-of-Experts';

    const sow1 = generateSwarmSow({
      prompt: broadcastPrompt,
      callingAgent: 'omp',
      workspaceId: 'w3',
      stateDir: tmpSwarmDir,
    });
    assert.equal(sow1.deduplicationStatus, 'ELECTED_PRIMARY_SOW_ROUTER');
    assert.equal(sow1.assignedSeatId, 'architect@herdr');
    assert.ok(sow1.tokenEfficiency.tokenSavingsPct >= 70);
    assert.equal(sow1.nanbeigeSteal.activePolicy.preserve_thinking, true);
    assert.equal(sow1.nanbeigeSteal.activePolicy.enable_thinking, true);
    assert.equal(sow1.nanbeigeSteal.maxContextTokens, 524288);

    const sow2 = generateSwarmSow({
      prompt: broadcastPrompt,
      callingAgent: 'antigravity',
      workspaceId: 'w3',
      stateDir: tmpSwarmDir,
    });
    assert.equal(sow2.sowId, sow1.sowId);
    assert.equal(sow2.deduplicationStatus, 'JOINED_EXISTING_SWARM_SOW');
    assert.equal(sow2.assignedSeatId, 'builder@herdr');

    const sow3 = generateSwarmSow({
      prompt: broadcastPrompt,
      callingAgent: 'gemini',
      workspaceId: 'w3',
      stateDir: tmpSwarmDir,
    });
    assert.equal(sow3.sowId, sow1.sowId);
    assert.equal(sow3.assignedSeatId, 'verifier@herdr');

    const evaluation = evaluateSwarmCandidatesWithJudge([
      {
        agent: 'antigravity',
        seatId: 'builder@herdr',
        tokensUsed: 3200,
        latencyMs: 1100,
        filesModified: ['src/admin-cloud-portal.js'],
        testsPassed: true,
        output: 'Verified implementation with commit sha and passing test suite.',
      },
      {
        agent: 'unverified-agent',
        seatId: 'verifier@herdr',
        tokensUsed: 9500,
        latencyMs: 4200,
        filesModified: ['tests/broken.test.js'],
        testsPassed: false,
        output: 'Done and shipped.',
      },
    ]);

    assert.equal(evaluation.winner.agent, 'antigravity');
    assert.ok(evaluation.winner.finalScore > evaluation.rankings[1].finalScore);

    const distilled = distillTeacherTrajectoryToStudentGate(evaluation, broadcastPrompt);
    assert.equal(distilled.distilled, true);
    assert.equal(distilled.studentTarget, 'thumbgate-local-3b-gate');
    assert.equal(distilled.teacherAgent, 'antigravity');
  } finally {
    fs.rmSync(tmpSwarmDir, { recursive: true, force: true });
  }
});

