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
process.env.RLHF_BUILD_METADATA_PATH = path.join(tmpFeedbackDir, 'build-metadata.json');
fs.writeFileSync(
  process.env.RLHF_BUILD_METADATA_PATH,
  JSON.stringify({ buildSha: 'test-build-sha', generatedAt: '2026-03-20T00:00:00.000Z' }, null, 2)
);

const { startServer, __test__ } = require('../src/api/server');
const billing = require('../scripts/billing');
const { buildHostedSuccessUrl } = require('../scripts/hosted-config');

let handle;
let apiOrigin = '';
const authHeader = { authorization: 'Bearer test-api-key' };

test('api servers 2026 pricing', () => {
  assert.match('$49 one-time', /\$49 one-time/);
});

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
  delete process.env.RLHF_BUILD_METADATA_PATH;
  try {
    fs.rmSync(tmpFeedbackDir, { recursive: true, force: true });
    fs.rmSync(tmpProofDir, { recursive: true, force: true });
  } catch (err) {
    // Ignore ENOTEMPTY errors during teardown
  }
});

test('health endpoint returns ok', async () => {
  const res = await fetch(apiUrl('/health'), { headers: authHeader });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.buildSha, 'test-build-sha');
});

test('protected endpoints accept x-api-key as an alternate auth header', async () => {
  const res = await fetch(apiUrl('/v1/feedback/summary'), {
    headers: { 'x-api-key': 'test-api-key' },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.summary, 'string');
});

test('root serves the landing page by default', async () => {
  const res = await fetch(apiUrl('/'));
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/html/);

  const body = await res.text();
  assert.match(body, /ThumbGate/);
  assert.match(body, /Stop AI Coding Agents From Repeating Mistakes/i);
  assert.match(body, /Human-in-the-Loop Enforcement/i);
  assert.match(body, /safety net for vibe coding/i);
  assert.match(body, /npx mcp-memory-gateway init/);
  assert.match(body, /Pre-Action Gates/i);
  assert.match(body, /Thompson Sampling/i);
  assert.match(body, /FAQPage/);
  assert.match(body, /SoftwareApplication/);
  assert.match(body, /\$49/);
  assert.match(body, /plausible\.io\/js\/pa-/);
  assert.match(body, /googletagmanager\.com\/gtag\/js\?id=G-TEST1234/);
  assert.match(body, /google-site-verification" content="test-verification-token"/);
  assert.match(body, /gtag\('config', 'G-TEST1234', \{ send_page_view: false \}\)/);
  assert.doesNotMatch(body, /mailto:/i);
});

test('privacy policy route covers collection, sharing, retention, and contact details', async () => {
  const res = await fetch(apiUrl('/privacy'));
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/html/);

  const body = await res.text();
  assert.match(body, /Privacy Policy/i);
  assert.match(body, /Data Collection/i);
  assert.match(body, /Data Sharing/i);
  assert.match(body, /Data Retention/i);
  assert.match(body, /optional CLI telemetry/i);
  assert.match(body, /igor\.ganapolsky@gmail\.com/i);
});

