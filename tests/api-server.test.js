const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const tmpFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-api-test-'));
const tmpProofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-api-proof-'));
process.env.RLHF_FEEDBACK_DIR = tmpFeedbackDir;
process.env.RLHF_PROOF_DIR = tmpProofDir;
process.env.RLHF_API_KEY = 'test-api-key';
process.env._TEST_API_KEYS_PATH = path.join(tmpFeedbackDir, 'api-keys.json');
process.env._TEST_FUNNEL_LEDGER_PATH = path.join(tmpFeedbackDir, 'funnel-events.jsonl');
process.env._TEST_REVENUE_LEDGER_PATH = path.join(tmpFeedbackDir, 'revenue-events.jsonl');
process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH = path.join(tmpFeedbackDir, 'local-checkout-sessions.json');

// Force local mode for billing tests by clearing Stripe keys
process.env.STRIPE_SECRET_KEY = '';
process.env.STRIPE_PRICE_ID = '';
process.env.RLHF_PUBLIC_APP_ORIGIN = 'https://app.example.com';
process.env.RLHF_BILLING_API_BASE_URL = 'https://billing.example.com';

const { startServer } = require('../src/api/server');
const billing = require('../scripts/billing');

let handle;
let apiOrigin = '';
const authHeader = { authorization: 'Bearer test-api-key' };

function apiUrl(pathname = '/') {
  return new URL(pathname, apiOrigin).toString();
}

test.before(async () => {
  handle = await startServer({ port: 0 });
  apiOrigin = `http://localhost:${handle.port}`;
});

test.after(async () => {
  await new Promise((resolve) => handle.server.close(resolve));
  delete process.env.RLHF_PUBLIC_APP_ORIGIN;
  delete process.env.RLHF_BILLING_API_BASE_URL;
  try {
    fs.rmSync(tmpFeedbackDir, { recursive: true, force: true });
    fs.rmSync(tmpProofDir, { recursive: true, force: true });
  } catch (err) {
    // Ignore ENOTEMPTY errors during teardown
  }
});

test('health endpoint returns ok', async () => {
  const res = await fetch(apiUrl('/healthz'), { headers: authHeader });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
});

test('root serves the landing page by default', async () => {
  const res = await fetch(apiUrl('/'));
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/html/);

  const body = await res.text();
  assert.match(body, /mcp.memory.gateway/i);
  assert.match(body, /Pre.Action Gates/i);
  assert.match(body, /\$29\/mo/);
  assert.match(body, /plausible\.io\/js\/script\.js/);
  assert.match(body, /\/v1\/billing\/checkout/);
});

test('provisioning endpoint works', async () => {
  const res = await fetch(apiUrl('/v1/billing/provision'), {
    method: 'POST',
    headers: { 
      'content-type': 'application/json',
      authorization: 'Bearer test-api-key' 
    },
    body: JSON.stringify({ customerId: 'cus_api_test' })
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.key.startsWith('rlhf_'));
  
  // Verify isolated path
  assert.equal(billing._API_KEYS_PATH(), path.join(tmpFeedbackDir, 'api-keys.json'));
});

test('root still serves JSON status when explicitly requested', async () => {
  const res = await fetch(apiUrl('/?format=json'), {
    headers: { accept: 'application/json' },
  });
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /application\/json/);

  const body = await res.json();
  assert.equal(body.name, 'mcp-memory-gateway');
  assert.equal(body.status, 'ok');
});

test('success page serves hosted onboarding shell', async () => {
  const res = await fetch(apiUrl('/success'));
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/html/);

  const body = await res.text();
  assert.match(body, /Your hosted API key is ready\./);
  assert.match(body, /const sessionEndpoint = "https:\/\/billing\.example\.com\/v1\/billing\/session";/);
  assert.match(body, /\+ '\?sessionId=' \+ encodeURIComponent\(sessionId\)/);
});

