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
process.env.RLHF_GA_MEASUREMENT_ID = 'G-TEST1234';
process.env.RLHF_GOOGLE_SITE_VERIFICATION = 'test-verification-token';

const { startServer, __test__ } = require('../src/api/server');
const billing = require('../scripts/billing');
const { buildHostedSuccessUrl } = require('../scripts/hosted-config');

let handle;
let apiOrigin = '';
const authHeader = { authorization: 'Bearer test-api-key' };

function apiUrl(pathname = '/') {
  return new URL(pathname, apiOrigin).toString();
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function extractCookieValue(setCookies, name) {
  const target = setCookies.find((cookie) => cookie.startsWith(`${name}=`));
  if (!target) return null;
  const match = target.match(new RegExp(`^${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
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
  assert.match(body, /Keep one sharp agent/i);
  assert.match(body, /Claude workflow hardening/i);
  assert.match(body, /Workflow Hardening Sprint/i);
  assert.match(body, /Start Sprint Intake/i);
  assert.match(body, /Code modernization guardrails/i);
  assert.match(body, /Reliability Studio/i);
  assert.match(body, /Import\. Compare\. Deploy\./);
  assert.match(body, /No model fine-tuning required/i);
  assert.match(body, /PR review threads, CI logs, runbooks, JSONL, and CSV/i);
  assert.match(body, /Start Compare &amp; Deploy/);
  assert.match(body, /same agent session|same reliability layer|No orchestration tax/i);
  assert.match(body, /\$49 one-time/);
  assert.match(body, /plausible\.io\/js\/script\.js/);
  assert.match(body, /googletagmanager\.com\/gtag\/js\?id=G-TEST1234/);
  assert.match(body, /google-site-verification" content="test-verification-token"/);
  assert.match(body, /gtag\('config', 'G-TEST1234', \{ send_page_view: false \}\)/);
  assert.match(body, /\/v1\/billing\/checkout/);
  assert.match(body, /\/v1\/intake\/workflow-sprint/);
  assert.match(body, /Review Sprint Brief/);
  assert.doesNotMatch(body, /Email Instead/i);
  assert.doesNotMatch(body, /mailto:/i);
});

test('root seeds journey cookies, injects server telemetry IDs, and records landing telemetry server-side', async () => {
  const res = await fetch(apiUrl('/'));
  assert.equal(res.status, 200);

  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [];
  const visitorId = extractCookieValue(setCookies, 'rlhf_visitor_id');
  const sessionId = extractCookieValue(setCookies, 'rlhf_session_id');
  const acquisitionId = extractCookieValue(setCookies, 'rlhf_acquisition_id');
  assert.match(String(visitorId), /^visitor_/);
  assert.match(String(sessionId), /^session_/);
  assert.match(String(acquisitionId), /^acq_/);

  const body = await res.text();
  assert.match(body, new RegExp(`const serverVisitorId = '${visitorId}';`));
  assert.match(body, new RegExp(`const serverSessionId = '${sessionId}';`));
  assert.match(body, new RegExp(`const serverAcquisitionId = '${acquisitionId}';`));
  assert.match(body, /const serverTelemetryCaptured = 'true' === 'true';/);

  const telemetryEvents = readJsonl(path.join(tmpFeedbackDir, 'telemetry-pings.jsonl'));
  const landingEvent = telemetryEvents.find((entry) => (
    entry.eventType === 'landing_page_view' &&
    entry.visitorId === visitorId &&
    entry.sessionId === sessionId &&
    entry.acquisitionId === acquisitionId &&
    entry.page === '/'
  ));
  assert.ok(landingEvent);
  assert.equal(landingEvent.source, 'website');
});

test('root reuses journey cookies and records SEO landing telemetry from search referrers', async () => {
  const cookieHeader = [
    'rlhf_visitor_id=visitor_seeded',
    'rlhf_session_id=session_seeded',
    'rlhf_acquisition_id=acq_seeded',
  ].join('; ');
  const res = await fetch(apiUrl('/'), {
    headers: {
      cookie: cookieHeader,
      referer: 'https://www.google.com/search?q=workflow+hardening+sprint',
    },
  });
  assert.equal(res.status, 200);

  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [];
  assert.equal(setCookies.length, 0);

  const telemetryEvents = readJsonl(path.join(tmpFeedbackDir, 'telemetry-pings.jsonl'));
  const landingEvent = telemetryEvents.find((entry) => (
    entry.eventType === 'landing_page_view' &&
    entry.visitorId === 'visitor_seeded' &&
    entry.sessionId === 'session_seeded' &&
    entry.acquisitionId === 'acq_seeded' &&
    entry.referrerHost === 'www.google.com'
  ));
  assert.ok(landingEvent);
  assert.equal(landingEvent.source, 'organic_search');

  const seoEvent = telemetryEvents.find((entry) => (
    entry.eventType === 'seo_landing_view' &&
    entry.visitorId === 'visitor_seeded' &&
    entry.sessionId === 'session_seeded' &&
    entry.acquisitionId === 'acq_seeded'
  ));
  assert.ok(seoEvent);
  assert.equal(seoEvent.seoSurface, 'google_search');
  assert.equal(seoEvent.seoQuery, 'workflow hardening sprint');
});

test('robots and sitemap endpoints publish crawl metadata for the canonical app origin', async () => {
  const robotsRes = await fetch(apiUrl('/robots.txt'));
  assert.equal(robotsRes.status, 200);
  assert.match(String(robotsRes.headers.get('content-type')), /text\/plain/);
  const robotsBody = await robotsRes.text();
  assert.match(robotsBody, /User-agent: \*/);
  assert.match(robotsBody, /Allow: \//);
  assert.match(robotsBody, /Sitemap: https:\/\/app\.example\.com\/sitemap\.xml/);

  const sitemapRes = await fetch(apiUrl('/sitemap.xml'));
  assert.equal(sitemapRes.status, 200);
  assert.match(String(sitemapRes.headers.get('content-type')), /application\/xml/);
  const sitemapBody = await sitemapRes.text();
  assert.match(sitemapBody, /<loc>https:\/\/app\.example\.com\/<\/loc>/);
  assert.match(sitemapBody, /<changefreq>weekly<\/changefreq>/);
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

test('root JSON mode does not emit landing telemetry or journey cookies', async () => {
  const beforeTelemetryCount = readJsonl(path.join(tmpFeedbackDir, 'telemetry-pings.jsonl')).length;
  const res = await fetch(apiUrl('/?format=json'), {
    headers: { accept: 'application/json' },
  });

  assert.equal(res.status, 200);
  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [];
  assert.equal(setCookies.length, 0);

  const afterTelemetry = readJsonl(path.join(tmpFeedbackDir, 'telemetry-pings.jsonl'));
  assert.equal(afterTelemetry.length, beforeTelemetryCount);
});

test('journey cookies are marked secure on forwarded HTTPS requests', async () => {
  const res = await fetch(apiUrl('/'), {
    headers: {
      'x-forwarded-proto': 'https',
    },
  });

  assert.equal(res.status, 200);
  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [];
  assert.ok(setCookies.length >= 3);
  for (const cookie of setCookies) {
    assert.match(cookie, /Secure/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
  }
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
  const res = await fetch(apiUrl('/cancel?trace_id=trace_test&acquisition_id=acq_test&visitor_id=visitor_test&session_id=session_test&install_id=inst_test&utm_source=google&utm_medium=organic&utm_campaign=seo_launch&cta_id=pricing_pro&cta_placement=pricing&plan_id=pro&landing_path=%2F&referrer_host=www.google.com'));
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/html/);

  const body = await res.text();
  assert.match(body, /Checkout cancelled\./);
  assert.match(body, /noindex,nofollow/);
  assert.match(body, /data-reason="too_expensive"/);
  assert.match(body, /sendTelemetry\('checkout_cancelled'\)/);
  assert.match(body, /sendTelemetry\('reason_not_buying'/);
  assert.match(body, /retryUrl\.searchParams\.set\(key, value\)/);
  assert.match(body, /Return to Context Gateway/);
});

test('checkout fallback URLs preserve Stripe session placeholders while carrying visitor-session attribution', () => {
  const hostedSuccessUrl = buildHostedSuccessUrl('https://app.example.com', 'trace_checkout');
  const decoratedUrl = __test__.buildCheckoutFallbackUrl(hostedSuccessUrl, {
    acquisitionId: 'acq_test',
    visitorId: 'visitor_test',
    sessionId: 'visitor_session_test',
    utmSource: 'reddit',
    community: 'ClaudeCode',
  });
  const parsed = new URL(decoratedUrl);

  assert.equal(parsed.searchParams.get('session_id'), '{CHECKOUT_SESSION_ID}');
  assert.equal(parsed.searchParams.get('visitor_session_id'), 'visitor_session_test');
  assert.equal(parsed.searchParams.get('acquisition_id'), 'acq_test');
  assert.equal(parsed.searchParams.get('visitor_id'), 'visitor_test');
  assert.equal(parsed.searchParams.get('utm_source'), 'reddit');
  assert.equal(parsed.searchParams.get('community'), 'ClaudeCode');
});

test('checkout bootstrap route preserves attribution and records first-party telemetry in local mode', async () => {
  const res = await fetch(
    apiUrl('/checkout/pro?acquisition_id=acq_bootstrap&visitor_id=visitor_bootstrap&session_id=session_bootstrap&install_id=inst_bootstrap&utm_source=reddit&utm_medium=organic_social&utm_campaign=reddit_launch&utm_term=agentic+feedback&community=ClaudeCode&post_id=1rsudq0&comment_id=oa9mqjf&campaign_variant=comment_problem_solution&offer_code=REDDIT-EARLY&cta_id=pricing_pro&cta_placement=pricing&plan_id=pro&landing_path=%2Fpricing'),
    {
      redirect: 'manual',
      headers: {
        referer: 'https://www.reddit.com/r/ClaudeCode/comments/1rsudq0/comment/oa9mqjf/',
      },
    }
  );

  assert.equal(res.status, 302);
  const location = new URL(res.headers.get('location'));
  assert.equal(location.pathname, '/success');
  assert.match(String(location.searchParams.get('session_id')), /^test_session_/);
  assert.match(String(location.searchParams.get('trace_id')), /^checkout_/);
  assert.equal(location.searchParams.get('acquisition_id'), 'acq_bootstrap');
  assert.equal(location.searchParams.get('visitor_id'), 'visitor_bootstrap');
  assert.equal(location.searchParams.get('visitor_session_id'), 'session_bootstrap');
  assert.equal(location.searchParams.get('install_id'), 'inst_bootstrap');

  const funnelEvents = readJsonl(process.env._TEST_FUNNEL_LEDGER_PATH);
  const checkoutCreated = funnelEvents.find((entry) => (
    entry.event === 'checkout_session_created' &&
    entry.traceId === location.searchParams.get('trace_id')
  ));
  assert.ok(checkoutCreated);
  assert.equal(checkoutCreated.installId, 'inst_bootstrap');
  assert.equal(checkoutCreated.acquisitionId, 'acq_bootstrap');
  assert.equal(checkoutCreated.visitorId, 'visitor_bootstrap');
  assert.equal(checkoutCreated.sessionId, 'session_bootstrap');
  assert.equal(checkoutCreated.ctaId, 'pricing_pro');
  assert.equal(checkoutCreated.ctaPlacement, 'pricing');
  assert.equal(checkoutCreated.planId, 'pro');
  assert.equal(checkoutCreated.landingPath, '/pricing');
  assert.equal(checkoutCreated.referrerHost, 'www.reddit.com');
  assert.equal(checkoutCreated.community, 'ClaudeCode');
  assert.equal(checkoutCreated.postId, '1rsudq0');
  assert.equal(checkoutCreated.commentId, 'oa9mqjf');
  assert.equal(checkoutCreated.campaignVariant, 'comment_problem_solution');
  assert.equal(checkoutCreated.offerCode, 'REDDIT-EARLY');

  const telemetryEvents = readJsonl(path.join(tmpFeedbackDir, 'telemetry-pings.jsonl'));
  const bootstrapEvent = telemetryEvents.find((entry) => entry.eventType === 'checkout_bootstrap');
  assert.ok(bootstrapEvent);
  assert.equal(bootstrapEvent.page, '/checkout/pro');
  assert.equal(bootstrapEvent.acquisitionId, 'acq_bootstrap');
  assert.equal(bootstrapEvent.visitorId, 'visitor_bootstrap');
  assert.equal(bootstrapEvent.sessionId, 'session_bootstrap');
  assert.equal(bootstrapEvent.installId, 'inst_bootstrap');
  assert.equal(bootstrapEvent.utmSource, 'reddit');
  assert.equal(bootstrapEvent.utmMedium, 'organic_social');
  assert.equal(bootstrapEvent.utmCampaign, 'reddit_launch');
  assert.equal(bootstrapEvent.ctaId, 'pricing_pro');
  assert.equal(bootstrapEvent.planId, 'pro');
  assert.equal(bootstrapEvent.landingPath, '/pricing');
  assert.equal(bootstrapEvent.referrerHost, 'www.reddit.com');
  assert.equal(bootstrapEvent.community, 'ClaudeCode');
  assert.equal(bootstrapEvent.offerCode, 'REDDIT-EARLY');
});

test('checkout bootstrap falls back to seeded journey cookies when query IDs are absent', async () => {
  const cookieHeader = [
    'rlhf_visitor_id=visitor_cookie_checkout',
    'rlhf_session_id=session_cookie_checkout',
    'rlhf_acquisition_id=acq_cookie_checkout',
  ].join('; ');
  const res = await fetch(
    apiUrl('/checkout/pro?utm_source=reddit&utm_medium=organic_social&utm_campaign=reddit_launch&cta_id=pricing_pro&cta_placement=pricing&plan_id=pro'),
    {
      redirect: 'manual',
      headers: {
        cookie: cookieHeader,
        referer: 'https://www.reddit.com/r/ClaudeCode/comments/1rsudq0/',
      },
    }
  );

  assert.equal(res.status, 302);
  const location = new URL(res.headers.get('location'));
  assert.equal(location.searchParams.get('acquisition_id'), 'acq_cookie_checkout');
  assert.equal(location.searchParams.get('visitor_id'), 'visitor_cookie_checkout');
  assert.equal(location.searchParams.get('visitor_session_id'), 'session_cookie_checkout');

  const telemetryEvents = readJsonl(path.join(tmpFeedbackDir, 'telemetry-pings.jsonl'));
  const bootstrapEvent = telemetryEvents.find((entry) => (
    entry.eventType === 'checkout_bootstrap' &&
    entry.acquisitionId === 'acq_cookie_checkout' &&
    entry.visitorId === 'visitor_cookie_checkout' &&
    entry.sessionId === 'session_cookie_checkout'
  ));
  assert.ok(bootstrapEvent);
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
  assert.equal(body.executionMode, 'single_agent');
  assert.equal(body.delegationEligible, false);
  assert.equal(body.delegationScore, 0);
  assert.equal(body.delegateProfile, null);
  assert.equal(body.handoffContract, null);
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

test('handoff endpoints expose sequential delegation over HTTP', async () => {
  const planRes = await fetch(apiUrl('/v1/intents/plan'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({
      intentId: 'improve_response_quality',
      context: 'Improve the response with evidence and prevention rules',
      mcpProfile: 'default',
      delegationMode: 'auto',
    }),
  });
  assert.equal(planRes.status, 200);
  const planBody = await planRes.json();
  assert.equal(planBody.executionMode, 'sequential_delegate');
  assert.equal(planBody.delegateProfile, 'pr_workflow');
  assert.ok(planBody.handoffContract);

  const startRes = await fetch(apiUrl('/v1/handoffs/start'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({
      intentId: 'improve_response_quality',
      context: 'Improve the response with evidence and prevention rules',
      mcpProfile: 'default',
    }),
  });
  assert.equal(startRes.status, 200);
  const started = await startRes.json();
  assert.equal(started.status, 'started');
  assert.equal(started.executionMode, 'sequential_delegate');
  assert.equal(started.delegateProfile, 'pr_workflow');
  assert.ok(started.handoffContract);
  assert.ok(Array.isArray(started.handoffContract.requiredChecks));

  const completeRes = await fetch(apiUrl('/v1/handoffs/complete'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader },
    body: JSON.stringify({
      handoffId: started.handoffId,
      outcome: 'accepted',
      summary: 'Accepted after evidence review.',
      resultContext: 'Returned a verified result context with explicit evidence and clean checks.',
      attempts: 2,
      violationCount: 0,
    }),
  });
  assert.equal(completeRes.status, 200);
  const completed = await completeRes.json();
  assert.equal(completed.status, 'completed');
  assert.equal(completed.outcome, 'accepted');
  assert.equal(completed.verificationAccepted, true);
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
  assert.equal(body.price, 49);
  assert.equal(body.type, 'payment');
  assert.equal(res.headers.get('x-rlhf-trace-id'), body.traceId);
});

test('workflow sprint intake endpoint captures a contactable lead', async () => {
  const res = await fetch(apiUrl('/v1/intake/workflow-sprint'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'buyer@example.com',
      company: 'Example Co',
      workflow: 'PR review hardening',
      owner: 'Platform Lead',
      blocker: 'The same CI and review regressions keep resurfacing across agent runs.',
      runtime: 'Claude Code',
      note: 'Need proof before rolling this out team-wide.',
      utmSource: 'linkedin',
      utmMedium: 'organic_social',
      utmCampaign: 'claude_workflow_hardening_march_2026',
      ctaId: 'workflow_sprint_intake',
      ctaPlacement: 'workflow_sprint',
      planId: 'sprint',
    }),
  });

  assert.equal(res.status, 201);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.match(body.leadId, /^lead_/);
  assert.equal(body.status, 'new');
  assert.match(body.proofPackUrl, /VERIFICATION_EVIDENCE\.md/);

  const leads = readJsonl(path.join(tmpFeedbackDir, 'workflow-sprint-leads.jsonl'));
  assert.equal(leads.length, 1);
  assert.equal(leads[0].contact.email, 'buyer@example.com');
  assert.equal(leads[0].qualification.workflow, 'PR review hardening');
  assert.equal(leads[0].attribution.planId, 'sprint');
  assert.equal(leads[0].attribution.source, 'linkedin');
  assert.equal(leads[0].attribution.utmMedium, 'organic_social');

  const telemetry = readJsonl(path.join(tmpFeedbackDir, 'telemetry-pings.jsonl'));
  assert.ok(telemetry.some((entry) => entry.eventType === 'workflow_sprint_lead_submitted'));
});

test('workflow sprint intake falls back to journey cookies when IDs are omitted from the payload', async () => {
  const cookieHeader = [
    'rlhf_visitor_id=visitor_cookie_lead',
    'rlhf_session_id=session_cookie_lead',
    'rlhf_acquisition_id=acq_cookie_lead',
  ].join('; ');

  const res = await fetch(apiUrl('/v1/intake/workflow-sprint'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: cookieHeader,
      referer: 'https://www.google.com/search?q=claude+workflow+hardening',
    },
    body: JSON.stringify({
      email: 'ops@example.com',
      company: 'North Star Systems',
      workflow: 'Bug triage',
      owner: 'Platform lead',
      runtime: 'Claude Code',
      blocker: 'Unsafe rollout reviews keep stalling the queue.',
    }),
  });

  assert.equal(res.status, 201);
  const leads = readJsonl(path.join(tmpFeedbackDir, 'workflow-sprint-leads.jsonl'));
  const lead = leads.find((entry) => entry.contact.email === 'ops@example.com');
  assert.ok(lead);
  assert.equal(lead.attribution.acquisitionId, 'acq_cookie_lead');
  assert.equal(lead.attribution.visitorId, 'visitor_cookie_lead');
  assert.equal(lead.attribution.sessionId, 'session_cookie_lead');

  const telemetry = readJsonl(path.join(tmpFeedbackDir, 'telemetry-pings.jsonl'));
  const submitted = telemetry.find((entry) => (
    entry.eventType === 'workflow_sprint_lead_submitted' &&
    entry.acquisitionId === 'acq_cookie_lead' &&
    entry.visitorId === 'visitor_cookie_lead' &&
    entry.sessionId === 'session_cookie_lead'
  ));
  assert.ok(submitted);
});

test('workflow sprint intake accepts form posts, seeds journey cookies, and returns an HTML confirmation page', async () => {
  const body = new URLSearchParams({
    email: 'formbuyer@example.com',
    company: 'HTML Forms Co',
    workflow: 'Release triage',
    owner: 'CTO',
    runtime: 'Claude Code',
    blocker: 'No-JS buyers need a real intake path.',
  }).toString();

  const res = await fetch(apiUrl('/v1/intake/workflow-sprint'), {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      referer: 'https://app.example.com/?utm_source=reddit&utm_medium=organic_social&utm_campaign=workflow_hardening_launch&community=ClaudeCode&post_id=1rsudq0&offer_code=EARLY',
    },
    body,
  });

  assert.equal(res.status, 201);
  assert.match(String(res.headers.get('content-type')), /text\/html/);
  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [];
  const visitorId = extractCookieValue(setCookies, 'rlhf_visitor_id');
  const sessionId = extractCookieValue(setCookies, 'rlhf_session_id');
  const acquisitionId = extractCookieValue(setCookies, 'rlhf_acquisition_id');
  assert.match(String(visitorId), /^visitor_/);
  assert.match(String(sessionId), /^session_/);
  assert.match(String(acquisitionId), /^acq_/);

  const html = await res.text();
  assert.match(html, /Workflow sprint intake received/);
  assert.match(html, /Review Proof Pack/);
  assert.match(html, /Review Sprint Brief/);

  const leads = readJsonl(path.join(tmpFeedbackDir, 'workflow-sprint-leads.jsonl'));
  const lead = leads.find((entry) => entry.contact.email === 'formbuyer@example.com');
  assert.ok(lead);
  assert.equal(lead.attribution.source, 'reddit');
  assert.equal(lead.attribution.utmCampaign, 'workflow_hardening_launch');
  assert.equal(lead.attribution.community, 'ClaudeCode');
  assert.equal(lead.attribution.postId, '1rsudq0');
  assert.equal(lead.attribution.offerCode, 'EARLY');
  assert.equal(lead.attribution.visitorId, visitorId);
  assert.equal(lead.attribution.sessionId, sessionId);
  assert.equal(lead.attribution.acquisitionId, acquisitionId);

  const telemetry = readJsonl(path.join(tmpFeedbackDir, 'telemetry-pings.jsonl'));
  const submitted = telemetry.find((entry) => (
    entry.eventType === 'workflow_sprint_lead_submitted' &&
    entry.acquisitionId === acquisitionId &&
    entry.visitorId === visitorId &&
    entry.sessionId === sessionId
  ));
  assert.ok(submitted);
});

test('workflow sprint intake validation failure records failure telemetry and writes no lead', async () => {
  const leadsBefore = readJsonl(path.join(tmpFeedbackDir, 'workflow-sprint-leads.jsonl')).length;
  const res = await fetch(apiUrl('/v1/intake/workflow-sprint'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      referer: 'https://app.example.com/?utm_source=linkedin&utm_campaign=workflow_hardening',
    },
    body: JSON.stringify({
      email: 'invalid-email',
      workflow: '',
      owner: 'CTO',
      runtime: 'Claude Code',
      blocker: 'Missing required lead fields should fail.',
    }),
  });

  assert.equal(res.status, 400);
  const leadsAfter = readJsonl(path.join(tmpFeedbackDir, 'workflow-sprint-leads.jsonl')).length;
  assert.equal(leadsAfter, leadsBefore);

  const telemetry = readJsonl(path.join(tmpFeedbackDir, 'telemetry-pings.jsonl'));
  const failure = [...telemetry].reverse().find((entry) => entry.eventType === 'workflow_sprint_lead_failed');
  assert.ok(failure);
  assert.equal(failure.utmSource, 'linkedin');
  assert.equal(failure.utmCampaign, 'workflow_hardening');
  assert.equal(failure.ctaId, 'workflow_sprint_intake');
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
  fs.writeFileSync(path.join(tmpFeedbackDir, 'workflow-sprint-leads.jsonl'), `${JSON.stringify({
    leadId: 'lead_admin_summary',
    submittedAt: '2026-03-12T02:00:00.000Z',
    status: 'new',
    offer: 'workflow_hardening_sprint',
    contact: {
      email: 'ops@example.com',
      company: 'Example Co',
    },
    qualification: {
      workflow: 'Claude deployment review',
      owner: 'Platform lead',
      blocker: 'Rollouts need audit proof',
      runtime: 'Claude Code + MCP',
      note: null,
    },
    attribution: {
      source: 'linkedin',
      utmSource: 'linkedin',
      utmCampaign: 'workflow_hardening',
      community: 'platform',
    },
  })}\n`);
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
    amountCents: 4900,
    currency: 'USD',
    amountKnown: true,
    recurringInterval: null,
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
  assert.equal(body.coverage.source, 'funnel_ledger+revenue_ledger+key_store+workflow_sprint_leads');
  assert.equal(body.coverage.tracksBookedRevenue, true);
  assert.equal(body.coverage.tracksWorkflowSprintLeads, true);
  assert.ok(body.funnel.stageCounts.paid >= 1);
  assert.ok(body.keys.active >= 1);
  assert.equal(body.revenue.bookedRevenueCents, 4900);
  assert.equal(body.revenue.paidOrders, 1);
  assert.equal(body.revenue.paidProviderEvents, 1);
  assert.equal(body.pipeline.workflowSprintLeads.total, 1);
  assert.equal(body.pipeline.workflowSprintLeads.bySource.linkedin, 1);
  assert.equal(body.pipeline.qualifiedWorkflowSprintLeads.total, 1);
  assert.equal(body.attribution.bookedRevenueByCampaignCents.pro_pack, 4900);
  assert.ok(body.trafficMetrics.visitors >= 1);
  assert.equal(body.operatorGeneratedAcquisition.uniqueLeads, 0);
  assert.equal(body.dataQuality.unreconciledPaidEvents, 0);
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
        source: 'reddit',
        utmSource: 'reddit',
        utmMedium: 'organic_social',
        utmCampaign: 'reddit_launch',
        community: 'ClaudeCode',
        postId: '1rsudq0',
        commentId: 'oa9mqjf',
        campaignVariant: 'comment_problem_solution',
        offerCode: 'REDDIT-EARLY',
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
  assert.ok(summary.signups.bySource.reddit >= 1);
  assert.ok(summary.attribution.acquisitionByCampaign.reddit_launch >= 1);
  assert.ok(summary.attribution.acquisitionByCommunity.ClaudeCode >= 1);
  assert.ok(summary.attribution.acquisitionByPostId['1rsudq0'] >= 1);
  assert.ok(summary.attribution.acquisitionByCommentId.oa9mqjf >= 1);
  assert.ok(summary.attribution.acquisitionByCampaignVariant.comment_problem_solution >= 1);
  assert.ok(summary.attribution.acquisitionByOfferCode['REDDIT-EARLY'] >= 1);
});
