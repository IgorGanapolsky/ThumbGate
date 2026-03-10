const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-api-test-'));
process.env.RLHF_FEEDBACK_DIR = tmpFeedbackDir;
process.env.RLHF_API_KEY = 'test-api-key';
process.env._TEST_API_KEYS_PATH = path.join(tmpFeedbackDir, 'api-keys.json');
process.env._TEST_FUNNEL_LEDGER_PATH = path.join(tmpFeedbackDir, 'funnel-events.jsonl');
process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH = path.join(tmpFeedbackDir, 'local-checkout-sessions.json');

// Force local mode for billing tests by clearing Stripe keys
process.env.STRIPE_SECRET_KEY = '';
process.env.STRIPE_PRICE_ID = '';

const { startServer } = require('../src/api/server');
const { provisionApiKey } = require('../scripts/billing');

let handle;
const authHeader = { authorization: 'Bearer test-api-key' };

test.before(async () => {
  handle = await startServer({ port: 8790 });
});

test.after(async () => {
  await new Promise((resolve) => handle.server.close(resolve));
  try {
    fs.rmSync(tmpFeedbackDir, { recursive: true, force: true });
  } catch (err) {
    // Ignore ENOTEMPTY errors during teardown
  }
});

test('health endpoint returns ok', async () => {
  const res = await fetch('http://localhost:8790/healthz', { headers: authHeader });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
});

test('root serves the landing page by default', async () => {
  const res = await fetch('http://localhost:8790/');
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/html/);

  const body = await res.text();
  assert.match(body, /Cloud Pro/);
  assert.match(body, /North Star/);
  assert.match(body, /<section id='faq'>/);
  assert.match(body, /Answer the buyer questions before they stall the deal\./);
  assert.match(body, /GO_TO_MARKET_REVENUE_WEDGE_2026-03\.md/);
  assert.match(body, /proof\/compatibility\/report\.json/);
  assert.match(body, /proof\/automation\/report\.json/);
  assert.match(body, /\/v1\/billing\/checkout/);
});

test('root still serves JSON status when explicitly requested', async () => {
  const res = await fetch('http://localhost:8790/?format=json', {
    headers: { accept: 'application/json' },
  });
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /application\/json/);

  const body = await res.json();
  assert.equal(body.name, 'rlhf-feedback-loop');
  assert.equal(body.status, 'ok');
});

test('success page serves hosted onboarding shell', async () => {
  const res = await fetch('http://localhost:8790/success');
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/html/);

  const body = await res.text();
  assert.match(body, /Your hosted API key is ready\./);
  assert.match(body, /\/v1\/billing\/session\?sessionId=/);
});

test('cancel page serves retry message', async () => {
  const res = await fetch('http://localhost:8790/cancel');
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/html/);

  const body = await res.text();
  assert.match(body, /Checkout cancelled\./);
  assert.match(body, /Return to Cloud Pro/);
});

test('feedback capture accepts valid payload', async () => {
  const res = await fetch('http://localhost:8790/v1/feedback/capture', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({
      signal: 'down',
      context: 'Claimed fixed with no test output',
      whatWentWrong: 'No evidence',
      whatToChange: 'Run tests before completion claim',
      tags: ['verification', 'testing'],
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.accepted, true);
  assert.ok(body.memoryRecord);
});

test('feedback capture blocks positive memory promotion when rubric guardrail fails', async () => {
  const res = await fetch('http://localhost:8790/v1/feedback/capture', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({
      signal: 'up',
      context: 'Looks correct',
      whatWorked: 'No evidence attached',
      rubricScores: [
        { criterion: 'verification_evidence', score: 5, judge: 'judge-a' },
        { criterion: 'verification_evidence', score: 2, judge: 'judge-b', evidence: 'missing test logs' },
      ],
      guardrails: {
        testsPassed: false,
        pathSafety: true,
        budgetCompliant: true,
      },
      tags: ['verification'],
    }),
  });
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.accepted, false);
  assert.match(body.reason, /Rubric gate prevented promotion/);
});

test('feedback capture returns clarification_required for vague positive signal', async () => {
  const res = await fetch('http://localhost:8790/v1/feedback/capture', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({
      signal: 'up',
      context: 'thumbs up',
      tags: ['verification'],
    }),
  });
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.accepted, false);
  assert.equal(body.status, 'clarification_required');
  assert.equal(body.needsClarification, true);
  assert.match(body.prompt, /What specifically worked that should be repeated/);
});

test('intent catalog endpoint returns configured intents', async () => {
  const res = await fetch('http://localhost:8790/v1/intents/catalog?mcpProfile=locked', { headers: authHeader });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.mcpProfile, 'locked');
  assert.ok(Array.isArray(body.intents));
  assert.ok(body.intents.length >= 3);
});

test('intent catalog rejects invalid mcp profile', async () => {
  const res = await fetch('http://localhost:8790/v1/intents/catalog?mcpProfile=bad-profile', {
    headers: authHeader,
  });
  assert.equal(res.status, 400);
});

test('intent plan returns checkpoint for unapproved high-risk action', async () => {
  const res = await fetch('http://localhost:8790/v1/intents/plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({
      intentId: 'publish_dpo_training_data',
      mcpProfile: 'default',
      approved: false,
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'checkpoint_required');
  assert.equal(body.requiresApproval, true);
});