test('public HEAD routes stay unauthenticated and side-effect free', async () => {
  const telemetryPath = path.join(tmpFeedbackDir, 'telemetry-pings.jsonl');
  const checkoutSessionsPath = process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH;
  const telemetryCountBefore = readJsonl(telemetryPath).length;
  const checkoutSessionsBefore = checkoutSessionsPath && fs.existsSync(checkoutSessionsPath)
    ? JSON.parse(fs.readFileSync(checkoutSessionsPath, 'utf8')).length
    : 0;

  const homeRes = await fetch(apiUrl('/'), { method: 'HEAD' });
  assert.equal(homeRes.status, 200);
  assert.match(String(homeRes.headers.get('content-type')), /text\/html/);
  assert.equal(await homeRes.text(), '');
  assert.equal(
    typeof homeRes.headers.getSetCookie === 'function' ? homeRes.headers.getSetCookie().length : 0,
    0
  );

  const compareRes = await fetch(apiUrl('/compare/speclock'), { method: 'HEAD' });
  assert.equal(compareRes.status, 200);
  assert.match(String(compareRes.headers.get('content-type')), /text\/html/);
  assert.equal(await compareRes.text(), '');
  assert.equal(
    typeof compareRes.headers.getSetCookie === 'function' ? compareRes.headers.getSetCookie().length : 0,
    0
  );

  const privacyRes = await fetch(apiUrl('/privacy'), { method: 'HEAD' });
  assert.equal(privacyRes.status, 200);
  assert.match(String(privacyRes.headers.get('content-type')), /text\/html/);
  assert.equal(await privacyRes.text(), '');

  const robotsRes = await fetch(apiUrl('/robots.txt'), { method: 'HEAD' });
  assert.equal(robotsRes.status, 200);
  assert.match(String(robotsRes.headers.get('content-type')), /text\/plain/);
  assert.equal(await robotsRes.text(), '');

  const sitemapRes = await fetch(apiUrl('/sitemap.xml'), { method: 'HEAD' });
  assert.equal(sitemapRes.status, 200);
  assert.match(String(sitemapRes.headers.get('content-type')), /application\/xml/);
  assert.equal(await sitemapRes.text(), '');

  const cardRes = await fetch(apiUrl('/.well-known/mcp/server-card.json'), { method: 'HEAD' });
  assert.equal(cardRes.status, 200);
  assert.match(String(cardRes.headers.get('content-type')), /application\/json/);
  assert.equal(await cardRes.text(), '');

  const healthRes = await fetch(apiUrl('/health'), { method: 'HEAD' });
  assert.equal(healthRes.status, 200);
  assert.match(String(healthRes.headers.get('content-type')), /application\/json/);
  assert.equal(await healthRes.text(), '');

  const healthzRes = await fetch(apiUrl('/healthz'), { method: 'HEAD' });
  assert.equal(healthzRes.status, 200);
  assert.match(String(healthzRes.headers.get('content-type')), /application\/json/);
  assert.equal(await healthzRes.text(), '');

  const openapiRes = await fetch(apiUrl('/openapi.json'), { method: 'HEAD' });
  assert.equal(openapiRes.status, 200);
  assert.match(String(openapiRes.headers.get('content-type')), /(application\/json|text\/yaml)/);
  assert.equal(await openapiRes.text(), '');

  const checkoutRes = await fetch(apiUrl('/checkout/pro'), { method: 'HEAD' });
  assert.equal(checkoutRes.status, 200);
  assert.equal(await checkoutRes.text(), '');
  assert.equal(
    typeof checkoutRes.headers.getSetCookie === 'function' ? checkoutRes.headers.getSetCookie().length : 0,
    0
  );

  const telemetryCountAfter = readJsonl(telemetryPath).length;
  const checkoutSessionsAfter = checkoutSessionsPath && fs.existsSync(checkoutSessionsPath)
    ? JSON.parse(fs.readFileSync(checkoutSessionsPath, 'utf8')).length
    : 0;
  assert.equal(telemetryCountAfter, telemetryCountBefore);
  assert.equal(checkoutSessionsAfter, checkoutSessionsBefore);
});