test('cancel page serves retry message', async () => {
  const res = await fetch(apiUrl('/cancel'));
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/html/);

  const body = await res.text();
  assert.match(body, /Checkout cancelled\./);
  assert.match(body, /Return to Context Gateway/);
});

test('feedback capture accepts valid payload', async () => {
  const res = await fetch(apiUrl('/v1/feedback/capture'), {
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
  const res = await fetch(apiUrl('/v1/feedback/capture'), {
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
  const res = await fetch(apiUrl('/v1/feedback/capture'), {
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
  const res = await fetch(apiUrl('/v1/intents/catalog?mcpProfile=locked'), { headers: authHeader });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.mcpProfile, 'locked');
  assert.ok(Array.isArray(body.intents));
  assert.ok(body.intents.length >= 3);
});

test('intent catalog endpoint accepts partner profile', async () => {
  const res = await fetch(apiUrl('/v1/intents/catalog?mcpProfile=default&partnerProfile=strict-reviewer'), { headers: authHeader });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.partnerProfile, 'strict_reviewer');
  assert.equal(body.partnerStrategy.verificationMode, 'evidence_first');
});

test('intent catalog rejects invalid mcp profile', async () => {
  const res = await fetch(apiUrl('/v1/intents/catalog?mcpProfile=bad-profile'), {
    headers: authHeader,
  });
  assert.equal(res.status, 400);
});

test('intent plan returns checkpoint for unapproved high-risk action', async () => {
  const res = await fetch(apiUrl('/v1/intents/plan'), {
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

test('intent plan returns partner-aware strategy metadata', async () => {
  const res = await fetch(apiUrl('/v1/intents/plan'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({
      intentId: 'incident_postmortem',
      mcpProfile: 'default',
      partnerProfile: 'strict-reviewer',
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.partnerProfile, 'strict_reviewer');
  assert.equal(body.partnerStrategy.verificationMode, 'evidence_first');
  assert.ok(body.tokenBudget.contextPack > 6000);
  assert.ok(Array.isArray(body.actionScores));
});

test('intent plan returns codegraph impact for coding workflows', async () => {
  const previous = process.env.RLHF_CODEGRAPH_STUB_RESPONSE;
  process.env.RLHF_CODEGRAPH_STUB_RESPONSE = JSON.stringify({
    source: 'stub',
    symbols: ['planIntent'],
    callers: ['src/api/server.js -> planIntent'],
    callees: ['rankActions'],
    deadCode: ['legacyIntentPlanner'],
  });

  try {
    const res = await fetch(apiUrl('/v1/intents/plan'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader },
      body: JSON.stringify({
        intentId: 'incident_postmortem',
        context: 'Refactor `planIntent` in scripts/intent-router.js',
        mcpProfile: 'default',
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.codegraphImpact.enabled, true);
    assert.equal(body.codegraphImpact.evidence.deadCodeCount, 1);
    assert.ok(body.partnerStrategy.recommendedChecks.some((check) => /dead code/i.test(check)));
  } finally {
    if (previous === undefined) delete process.env.RLHF_CODEGRAPH_STUB_RESPONSE;
    else process.env.RLHF_CODEGRAPH_STUB_RESPONSE = previous;
  }
});

test('summary endpoint returns markdown text payload', async () => {
  const res = await fetch(apiUrl('/v1/feedback/summary?recent=10'), { headers: authHeader });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.match(body.summary, /Feedback Summary/);
});

test('dpo export endpoint works with local memory log', async () => {
  const outputPath = path.join(tmpFeedbackDir, 'dpo.jsonl');
  const res = await fetch(apiUrl('/v1/dpo/export'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({ outputPath }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(typeof body.pairs === 'number');
  assert.equal(fs.existsSync(outputPath), true);
});

test('databricks export endpoint writes analytics bundle', async () => {
  const outputPath = path.join(tmpFeedbackDir, 'analytics', 'bundle-api');
  fs.mkdirSync(path.join(tmpProofDir, 'automation'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpProofDir, 'automation', 'report.json'),
    JSON.stringify({ checks: [{ id: 'AUTO-01', passed: true }] }, null, 2)
  );

  const res = await fetch(apiUrl('/v1/analytics/databricks/export'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({ outputPath }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.bundlePath, outputPath);
  assert.equal(fs.existsSync(path.join(outputPath, 'manifest.json')), true);
  assert.equal(fs.existsSync(path.join(outputPath, 'load_databricks.sql')), true);
  assert.ok(body.tables.some((table) => table.tableName === 'proof_reports'));
});

test('databricks export endpoint defaults bundle path inside the safe feedback dir', async () => {
  const res = await fetch(apiUrl('/v1/analytics/databricks/export'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({}),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.match(body.bundlePath, new RegExp(`^${path.join(tmpFeedbackDir, 'analytics').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.equal(fs.existsSync(path.join(body.bundlePath, 'manifest.json')), true);
});

test('context construct/evaluate/provenance endpoints work', async () => {
  const constructRes = await fetch(apiUrl('/v1/context/construct'), {
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

  const evalRes = await fetch(apiUrl('/v1/context/evaluate'), {
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

  const provRes = await fetch(apiUrl('/v1/context/provenance?limit=5'), {
    headers: authHeader,
  });
  assert.equal(provRes.status, 200);
  const provBody = await provRes.json();
  assert.equal(Array.isArray(provBody.events), true);
});

test('context construct rejects invalid namespaces', async () => {
  const res = await fetch(apiUrl('/v1/context/construct'), {
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
  const res = await fetch(apiUrl('/v1/feedback/stats'));
  assert.equal(res.status, 401);
});

test('billing checkout endpoint is public', async () => {
  const res = await fetch(apiUrl('/v1/billing/checkout'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      installId: 'inst_public_checkout_test',
    }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const body = await res.json();
  assert.ok(typeof body.sessionId === 'string');
  assert.equal(body.localMode, true);
  assert.match(body.traceId, /^checkout_/);
  assert.equal(res.headers.get('x-rlhf-trace-id'), body.traceId);
});

test('billing session endpoint returns provisioned local checkout details', async () => {
  const checkoutRes = await fetch(apiUrl('/v1/billing/checkout'), {
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
    `${apiUrl('/v1/billing/session')}?sessionId=${encodeURIComponent(checkoutBody.sessionId)}`
  );
  assert.equal(sessionRes.status, 200);
  const sessionBody = await sessionRes.json();
  assert.equal(sessionBody.paid, true);
  assert.equal(sessionBody.installId, 'inst_public_checkout_lookup');
  assert.ok(sessionBody.apiKey.startsWith('rlhf_'));
  assert.equal(sessionBody.appOrigin, 'https://app.example.com');
  assert.equal(sessionBody.apiBaseUrl, 'https://billing.example.com');
  assert.match(sessionBody.traceId, /^checkout_/);
  assert.match(sessionBody.nextSteps.env, /RLHF_API_KEY=/);
  assert.match(sessionBody.nextSteps.env, /RLHF_API_BASE_URL=https:\/\/billing\.example\.com/);
  assert.match(sessionBody.nextSteps.curl, /https:\/\/billing\.example\.com\/v1\/feedback\/capture/);
});

test('billing checkout supports CORS preflight', async () => {
  const res = await fetch(apiUrl('/v1/billing/checkout'), {
    method: 'OPTIONS',
    headers: {
      origin: 'https://app.example.com',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.match(String(res.headers.get('access-control-allow-methods')), /POST/);
});

test('billing session endpoint rejects missing session ids', async () => {
  const res = await fetch(apiUrl('/v1/billing/session'));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.detail, /sessionId/);
});

test('billing provision requires static admin key and rejects billing keys', async () => {
  const billingKey = billing.provisionApiKey('cus_non_admin').key;
  const res = await fetch(apiUrl('/v1/billing/provision'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${billingKey}`,
    },
    body: JSON.stringify({ customerId: 'cus_should_fail' }),
  });
  assert.equal(res.status, 403);
});

test('billing summary returns admin-only operational proxy', async () => {
  billing.provisionApiKey('cus_admin_summary', {
    installId: 'inst_admin_summary',
    source: 'stripe_webhook_checkout_completed',
  });
  billing.appendFunnelEvent({
    stage: 'paid',
    event: 'stripe_checkout_completed',
    installId: 'inst_admin_summary',
    evidence: 'cs_admin_summary',
    metadata: { customerId: 'cus_admin_summary' },
  });
  billing.appendRevenueEvent({
    provider: 'stripe',
    event: 'stripe_checkout_completed',
    status: 'paid',
    customerId: 'cus_admin_summary',
    orderId: 'cs_admin_summary',
    installId: 'inst_admin_summary',
    traceId: 'trace_admin_summary',
    amountCents: 2900,
    currency: 'USD',
    amountKnown: true,
    recurringInterval: 'month',
    attribution: {
      source: 'website',
      utmSource: 'website',
      utmMedium: 'cta_button',
      utmCampaign: 'pro_pack',
    },
  });

  const res = await fetch(apiUrl('/v1/billing/summary'), {
    headers: authHeader,
  });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.coverage.source, 'funnel_ledger+revenue_ledger+key_store');
  assert.equal(body.coverage.tracksBookedRevenue, true);
  assert.ok(body.funnel.stageCounts.paid >= 1);
  assert.ok(body.keys.active >= 1);
  assert.equal(body.revenue.bookedRevenueCents, 2900);
  assert.equal(body.revenue.paidOrders, 1);
  assert.equal(body.attribution.bookedRevenueByCampaignCents.pro_pack, 2900);
  assert.ok(Array.isArray(body.customers));
});

test('billing summary rejects billing keys', async () => {
  const billingKey = billing.provisionApiKey('cus_non_admin_summary').key;
  const res = await fetch(apiUrl('/v1/billing/summary'), {
    headers: {
      authorization: `Bearer ${billingKey}`,
    },
  });
  assert.equal(res.status, 403);
});

test('rejects external output path by default', async () => {
  const externalPath = '/tmp/should-not-write-outside-safe-root.jsonl';
  const res = await fetch(apiUrl('/v1/dpo/export'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({ outputPath: externalPath }),
  });
  assert.equal(res.status, 400);
});

test('funnel analytics returns counts and conversion rates', async () => {
  const checkoutRes = await fetch(apiUrl('/v1/billing/checkout'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({
      installId: 'inst_api_server_test',
      metadata: {
        source: 'website',
        utmSource: 'website',
        utmMedium: 'cta_button',
        utmCampaign: 'spring_launch',
        ctaId: 'pricing_pro',
      },
    }),
  });
  assert.equal(checkoutRes.status, 200);

  const analyticsRes = await fetch(apiUrl('/v1/analytics/funnel'), {
    headers: authHeader,
  });
  assert.equal(analyticsRes.status, 200);

  const body = await analyticsRes.json();
  assert.ok(typeof body.totalEvents === 'number');
  assert.ok(typeof body.stageCounts === 'object');
  assert.ok(typeof body.conversionRates === 'object');
  assert.ok(body.stageCounts.acquisition >= 1);
  assert.ok(typeof body.conversionRates.acquisitionToActivation === 'number');

  const summaryRes = await fetch(apiUrl('/v1/billing/summary'), {
    headers: authHeader,
  });
  assert.equal(summaryRes.status, 200);
  const summary = await summaryRes.json();
  assert.ok(summary.signups.bySource.website >= 1);
  assert.ok(summary.attribution.acquisitionByCampaign.spring_launch >= 1);
});