test('summary endpoint returns markdown text payload', async () => {
  const res = await fetch('http://localhost:8790/v1/feedback/summary?recent=10', { headers: authHeader });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.match(body.summary, /Feedback Summary/);
});

test('dpo export endpoint works with local memory log', async () => {
  const outputPath = path.join(tmpFeedbackDir, 'dpo.jsonl');
  const res = await fetch('http://localhost:8790/v1/dpo/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({ outputPath }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(typeof body.pairs === 'number');
  assert.equal(fs.existsSync(outputPath), true);
});

test('context construct/evaluate/provenance endpoints work', async () => {
  const constructRes = await fetch('http://localhost:8790/v1/context/construct', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({
      query: 'verification',
      maxItems: 5,
      maxChars: 4000,
    }),
  });
  assert.equal(constructRes.status, 200);
  const constructBody = await constructRes.json();
  assert.ok(constructBody.packId);

  const evalRes = await fetch('http://localhost:8790/v1/context/evaluate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({
      packId: constructBody.packId,
      outcome: 'useful',
      signal: 'positive',
      notes: 'api test',
      rubricScores: [
        { criterion: 'correctness', score: 4, evidence: 'tests green', judge: 'judge-a' },
        { criterion: 'verification_evidence', score: 4, evidence: 'output attached', judge: 'judge-a' },
      ],
      guardrails: {
        testsPassed: true,
        pathSafety: true,
        budgetCompliant: true,
      },
    }),
  });
  assert.equal(evalRes.status, 200);
  const evalBody = await evalRes.json();
  assert.equal(evalBody.packId, constructBody.packId);
  assert.ok(evalBody.rubricEvaluation);
  assert.equal(typeof evalBody.rubricEvaluation.promotionEligible, 'boolean');

  const provRes = await fetch('http://localhost:8790/v1/context/provenance?limit=5', {
    headers: authHeader,
  });
  assert.equal(provRes.status, 200);
  const provBody = await provRes.json();
  assert.equal(Array.isArray(provBody.events), true);
});

test('context construct rejects invalid namespaces', async () => {
  const res = await fetch('http://localhost:8790/v1/context/construct', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({
      query: 'verification',
      namespaces: ['../../../../tmp'],
    }),
  });
  assert.equal(res.status, 400);
});

test('unauthorized without bearer token', async () => {
  const res = await fetch('http://localhost:8790/v1/feedback/stats');
  assert.equal(res.status, 401);
});

test('billing checkout endpoint is public', async () => {
  const res = await fetch('http://localhost:8790/v1/billing/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      installId: 'inst_public_checkout_test',
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(typeof body.sessionId === 'string');
  assert.equal(body.localMode, true);
});

test('billing session endpoint returns provisioned local checkout details', async () => {
  const checkoutRes = await fetch('http://localhost:8790/v1/billing/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      customerEmail: 'buyer@example.com',
      installId: 'inst_public_checkout_lookup',
    }),
  });
  assert.equal(checkoutRes.status, 200);
  const checkoutBody = await checkoutRes.json();
  assert.ok(typeof checkoutBody.sessionId === 'string');

  const sessionRes = await fetch(
    `http://localhost:8790/v1/billing/session?sessionId=${encodeURIComponent(checkoutBody.sessionId)}`
  );
  assert.equal(sessionRes.status, 200);
  const sessionBody = await sessionRes.json();
  assert.equal(sessionBody.paid, true);
  assert.equal(sessionBody.installId, 'inst_public_checkout_lookup');
  assert.ok(sessionBody.apiKey.startsWith('rlhf_'));
  assert.match(sessionBody.nextSteps.env, /RLHF_API_KEY=/);
  assert.match(sessionBody.nextSteps.curl, /\/v1\/feedback\/capture/);
});

test('billing session endpoint rejects missing session ids', async () => {
  const res = await fetch('http://localhost:8790/v1/billing/session');
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /sessionId/);
});

test('billing provision requires static admin key and rejects billing keys', async () => {
  const billingKey = provisionApiKey('cus_non_admin').key;
  const res = await fetch('http://localhost:8790/v1/billing/provision', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${billingKey}`,
    },
    body: JSON.stringify({ customerId: 'cus_should_fail' }),
  });
  assert.equal(res.status, 403);
});

test('rejects external output path by default', async () => {
  const externalPath = '/tmp/should-not-write-outside-safe-root.jsonl';
  const res = await fetch('http://localhost:8790/v1/dpo/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({ outputPath: externalPath }),
  });
  assert.equal(res.status, 400);
});

test('funnel analytics returns counts and conversion rates', async () => {
  const checkoutRes = await fetch('http://localhost:8790/v1/billing/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({
      installId: 'inst_api_server_test',
    }),
  });
  assert.equal(checkoutRes.status, 200);

  const analyticsRes = await fetch('http://localhost:8790/v1/analytics/funnel', {
    headers: authHeader,
  });
  assert.equal(analyticsRes.status, 200);

  const body = await analyticsRes.json();
  assert.ok(typeof body.totalEvents === 'number');
  assert.ok(typeof body.stageCounts === 'object');
  assert.ok(typeof body.conversionRates === 'object');
  assert.ok(body.stageCounts.acquisition >= 1);
  assert.ok(typeof body.conversionRates.acquisitionToActivation === 'number');
});