test('public server card exposes MCP tool schemas for directory scanners', async () => {
  const res = await fetch(apiUrl('/.well-known/mcp/server-card.json'));
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /application\/json/);

  const body = await res.json();
  assert.equal(body.name, 'mcp-memory-gateway');
  assert.ok(Array.isArray(body.tools));
  assert.ok(body.tools.length > 0);

  const captureFeedbackTool = body.tools.find((tool) => tool.name === 'capture_feedback');
  assert.ok(captureFeedbackTool);
  assert.equal(captureFeedbackTool.inputSchema.type, 'object');
  assert.ok(captureFeedbackTool.inputSchema.required.includes('signal'));
  for (const tool of body.tools) {
    assert.equal(typeof tool.name, 'string');
    assert.equal(typeof tool.description, 'string');
    assert.equal(typeof tool.inputSchema, 'object');
    assert.ok(tool.inputSchema);
  }
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

test('SEO comparison pages serve HTML, reuse journey cookies, and record page-specific search telemetry', async () => {
  const cookieHeader = [
    'rlhf_visitor_id=visitor_compare',
    'rlhf_session_id=session_compare',
    'rlhf_acquisition_id=acq_compare',
  ].join('; ');
  const res = await fetch(apiUrl('/compare/speclock'), {
    headers: {
      cookie: cookieHeader,
      referer: 'https://www.google.com/search?q=thumbgate+vs+speclock',
    },
  });
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/html/);

  const setCookies = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [];
  assert.equal(setCookies.length, 0);

  const body = await res.text();
  assert.match(body, /ThumbGate vs SpecLock/);
  assert.match(body, /Verification evidence/);
  assert.match(body, /FAQPage/);

  const telemetryEvents = readJsonl(path.join(tmpFeedbackDir, 'telemetry-pings.jsonl'));
  const landingEvent = telemetryEvents.find((entry) => (
    entry.eventType === 'landing_page_view' &&
    entry.visitorId === 'visitor_compare' &&
    entry.sessionId === 'session_compare' &&
    entry.acquisitionId === 'acq_compare' &&
    entry.page === '/compare/speclock'
  ));
  assert.ok(landingEvent);
  assert.equal(landingEvent.pageType, 'comparison');
  assert.equal(landingEvent.contentPillar, 'comparison');
  assert.equal(landingEvent.primaryQuery, 'thumbgate vs speclock');
  assert.equal(landingEvent.source, 'organic_search');

  const seoEvent = telemetryEvents.find((entry) => (
    entry.eventType === 'seo_landing_view' &&
    entry.visitorId === 'visitor_compare' &&
    entry.sessionId === 'session_compare' &&
    entry.acquisitionId === 'acq_compare' &&
    entry.page === '/compare/speclock'
  ));
  assert.ok(seoEvent);
  assert.equal(seoEvent.pageType, 'comparison');
  assert.equal(seoEvent.seoQuery, 'thumbgate vs speclock');
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
  assert.match(sitemapBody, /<loc>https:\/\/app\.example\.com\/compare\/speclock<\/loc>/);
  assert.match(sitemapBody, /<loc>https:\/\/app\.example\.com\/compare\/mem0<\/loc>/);
  assert.match(sitemapBody, /<loc>https:\/\/app\.example\.com\/guides\/pre-action-gates<\/loc>/);
  assert.match(sitemapBody, /<loc>https:\/\/app\.example\.com\/guides\/claude-code-feedback<\/loc>/);
  assert.match(sitemapBody, /<changefreq>weekly<\/changefreq>/);
  assert.match(sitemapBody, /<priority>0\.9<\/priority>/);
  assert.match(sitemapBody, /<priority>0\.8<\/priority>/);
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

test('success page serves hosted onboarding shell and records first-party telemetry', async () => {
  const res = await fetch(apiUrl('/success?session_id=test_checkout_success&trace_id=trace_success_page&acquisition_id=acq_success_page&visitor_id=visitor_success_page&visitor_session_id=session_success_page&install_id=inst_success_page&utm_source=reddit&utm_medium=organic_social&utm_campaign=success_launch&community=ClaudeCode&cta_id=pricing_pro&cta_placement=pricing&plan_id=pro&landing_path=%2Fpricing&referrer_host=www.reddit.com'));
  assert.equal(res.status, 200);
  assert.match(String(res.headers.get('content-type')), /text\/html/);

  const body = await res.text();
  assert.match(body, /Your hosted API key is ready\./);
  assert.match(body, /const sessionEndpoint = "https:\/\/billing\.example\.com\/v1\/billing\/session";/);
  assert.match(body, /\+ '\?sessionId=' \+ encodeURIComponent\(sessionId\)/);
  assert.match(body, /sendTelemetryOnce\('checkout_session_lookup_started'/);
  assert.match(body, /sendTelemetryOnce\('checkout_paid_confirmed'/);
  assert.match(body, /sendTelemetryOnce\('checkout_session_pending'/);
  assert.match(body, /sendTelemetryOnce\('checkout_session_lookup_failed'/);

  const telemetryEvents = readJsonl(path.join(tmpFeedbackDir, 'telemetry-pings.jsonl'));
  const successPageView = telemetryEvents.find((entry) => (
    entry.eventType === 'checkout_success_page_view' &&
    entry.traceId === 'trace_success_page'
  ));
  assert.ok(successPageView);
  assert.equal(successPageView.acquisitionId, 'acq_success_page');
  assert.equal(successPageView.visitorId, 'visitor_success_page');
  assert.equal(successPageView.sessionId, 'session_success_page');
  assert.equal(successPageView.ctaId, 'pricing_pro');
  assert.equal(successPageView.landingPath, '/pricing');
});

test('cancel page serves retry message and records first-party telemetry', async () => {
  const res = await fetch(apiUrl('/cancel?trace_id=trace_cancel_page&acquisition_id=acq_cancel_page&visitor_id=visitor_cancel_page&session_id=session_cancel_page&install_id=inst_cancel_page&utm_source=google&utm_medium=organic&utm_campaign=seo_launch&cta_id=pricing_pro&cta_placement=pricing&plan_id=pro&landing_path=%2F&referrer_host=www.google.com'));
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

  const telemetryEvents = readJsonl(path.join(tmpFeedbackDir, 'telemetry-pings.jsonl'));
  const cancelPageView = telemetryEvents.find((entry) => (
    entry.eventType === 'checkout_cancel_page_view' &&
    entry.traceId === 'trace_cancel_page'
  ));
  assert.ok(cancelPageView);
  assert.equal(cancelPageView.acquisitionId, 'acq_cancel_page');
  assert.equal(cancelPageView.visitorId, 'visitor_cancel_page');
  assert.equal(cancelPageView.sessionId, 'session_cancel_page');
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

test('lesson search endpoint returns promoted lessons with linked corrective actions', async () => {
  const feedbackLogPath = path.join(tmpFeedbackDir, 'feedback-log.jsonl');
  const memoryLogPath = path.join(tmpFeedbackDir, 'memory-log.jsonl');
  const rulesPath = path.join(tmpFeedbackDir, 'prevention-rules.md');
  const autoGatesPath = path.join(tmpFeedbackDir, 'auto-promoted-gates.json');
  const backups = [
    [feedbackLogPath, fs.existsSync(feedbackLogPath) ? fs.readFileSync(feedbackLogPath, 'utf8') : null],
    [memoryLogPath, fs.existsSync(memoryLogPath) ? fs.readFileSync(memoryLogPath, 'utf8') : null],
    [rulesPath, fs.existsSync(rulesPath) ? fs.readFileSync(rulesPath, 'utf8') : null],
    [autoGatesPath, fs.existsSync(autoGatesPath) ? fs.readFileSync(autoGatesPath, 'utf8') : null],
  ];

  try {
    fs.writeFileSync(feedbackLogPath, `${JSON.stringify({
      id: 'fb_api_lesson',
      signal: 'negative',
      context: 'Skipped rollback proof during release',
      tags: ['release', 'verification'],
      timestamp: '2026-03-23T15:00:00.000Z',
    })}\n`);
    fs.writeFileSync(memoryLogPath, `${JSON.stringify({
      id: 'mem_api_lesson',
      title: 'MISTAKE: Skipped rollback proof during release',
      content: 'What went wrong: Skipped rollback proof during release\nHow to avoid: Attach rollback notes before shipping',
      category: 'error',
      importance: 'high',
      tags: ['feedback', 'negative', 'release', 'verification'],
      sourceFeedbackId: 'fb_api_lesson',
      timestamp: '2026-03-23T15:00:01.000Z',
    })}\n`);
    fs.writeFileSync(rulesPath, '# Rollback proof\nAlways attach rollback notes before shipping.\n');
    fs.writeFileSync(autoGatesPath, JSON.stringify({
      version: 1,
      gates: [{
        id: 'auto-release-verification',
        action: 'warn',
        pattern: 'release+verification',
        message: 'Warn when release verification proof is missing',
        occurrences: 3,
        promotedAt: '2026-03-23T15:10:00.000Z',
      }],
      promotionLog: [],
    }, null, 2));

    const res = await fetch(apiUrl('/v1/lessons/search?q=rollback&limit=5'), { headers: authHeader });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.returned, 1);
    assert.equal(body.results[0].id, 'mem_api_lesson');
    assert.equal(body.results[0].lesson.howToAvoid, 'Attach rollback notes before shipping');
    assert.equal(body.results[0].systemResponse.lifecycle.enforcementState, 'warning');
    assert.equal(body.results[0].systemResponse.linkedPreventionRules[0].title, 'Rollback proof');
    assert.equal(body.results[0].systemResponse.linkedAutoGates[0].id, 'auto-release-verification');
    assert.ok(body.results[0].systemResponse.harnessRecommendations.some((recommendation) => recommendation.type === 'diagnostic_capture'));
  } finally {
    backups.forEach(([filePath, content]) => {
      if (content === null) {
        fs.rmSync(filePath, { force: true });
      } else {
        fs.writeFileSync(filePath, content);
      }
    });
  }
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

test('workflow sprint advance endpoint requires the static admin key', async () => {
  const intakeRes = await fetch(apiUrl('/v1/intake/workflow-sprint'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'advance-auth@example.com',
      workflow: 'Release hardening',
      owner: 'Platform lead',
      blocker: 'Need an admin-only transition path.',
      runtime: 'Claude Code',
    }),
  });
  assert.equal(intakeRes.status, 201);
  const intakeBody = await intakeRes.json();

  const billingKey = billing.provisionApiKey('cus_sprint_non_admin', {
    installId: 'inst_sprint_non_admin',
    source: 'stripe_webhook_checkout_completed',
  }).key;

  const res = await fetch(apiUrl('/v1/intake/workflow-sprint/advance'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${billingKey}`,
    },
    body: JSON.stringify({
      leadId: intakeBody.leadId,
      status: 'qualified',
    }),
  });

  assert.equal(res.status, 403);
});

test('workflow sprint advance endpoint appends pipeline snapshots and workflow run evidence', async () => {
  const intakeRes = await fetch(apiUrl('/v1/intake/workflow-sprint'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'advance@example.com',
      company: 'North Star Systems',
      workflow: 'PR review hardening',
      owner: 'Platform lead',
      blocker: 'Need proof-backed pilot promotion.',
      runtime: 'Claude Code',
      utmSource: 'linkedin',
    }),
  });
  assert.equal(intakeRes.status, 201);
  const intakeBody = await intakeRes.json();

  const qualifiedRes = await fetch(apiUrl('/v1/intake/workflow-sprint/advance'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authHeader,
    },
    body: JSON.stringify({
      leadId: intakeBody.leadId,
      status: 'qualified',
      actor: 'ops',
      note: 'Qualified for pilot review.',
    }),
  });
  assert.equal(qualifiedRes.status, 200);
  const qualifiedBody = await qualifiedRes.json();
  assert.equal(qualifiedBody.ok, true);
  assert.equal(qualifiedBody.lead.status, 'qualified');
  assert.equal(qualifiedBody.workflowRun, null);

  const pilotRes = await fetch(apiUrl('/v1/intake/workflow-sprint/advance'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authHeader,
    },
    body: JSON.stringify({
      leadId: intakeBody.leadId,
      status: 'named_pilot',
      actor: 'ops',
      workflowId: 'pr_review_hardening',
      teamId: 'north_star_systems',
    }),
  });
  assert.equal(pilotRes.status, 200);
  const pilotBody = await pilotRes.json();
  assert.equal(pilotBody.lead.status, 'named_pilot');
  assert.ok(pilotBody.workflowRun);
  assert.equal(pilotBody.workflowRun.customerType, 'named_pilot');

  const proofRes = await fetch(apiUrl('/v1/intake/workflow-sprint/advance'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authHeader,
    },
    body: JSON.stringify({
      leadId: intakeBody.leadId,
      status: 'proof_backed_run',
      actor: 'ops',
      reviewedBy: 'buyer@example.com',
      proofArtifacts: ['docs/VERIFICATION_EVIDENCE.md'],
    }),
  });
  assert.equal(proofRes.status, 200);
  const proofBody = await proofRes.json();
  assert.equal(proofBody.lead.status, 'proof_backed_run');
  assert.ok(proofBody.workflowRun);
  assert.equal(proofBody.workflowRun.proofBacked, true);

  const leads = readJsonl(path.join(tmpFeedbackDir, 'workflow-sprint-leads.jsonl'));
  assert.equal(leads.filter((entry) => entry.leadId === intakeBody.leadId).length, 3 + 1);
  assert.equal(leads.at(-1).status, 'proof_backed_run');
  assert.equal(leads.at(-1).statusHistory.length, 4);

  const runs = readJsonl(path.join(tmpFeedbackDir, 'workflow-runs.jsonl'));
  assert.equal(runs.length >= 2, true);
  assert.equal(runs.at(-1).proofBacked, true);
  assert.equal(runs.at(-1).metadata.leadId, intakeBody.leadId);

  const telemetry = readJsonl(path.join(tmpFeedbackDir, 'telemetry-pings.jsonl'));
  assert.ok(telemetry.some((entry) => (
    entry.eventType === 'workflow_sprint_lead_advanced' &&
    entry.pipelineStatus === 'proof_backed_run'
  )));
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

test('billing summary applies today window query params for admin users', async () => {
  const isolatedFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-api-window-'));
  const savedEnv = {
    feedbackDir: process.env.RLHF_FEEDBACK_DIR,
    apiKeysPath: process.env._TEST_API_KEYS_PATH,
    funnelPath: process.env._TEST_FUNNEL_LEDGER_PATH,
    revenuePath: process.env._TEST_REVENUE_LEDGER_PATH,
    checkoutSessionsPath: process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH,
  };

  process.env.RLHF_FEEDBACK_DIR = isolatedFeedbackDir;
  process.env._TEST_API_KEYS_PATH = path.join(isolatedFeedbackDir, 'api-keys.json');
  process.env._TEST_FUNNEL_LEDGER_PATH = path.join(isolatedFeedbackDir, 'funnel-events.jsonl');
  process.env._TEST_REVENUE_LEDGER_PATH = path.join(isolatedFeedbackDir, 'revenue-events.jsonl');
  process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH = path.join(isolatedFeedbackDir, 'local-checkout-sessions.json');

  try {
    fs.writeFileSync(process.env._TEST_API_KEYS_PATH, JSON.stringify({ keys: {} }, null, 2));
    fs.writeFileSync(process.env._TEST_FUNNEL_LEDGER_PATH, [
      JSON.stringify({
        timestamp: '2026-03-18T23:30:00.000Z',
        stage: 'acquisition',
        event: 'checkout_session_created',
        evidence: 'sess_api_old',
        traceId: 'trace_api_old',
        metadata: {
          customerId: 'cus_api_old',
          source: 'reddit',
          utmCampaign: 'api_window_old',
        },
      }),
      JSON.stringify({
        timestamp: '2026-03-19T14:30:00.000Z',
        stage: 'acquisition',
        event: 'checkout_session_created',
        evidence: 'sess_api_today',
        traceId: 'trace_api_today',
        metadata: {
          customerId: 'cus_api_today',
          source: 'website',
          utmCampaign: 'api_window_today',
        },
      }),
      '',
    ].join('\n'));
    fs.writeFileSync(process.env._TEST_REVENUE_LEDGER_PATH, [
      JSON.stringify({
        timestamp: '2026-03-18T23:30:00.000Z',
        provider: 'stripe',
        event: 'stripe_checkout_completed',
        status: 'paid',
        orderId: 'cs_api_old',
        evidence: 'cs_api_old',
        customerId: 'cus_api_old',
        amountCents: 9900,
        currency: 'USD',
        amountKnown: true,
        recurringInterval: null,
        attribution: {
          source: 'reddit',
          utmCampaign: 'api_window_old',
        },
        metadata: {},
      }),
      JSON.stringify({
        timestamp: '2026-03-19T15:00:00.000Z',
        provider: 'stripe',
        event: 'stripe_checkout_completed',
        status: 'paid',
        orderId: 'cs_api_today',
        evidence: 'cs_api_today',
        customerId: 'cus_api_today',
        amountCents: 4900,
        currency: 'USD',
        amountKnown: true,
        recurringInterval: null,
        attribution: {
          source: 'website',
          utmCampaign: 'api_window_today',
        },
        metadata: {},
      }),
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(isolatedFeedbackDir, 'workflow-sprint-leads.jsonl'), [
      JSON.stringify({
        leadId: 'lead_api_old',
        submittedAt: '2026-03-18T20:00:00.000Z',
        status: 'new',
        offer: 'workflow_hardening_sprint',
        contact: {
          email: 'old-api@example.com',
          company: 'Old API Co',
        },
        qualification: {
          workflow: 'Old workflow',
          owner: 'Old owner',
          blocker: 'Old blocker',
          runtime: 'Claude Code',
          note: null,
        },
        attribution: {
          source: 'reddit',
          utmCampaign: 'api_window_old',
        },
      }),
      JSON.stringify({
        leadId: 'lead_api_today',
        submittedAt: '2026-03-19T16:00:00.000Z',
        status: 'new',
        offer: 'workflow_hardening_sprint',
        contact: {
          email: 'today-api@example.com',
          company: 'Today API Co',
        },
        qualification: {
          workflow: 'Today workflow',
          owner: 'Today owner',
          blocker: 'Today blocker',
          runtime: 'Claude Code',
          note: null,
        },
        attribution: {
          source: 'linkedin',
          utmCampaign: 'api_window_today',
        },
      }),
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(isolatedFeedbackDir, 'telemetry-pings.jsonl'), [
      JSON.stringify({
        receivedAt: '2026-03-18T22:00:00.000Z',
        eventType: 'landing_page_view',
        clientType: 'web',
        acquisitionId: 'acq_api_old',
        visitorId: 'visitor_api_old',
        sessionId: 'session_api_old',
        source: 'reddit',
        page: '/',
      }),
      JSON.stringify({
        receivedAt: '2026-03-19T14:55:00.000Z',
        eventType: 'landing_page_view',
        clientType: 'web',
        acquisitionId: 'acq_api_today',
        visitorId: 'visitor_api_today',
        sessionId: 'session_api_today',
        source: 'website',
        page: '/',
      }),
      '',
    ].join('\n'));

    const res = await fetch(apiUrl('/v1/billing/summary?window=today&timezone=UTC&now=2026-03-19T18:00:00.000Z'), {
      headers: authHeader,
    });
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.window.window, 'today');
    assert.equal(body.window.timeZone, 'UTC');
    assert.equal(body.revenue.bookedRevenueCents, 4900);
    assert.equal(body.revenue.paidOrders, 1);
    assert.equal(body.pipeline.workflowSprintLeads.total, 1);
    assert.equal(body.trafficMetrics.pageViews, 1);
  } finally {
    process.env.RLHF_FEEDBACK_DIR = savedEnv.feedbackDir;
    process.env._TEST_API_KEYS_PATH = savedEnv.apiKeysPath;
    process.env._TEST_FUNNEL_LEDGER_PATH = savedEnv.funnelPath;
    process.env._TEST_REVENUE_LEDGER_PATH = savedEnv.revenuePath;
    process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH = savedEnv.checkoutSessionsPath;
    fs.rmSync(isolatedFeedbackDir, { recursive: true, force: true });
  }
});

test('dashboard applies analytics window query params with live billing truth', async () => {
  const isolatedFeedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlhf-dashboard-window-'));
  const savedEnv = {
    feedbackDir: process.env.RLHF_FEEDBACK_DIR,
    apiKeysPath: process.env._TEST_API_KEYS_PATH,
    funnelPath: process.env._TEST_FUNNEL_LEDGER_PATH,
    revenuePath: process.env._TEST_REVENUE_LEDGER_PATH,
    checkoutSessionsPath: process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH,
  };

  process.env.RLHF_FEEDBACK_DIR = isolatedFeedbackDir;
  process.env._TEST_API_KEYS_PATH = path.join(isolatedFeedbackDir, 'api-keys.json');
  process.env._TEST_FUNNEL_LEDGER_PATH = path.join(isolatedFeedbackDir, 'funnel-events.jsonl');
  process.env._TEST_REVENUE_LEDGER_PATH = path.join(isolatedFeedbackDir, 'revenue-events.jsonl');
  process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH = path.join(isolatedFeedbackDir, 'local-checkout-sessions.json');

  try {
    fs.writeFileSync(process.env._TEST_API_KEYS_PATH, JSON.stringify({ keys: {} }, null, 2));
    fs.writeFileSync(process.env._TEST_FUNNEL_LEDGER_PATH, [
      JSON.stringify({
        timestamp: '2026-03-18T13:00:00.000Z',
        stage: 'acquisition',
        event: 'checkout_session_created',
        evidence: 'sess_dashboard_old',
        metadata: { customerId: 'cus_dashboard_old' },
      }),
      JSON.stringify({
        timestamp: '2026-03-19T14:00:00.000Z',
        stage: 'acquisition',
        event: 'checkout_session_created',
        evidence: 'sess_dashboard_today',
        metadata: { customerId: 'cus_dashboard_today' },
      }),
      '',
    ].join('\n'));
    fs.writeFileSync(process.env._TEST_REVENUE_LEDGER_PATH, [
      JSON.stringify({
        timestamp: '2026-03-18T13:05:00.000Z',
        provider: 'stripe',
        event: 'stripe_checkout_completed',
        status: 'paid',
        orderId: 'cs_dashboard_old',
        evidence: 'cs_dashboard_old',
        customerId: 'cus_dashboard_old',
        amountCents: 9900,
        currency: 'USD',
        amountKnown: true,
        recurringInterval: null,
        attribution: { source: 'reddit' },
        metadata: {},
      }),
      JSON.stringify({
        timestamp: '2026-03-19T14:05:00.000Z',
        provider: 'stripe',
        event: 'stripe_checkout_completed',
        status: 'paid',
        orderId: 'cs_dashboard_today',
        evidence: 'cs_dashboard_today',
        customerId: 'cus_dashboard_today',
        amountCents: 4900,
        currency: 'USD',
        amountKnown: true,
        recurringInterval: null,
        attribution: { source: 'website' },
        metadata: {},
      }),
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(isolatedFeedbackDir, 'workflow-sprint-leads.jsonl'), [
      JSON.stringify({
        leadId: 'lead_dashboard_old',
        submittedAt: '2026-03-18T10:00:00.000Z',
        status: 'new',
        offer: 'workflow_hardening_sprint',
        contact: {
          email: 'old-dashboard@example.com',
          company: 'Old Dashboard Co',
        },
        qualification: {
          workflow: 'Old workflow',
          owner: 'Old owner',
          blocker: 'Old blocker',
          runtime: 'Claude Code',
          note: null,
        },
        attribution: {
          source: 'reddit',
          utmCampaign: 'dashboard_window_old',
        },
      }),
      JSON.stringify({
        leadId: 'lead_dashboard_today',
        submittedAt: '2026-03-19T15:00:00.000Z',
        status: 'new',
        offer: 'workflow_hardening_sprint',
        contact: {
          email: 'today-dashboard@example.com',
          company: 'Today Dashboard Co',
        },
        qualification: {
          workflow: 'Today workflow',
          owner: 'Today owner',
          blocker: 'Today blocker',
          runtime: 'Claude Code',
          note: null,
        },
        attribution: {
          source: 'linkedin',
          utmCampaign: 'dashboard_window_today',
        },
      }),
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(isolatedFeedbackDir, 'telemetry-pings.jsonl'), [
      JSON.stringify({
        receivedAt: '2026-03-18T12:00:00.000Z',
        eventType: 'landing_page_view',
        clientType: 'web',
        acquisitionId: 'acq_dashboard_old',
        visitorId: 'visitor_dashboard_old',
        sessionId: 'session_dashboard_old',
        source: 'reddit',
        page: '/',
      }),
      JSON.stringify({
        receivedAt: '2026-03-19T14:30:00.000Z',
        eventType: 'landing_page_view',
        clientType: 'web',
        acquisitionId: 'acq_dashboard_today',
        visitorId: 'visitor_dashboard_today',
        sessionId: 'session_dashboard_today',
        source: 'website',
        page: '/',
      }),
      '',
    ].join('\n'));
    fs.mkdirSync(path.join(isolatedFeedbackDir, 'contextfs', 'provenance'), { recursive: true });
    fs.writeFileSync(path.join(isolatedFeedbackDir, 'contextfs', 'provenance', 'packs.jsonl'), [
      JSON.stringify({
        packId: 'pack_dashboard_base',
        query: 'verification testing evidence',
        usedChars: 1200,
        createdAt: '2026-03-19T14:00:00.000Z',
        cache: { hit: false },
      }),
      JSON.stringify({
        packId: 'pack_dashboard_hit',
        query: 'testing verification evidence',
        usedChars: 1200,
        createdAt: '2026-03-19T14:01:00.000Z',
        cache: { hit: true, similarity: 1, sourcePackId: 'pack_dashboard_base' },
      }),
      '',
    ].join('\n'));

    const res = await fetch(apiUrl('/v1/dashboard?window=today&timezone=America/New_York&now=2026-03-19T18:00:00.000Z'), {
      headers: authHeader,
    });
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.operational.source, 'live');
    assert.equal(body.analytics.window.window, 'today');
    assert.equal(body.analytics.trafficMetrics.visitors, 1);
    assert.equal(body.analytics.trafficMetrics.pageViews, 1);
    assert.equal(body.analytics.funnel.acquisitionLeads, 1);
    assert.equal(body.analytics.revenue.bookedRevenueCents, 4900);
    assert.equal(body.analytics.revenue.paidOrders, 1);
    assert.equal(body.analytics.efficiency.contextPackRequests, 2);
    assert.equal(body.analytics.efficiency.semanticCacheHits, 1);
    assert.equal(body.analytics.efficiency.estimatedContextTokensReused, 300);
  } finally {
    process.env.RLHF_FEEDBACK_DIR = savedEnv.feedbackDir;
    process.env._TEST_API_KEYS_PATH = savedEnv.apiKeysPath;
    process.env._TEST_FUNNEL_LEDGER_PATH = savedEnv.funnelPath;
    process.env._TEST_REVENUE_LEDGER_PATH = savedEnv.revenuePath;
    process.env._TEST_LOCAL_CHECKOUT_SESSIONS_PATH = savedEnv.checkoutSessionsPath;
    fs.rmSync(isolatedFeedbackDir, { recursive: true, force: true });
  }
});

test('billing summary includes Stripe-reconciled revenue when live processor events are available', async () => {
  process.env._TEST_STRIPE_RECONCILED_REVENUE_EVENTS_JSON = JSON.stringify([
    {
      timestamp: '2025-11-18T10:36:00.000Z',
      provider: 'stripe',
      event: 'stripe_charge_reconciled',
      status: 'paid',
      orderId: 'ch_api_hist_001',
      evidence: 'ch_api_hist_001',
      customerId: 'cus_api_hist_001',
      amountCents: 1000,
      currency: 'USD',
      amountKnown: true,
      recurringInterval: 'month',
      attribution: {
        source: 'stripe_reconciled',
      },
      metadata: {
        stripeReconciled: true,
        priceId: 'price_hist_001',
        productId: 'prod_hist_001',
      },
    },
  ]);

  try {
    const res = await fetch(apiUrl('/v1/billing/summary'), {
      headers: authHeader,
    });
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.ok(body.revenue.bookedRevenueCents >= 1000);
    assert.ok(body.revenue.paidOrders >= 1);
    assert.equal(body.revenue.processorReconciledOrders, 1);
    assert.equal(body.revenue.processorReconciledRevenueCents, 1000);
    assert.equal(body.coverage.providerCoverage.stripe, 'booked_revenue+processor_reconciled');
  } finally {
    delete process.env._TEST_STRIPE_RECONCILED_REVENUE_EVENTS_JSON;
  }
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

test('billing summary rejects invalid analytics window queries', async () => {
  const res = await fetch(apiUrl('/v1/billing/summary?window=bad-window'), {
    headers: authHeader,
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.detail, /Invalid analytics window/i);
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
