'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const landingPagePath = path.join(__dirname, '..', 'public', 'index.html');
const landingPage = fs.readFileSync(landingPagePath, 'utf8');

const HTML_ENTITY_REPLACEMENTS = new Map([
  ['&amp;', '&'],
  ['&quot;', '"'],
  ['&#39;', "'"],
  ['&apos;', "'"],
  ['&mdash;', '—'],
  ['&ndash;', '–'],
  ['&rsquo;', '’'],
  ['&ldquo;', '“'],
  ['&rdquo;', '”'],
]);

function normalizeHtmlText(value) {
  return String(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|quot|#39|apos|mdash|ndash|rsquo|ldquo|rdquo);/g, (entity) => (
      HTML_ENTITY_REPLACEMENTS.get(entity)
    ))
    .replace(/\s+/g, ' ')
    .trim();
}

function visibleBodyText(html) {
  const body = (html.match(/<body\b[^>]*>([\s\S]*?)<\/body\b[^>]*>/i) || [])[1] || '';
  return normalizeHtmlText(body
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, ' '));
}

function parseJsonLd(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script\b[^>]*>/g)]
    .map((match) => JSON.parse(match[1]));
}

function visibleFaqAnswers(html) {
  const entries = [...html.matchAll(
    /<button class="faq-q"[^>]*>([\s\S]*?)<\/button>\s*<div class="faq-a">([\s\S]*?)<\/div>/g
  )];
  return new Map(entries.map(([, question, answer]) => [
    normalizeHtmlText(question),
    normalizeHtmlText(answer),
  ]));
}

test('homepage exposes Pro $19/mo and the $499 Setup Sprint', () => {
  const visibleText = visibleBodyText(landingPage);
  const prices = [...visibleText.matchAll(/\$\d[\d,]*/g)].map((match) => match[0]);
  const uniquePrices = [...new Set(prices)];

  assert.ok(uniquePrices.includes('$19'), `expected $19 among ${uniquePrices.join(', ')}`);
  assert.ok(uniquePrices.includes('$499'), `expected $499 among ${uniquePrices.join(', ')}`);
  assert.equal((landingPage.match(/data-primary-checkout/g) || []).length, 2); // form attr + querySelector
  assert.equal((landingPage.match(/<form[^>]+action="\/go\/diagnostic-pay"/g) || []).length, 1);
  assert.match(landingPage, /method="POST"/);
  assert.match(landingPage, /name="customer_email"[^>]*required/);
  assert.match(landingPage, /name="plan_id" value="sprint_diagnostic"/);
  assert.match(landingPage, /\/go\/pro-direct/);
  assert.match(landingPage, /Start Pro — \$19\/mo/);
  assert.match(landingPage, /Book the \$499 setup/);
  assert.match(landingPage, /data-cta-id="nav_install_free"[^>]*>Install free</);
  assert.match(landingPage, /See the \$499 setup/);
});

test('homepage navbar exposes paid-user Log in drawer and exchanges keys for an HttpOnly session cookie without browser storage', async () => {
  const os = require('node:os');
  const dashboardPage = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.html'), 'utf8');
  assert.match(landingPage, /data-cta-id="nav_paid_login"[^>]*>Log in</);
  assert.match(landingPage, /id="paidLoginBar"/);
  assert.doesNotMatch(landingPage, /ProKey/);
  assert.doesNotMatch(dashboardPage, /ProKey/);
  assert.match(landingPage, /id="paidLoginKeyToggle"[^>]*>Have a Pro license key\?</);
  assert.match(landingPage, /id="paidLoginKeyPanel"\s+hidden\b/);
  assert.match(landingPage, /id="paidLoginKeyInput"/);
  assert.match(landingPage, /id="paidLoginSubmitBtn"/);
  assert.doesNotMatch(dashboardPage, /id="ssoGoogleBtn"/);
  assert.doesNotMatch(dashboardPage, /id="ssoAppleBtn"/);
  assert.doesNotMatch(dashboardPage, /Continue with Google SSO or Apple SSO/);
  assert.match(dashboardPage, /id="dashboardKeyToggle"[^>]*>Have a Pro license key\?</);
  assert.match(dashboardPage, /id="dashboardKeyPanel"\s+hidden\b/);
  assert.match(dashboardPage, /id="apiKey"/);
  assert.match(dashboardPage, /id="connectBtn"/);
  assert.match(dashboardPage, /id="getProBtn"[^>]*href="https:\/\/thumbgate\.ai\/pricing"/);
  assert.match(landingPage, /window\.tgSubmitPaidLogin/);
  assert.match(landingPage, /\/v1\/auth\/session/);
  assert.match(dashboardPage, /\/v1\/auth\/session/);
  assert.doesNotMatch(landingPage, /tg_paid_api_key|localStorage\.setItem|sessionStorage\.setItem/);
  assert.doesNotMatch(dashboardPage, /tg_paid_api_key|localStorage\.setItem\(['"]tg_paid|sessionStorage\.setItem\(['"]tg_paid/);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-paid-auth-session-'));
  const savedEnv = {
    THUMBGATE_API_KEY: process.env.THUMBGATE_API_KEY,
    THUMBGATE_OPERATOR_KEY: process.env.THUMBGATE_OPERATOR_KEY,
    THUMBGATE_FEEDBACK_DIR: process.env.THUMBGATE_FEEDBACK_DIR,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    APPLE_CLIENT_ID: process.env.APPLE_CLIENT_ID,
    APPLE_TEAM_ID: process.env.APPLE_TEAM_ID,
    APPLE_KEY_ID: process.env.APPLE_KEY_ID,
    APPLE_PRIVATE_KEY: process.env.APPLE_PRIVATE_KEY,
  };
  process.env.THUMBGATE_API_KEY = 'tg_admin_test_secret_999';
  process.env.THUMBGATE_OPERATOR_KEY = 'tg_op_test_secret_888';
  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  process.env.STRIPE_SECRET_KEY = '';
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.APPLE_CLIENT_ID;
  delete process.env.APPLE_TEAM_ID;
  delete process.env.APPLE_KEY_ID;
  delete process.env.APPLE_PRIVATE_KEY;

  const crypto = require('node:crypto');
  const { startServer, __test__: serverTestHooks } = require('../src/api/server');
  const handle = await startServer({ port: 0, host: '127.0.0.1' });
  const origin = `http://127.0.0.1:${handle.port}`;
  try {
    const initialRes = await fetch(`${origin}/v1/auth/session`);
    assert.equal(initialRes.status, 200);
    const initialBody = await initialRes.json();
    assert.equal(initialBody.authenticated, false);
    assert.deepEqual(initialBody.ssoProviders, { google: false, apple: false });

    // Unconfigured OAuth providers: buttons hidden on /dashboard and /, route returns 404 (never loopback 302 or cookie)
    const unconfiguredDashRes = await fetch(`${origin}/dashboard`);
    assert.equal(unconfiguredDashRes.status, 200);
    const unconfiguredDashHtml = await unconfiguredDashRes.text();
    assert.doesNotMatch(unconfiguredDashHtml, /ssoGoogleBtn|ssoAppleBtn/);
    assert.match(unconfiguredDashHtml, /id="apiKey"/);
    assert.match(unconfiguredDashHtml, /https:\/\/thumbgate\.ai\/pricing/);
    const dashAuthLinks = [...unconfiguredDashHtml.matchAll(/href="(\/[^"]*(?:auth|sso|oauth|login)[^"]*)"/gi)].map((m) => m[1]);
    for (const relHref of dashAuthLinks) {
      const linkProbe = await fetch(`${origin}${relHref}`, { redirect: 'manual' });
      const loc = linkProbe.headers.get('location') || '';
      assert.doesNotMatch(loc, /^\/dashboard\b/, `dashboard auth link ${relHref} must not redirect back to /dashboard`);
    }

    const unconfiguredHomeRes = await fetch(`${origin}/`);
    assert.equal(unconfiguredHomeRes.status, 200);
    const unconfiguredHomeHtml = await unconfiguredHomeRes.text();
    assert.doesNotMatch(unconfiguredHomeHtml, /googleCloudLoginLink|appleSsoLoginLink/);

    for (const p of ['google', 'apple', 'unsupported']) {
      const sso404 = await fetch(`${origin}/v1/cloud/sso/authorize?provider=${p}`, { redirect: 'manual' });
      assert.equal(sso404.status, 404);
      assert.equal(sso404.headers.get('location'), null);
      assert.equal(sso404.headers.get('set-cookie'), null);
    }

    // Configured Google + Apple OAuth providers: buttons shown only for configured IDs and redirect to real IdPs
    process.env.GOOGLE_CLIENT_ID = 'google-client-test.apps.googleusercontent.com';
    const googleOnlyDashHtml = await (await fetch(`${origin}/dashboard`)).text();
    assert.match(googleOnlyDashHtml, /id="ssoGoogleBtn"[\s\S]*?Continue with Google/);
    assert.doesNotMatch(googleOnlyDashHtml, /id="ssoAppleBtn"/);
    assert.ok(
      googleOnlyDashHtml.indexOf('id="ssoGoogleBtn"') < googleOnlyDashHtml.indexOf('id="dashboardKeyToggle"')
      && googleOnlyDashHtml.indexOf('id="dashboardKeyToggle"') < googleOnlyDashHtml.indexOf('id="apiKey"'),
      'dashboard Log in view must lead with Continue with Google before Have a Pro license key? and key input'
    );
    const googleOnlyHomeHtml = await (await fetch(`${origin}/`)).text();
    assert.match(googleOnlyHomeHtml, /id="googleCloudLoginLink"[\s\S]*?Continue with Google/);
    assert.doesNotMatch(googleOnlyHomeHtml, /id="appleSsoLoginLink"/);
    assert.ok(
      googleOnlyHomeHtml.indexOf('id="googleCloudLoginLink"') < googleOnlyHomeHtml.indexOf('id="paidLoginKeyToggle"')
      && googleOnlyHomeHtml.indexOf('id="paidLoginKeyToggle"') < googleOnlyHomeHtml.indexOf('id="paidLoginKeyInput"'),
      'home Log in bar must lead with Continue with Google before Have a Pro license key? and key input'
    );
    const google302 = await fetch(`${origin}/v1/cloud/sso/authorize?provider=google`, { redirect: 'manual' });
    assert.equal(google302.status, 302);
    assert.match(google302.headers.get('location') || '', /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
    const googleJson = await (await fetch(`${origin}/v1/cloud/sso/authorize?provider=google&format=json`)).json();
    assert.equal(googleJson.mode, 'oauth_redirect');
    assert.equal((await fetch(`${origin}/v1/cloud/sso/authorize?provider=apple`, { redirect: 'manual' })).status, 404);

    process.env.APPLE_CLIENT_ID = 'ai.thumbgate.web.test';
    const bothDashHtml = await (await fetch(`${origin}/dashboard`)).text();
    assert.match(bothDashHtml, /id="ssoGoogleBtn"[\s\S]*?Continue with Google/);
    assert.match(bothDashHtml, /id="ssoAppleBtn"[\s\S]*?Continue with Apple/);
    assert.ok(
      bothDashHtml.indexOf('id="ssoGoogleBtn"') < bothDashHtml.indexOf('id="ssoAppleBtn"')
      && bothDashHtml.indexOf('id="ssoAppleBtn"') < bothDashHtml.indexOf('id="dashboardKeyToggle"'),
      'dashboard must render Continue with Google first and Continue with Apple right after it'
    );
    const bothHomeHtml = await (await fetch(`${origin}/`)).text();
    assert.match(bothHomeHtml, /id="googleCloudLoginLink"[\s\S]*?Continue with Google/);
    assert.match(bothHomeHtml, /id="appleSsoLoginLink"[\s\S]*?Continue with Apple/);
    assert.ok(
      bothHomeHtml.indexOf('id="googleCloudLoginLink"') < bothHomeHtml.indexOf('id="appleSsoLoginLink"')
      && bothHomeHtml.indexOf('id="appleSsoLoginLink"') < bothHomeHtml.indexOf('id="paidLoginKeyToggle"'),
      'home Log in bar must render Continue with Google first and Continue with Apple right after it'
    );
    for (const relHref of [...bothDashHtml.matchAll(/href="(\/[^"]*(?:auth|sso|oauth|login)[^"]*)"/gi)].map((m) => m[1])) {
      const linkProbe = await fetch(`${origin}${relHref}`, { redirect: 'manual' });
      const loc = linkProbe.headers.get('location') || '';
      assert.doesNotMatch(loc, /^\/dashboard\b/, `configured dashboard auth link ${relHref} must not redirect back to /dashboard`);
    }
    const apple302 = await fetch(`${origin}/v1/cloud/sso/authorize?provider=apple`, { redirect: 'manual' });
    assert.equal(apple302.status, 302);
    const appleAuthUrl = new URL(apple302.headers.get('location') || '');
    assert.equal(appleAuthUrl.origin, 'https://appleid.apple.com');
    assert.equal(appleAuthUrl.pathname, '/auth/authorize');
    assert.equal(appleAuthUrl.searchParams.get('response_mode'), 'form_post');
    assert.match(appleAuthUrl.searchParams.get('nonce') || '', /^nc_[a-f0-9]{32}$/);
    const appleRedirectUri = new URL(appleAuthUrl.searchParams.get('redirect_uri') || '');
    assert.equal(appleRedirectUri.protocol, 'https:');
    assert.equal(appleRedirectUri.pathname, '/v1/cloud/sso/apple/callback');
    assert.equal(appleRedirectUri.search, '');
    const appleJson = await (await fetch(`${origin}/v1/cloud/sso/authorize?provider=apple&format=json`)).json();
    assert.equal(appleJson.mode, 'oauth_redirect');
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.APPLE_CLIENT_ID;

    // Google OIDC /v1/cloud/sso/callback end-to-end verification (bad state, missing code, token failure, wrong audience, expired/unverified, and happy path)
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'google-test-kid-1', alg: 'RS256', use: 'sig' };
    const signTestIdToken = (claims, kid = 'google-test-kid-1') => {
      const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url');
      const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
      const sig = crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url');
      return `${h}.${p}.${sig}`;
    };
    process.env.GOOGLE_CLIENT_ID = 'google-client-test.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'google-secret-test-value';
    let lastGoogleSsoCookie = '';
    const issueFreshState = async () => {
      const authRes = await fetch(`${origin}/v1/cloud/sso/authorize?provider=google`, { redirect: 'manual' });
      lastGoogleSsoCookie = (authRes.headers.get('set-cookie') || '').split(';')[0];
      return new URL(authRes.headers.get('location')).searchParams.get('state');
    };
    const googleCbOpts = () => ({ redirect: 'manual', headers: lastGoogleSsoCookie ? { cookie: lastGoogleSsoCookie } : {} });

    // 1. Missing code -> 302 /dashboard?sso_error=missing_code (never 500)
    const missingCodeRes = await fetch(`${origin}/v1/cloud/sso/callback?provider=google`, { redirect: 'manual' });
    assert.equal(missingCodeRes.status, 302);
    assert.equal(missingCodeRes.headers.get('location'), '/dashboard?sso_error=missing_code');
    assert.equal(missingCodeRes.headers.get('set-cookie'), null);

    // 2. Bad state & upstream OAuth denial -> 302 /dashboard?sso_error=invalid_state / oauth_denied
    const badStateRes = await fetch(`${origin}/v1/cloud/sso/callback?provider=google&code=auth_code_1&state=st_bad`, { redirect: 'manual' });
    assert.equal(badStateRes.status, 302);
    assert.equal(badStateRes.headers.get('location'), '/dashboard?sso_error=invalid_state');
    const deniedState = await issueFreshState();
    const deniedRes = await fetch(`${origin}/v1/cloud/sso/callback?provider=google&error=access_denied&state=${deniedState}`, googleCbOpts());
    assert.equal(deniedRes.status, 302);
    assert.equal(deniedRes.headers.get('location'), '/dashboard?sso_error=oauth_denied');
    const unsupportedCb = await fetch(`${origin}/v1/cloud/sso/callback?provider=apple&code=x&state=y`, { redirect: 'manual' });
    assert.equal(unsupportedCb.headers.get('location'), '/dashboard?sso_error=unsupported_provider');

    // 3. Token exchange failure -> 302 /dashboard?sso_error=token_exchange_failed
    serverTestHooks.setGoogleOAuthFetchForTests(async (url) => {
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return { ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) };
      }
      return { ok: true, status: 200, json: async () => ({ keys: [publicJwk] }) };
    });
    const failState = await issueFreshState();
    const tokenFailRes = await fetch(`${origin}/v1/cloud/sso/callback?provider=google&code=bad_code&state=${failState}`, googleCbOpts());
    assert.equal(tokenFailRes.status, 302);
    assert.equal(tokenFailRes.headers.get('location'), '/dashboard?sso_error=token_exchange_failed');
    // Replaying consumed state must fail closed
    const replayFailRes = await fetch(`${origin}/v1/cloud/sso/callback?provider=google&code=bad_code&state=${failState}`, googleCbOpts());
    assert.equal(replayFailRes.headers.get('location'), '/dashboard?sso_error=invalid_state');

    // 4. Wrong audience, invalid issuer, expired token, and unverified email -> 302 /dashboard?sso_error=<reason>
    const nowSec = Math.floor(Date.now() / 1000);
    let capturedTokenPostBody = '';
    const mockGoogleJwt = (jwt) => serverTestHooks.setGoogleOAuthFetchForTests(async (url, opts) => (
      String(url) === 'https://oauth2.googleapis.com/token'
        ? (capturedTokenPostBody = String(opts?.body || ''), { ok: true, status: 200, json: async () => ({ access_token: 'ya29.test', id_token: jwt }) })
        : { ok: true, status: 200, json: async () => ({ keys: [publicJwk] }) }
    ));
    const invalidCases = [
      [{ iss: 'https://accounts.google.com', aud: 'other-app.apps.googleusercontent.com', exp: nowSec + 300, email: 'user@example.com', email_verified: true, sub: 'sub_1' }, 'wrong_audience'],
      [{ iss: 'https://evil.example.com', aud: 'google-client-test.apps.googleusercontent.com', exp: nowSec + 300, email: 'user@example.com', email_verified: true, sub: 'sub_1' }, 'invalid_issuer'],
      [{ iss: 'accounts.google.com', aud: 'google-client-test.apps.googleusercontent.com', exp: nowSec - 10, email: 'user@example.com', email_verified: true, sub: 'sub_1' }, 'expired_token'],
      [{ iss: 'accounts.google.com', aud: 'google-client-test.apps.googleusercontent.com', exp: nowSec + 300, email: 'user@example.com', email_verified: false, sub: 'sub_1' }, 'unverified_email'],
    ];
    for (const [claims, expected] of invalidCases) {
      mockGoogleJwt(signTestIdToken(claims));
      const st = await issueFreshState();
      const r = await fetch(`${origin}/v1/cloud/sso/callback?provider=google&code=code_ok&state=${st}`, googleCbOpts());
      assert.equal(r.status, 302);
      assert.equal(r.headers.get('location'), `/dashboard?sso_error=${expected}`);
      assert.equal(r.headers.get('set-cookie'), null);
    }

    // 5a. Unsubscribed Google user -> authenticated: true, tier: 'Free' (never Pro!), /v1/feedback/stats denied
    const { provisionApiKey } = require('../scripts/billing');
    const makeUserJwt = (email, sub) => signTestIdToken({
      iss: 'https://accounts.google.com',
      aud: 'google-client-test.apps.googleusercontent.com',
      exp: nowSec + 600,
      email,
      email_verified: true,
      sub,
    });
    mockGoogleJwt(makeUserJwt('stranger@gmail.com', 'google_stranger_001'));
    const freeSt = await issueFreshState();
    const freeCbRes = await fetch(`${origin}/v1/cloud/sso/callback?provider=google&code=valid_google_code&state=${freeSt}`, googleCbOpts());
    assert.equal(freeCbRes.status, 302);
    assert.equal(freeCbRes.headers.get('location'), '/dashboard');
    assert.match(capturedTokenPostBody, /code=valid_google_code/);
    assert.match(capturedTokenPostBody, /client_secret=google-secret-test-value/);
    const freeCookiePair = (freeCbRes.headers.get('set-cookie') || '').split(';')[0];
    const freeSessionCheck = await (await fetch(`${origin}/v1/auth/session`, { headers: { cookie: freeCookiePair } })).json();
    assert.equal(freeSessionCheck.authenticated, true);
    assert.equal(freeSessionCheck.tier, 'Free');
    assert.equal(freeSessionCheck.ssoProvider, 'google');
    assert.equal(freeSessionCheck.ssoEmail, 'stranger@gmail.com');
    assert.equal((await fetch(`${origin}/v1/feedback/stats`, { headers: { cookie: freeCookiePair } })).status, 401);

    // 5c. Owner email without paid entitlement stays Free via Google SSO alone
    mockGoogleJwt(makeUserJwt('iganapolsky@gmail.com', 'google_owner_unpaid'));
    const ownerSt = await issueFreshState();
    const ownerCbRes = await fetch(`${origin}/v1/cloud/sso/callback?provider=google&code=owner_code&state=${ownerSt}`, googleCbOpts());
    const ownerSession = await (await fetch(`${origin}/v1/auth/session`, { headers: { cookie: (ownerCbRes.headers.get('set-cookie') || '').split(';')[0] } })).json();
    assert.equal(ownerSession.authenticated, true);
    assert.equal(ownerSession.tier, 'Free');

    // 5b. Subscribed Google user -> tier 'Pro' and survives redeploy
    provisionApiKey('cus_paid_subscriber_1', { customerEmail: 'subscriber@thumbgate.ai', entitlementKind: 'subscription', subscriptionId: 'sub_live_test_1', source: 'stripe_webhook_checkout_completed' });
    mockGoogleJwt(makeUserJwt('subscriber@thumbgate.ai', 'google_uid_sub_1'));
    const goodState = await issueFreshState();
    const goodCbRes = await fetch(`${origin}/v1/cloud/sso/callback?provider=google&code=sub_google_code&state=${goodState}`, googleCbOpts());
    assert.equal(goodCbRes.status, 302);
    assert.equal(goodCbRes.headers.get('location'), '/dashboard');
    const ssoCookieHeader = goodCbRes.headers.get('set-cookie') || '';
    assert.match(ssoCookieHeader, /^thumbgate_auth_session=[a-f0-9]{64};.*HttpOnly.*Secure/);
    const ssoCookiePair = ssoCookieHeader.split(';')[0];
    const ssoSessionCheck = await (await fetch(`${origin}/v1/auth/session`, { headers: { cookie: ssoCookiePair } })).json();
    assert.equal(ssoSessionCheck.authenticated, true);
    assert.equal(ssoSessionCheck.tier, 'Pro');
    assert.equal(ssoSessionCheck.ssoEmail, 'subscriber@thumbgate.ai');
    assert.equal((await fetch(`${origin}/v1/feedback/stats`, { headers: { cookie: ssoCookiePair } })).status, 200);
    serverTestHooks.clearInMemoryAuthSessionsForTests();
    const persistedSessionCheck = await (await fetch(`${origin}/v1/auth/session`, { headers: { cookie: ssoCookiePair } })).json();
    assert.equal(persistedSessionCheck.tier, 'Pro');
    assert.equal((await (await fetch(`${origin}/v1/auth/session`, { headers: { cookie: freeCookiePair } })).json()).tier, 'Free');
    const rawSessionFile = fs.readFileSync(path.join(tmpDir, 'auth-sessions.json'), 'utf8');
    assert.doesNotMatch(rawSessionFile, /tg_|thumbgate_auth_session|google-secret-test-value/);
    for (const storedKey of Object.keys(JSON.parse(rawSessionFile))) assert.match(storedKey, /^[a-f0-9]{64}$/);
    const replayGoodState = await fetch(`${origin}/v1/cloud/sso/callback?provider=google&code=sub_google_code&state=${goodState}`, googleCbOpts());
    assert.equal(replayGoodState.headers.get('location'), '/dashboard?sso_error=invalid_state');
    const unboundGoogleState = await issueFreshState();
    const unboundGoogleRes = await fetch(`${origin}/v1/cloud/sso/callback?provider=google&code=sub_google_code&state=${unboundGoogleState}`, { redirect: 'manual' });
    assert.equal(unboundGoogleRes.headers.get('location'), '/dashboard?sso_error=invalid_state');
    serverTestHooks.setGoogleOAuthFetchForTests(null);
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;

    // Apple Sign-In POST /v1/cloud/sso/apple/callback end-to-end verification (local EC key, ES256 client_secret, JWKS verify, 303 cookie, Free vs Pro, and error cases)
    const appleClientKeyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const applePrivatePemEscaped = appleClientKeyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }).replace(/\n/g, '\\n');
    const appleIdpKeyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const wrongAppleIdpKeyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const appleIdpJwk = { ...appleIdpKeyPair.publicKey.export({ format: 'jwk' }), kid: 'apple-jwks-ec-1', alg: 'ES256', use: 'sig' };
    const signAppleIdToken = (claims, key = appleIdpKeyPair.privateKey, kid = 'apple-jwks-ec-1') => {
      const h = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid })).toString('base64url');
      const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
      const s = crypto.sign('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
      return `${h}.${p}.${s}`;
    };
    const postAppleForm = (fields, extraHeaders = { origin: 'https://appleid.apple.com' }) => fetch(`${origin}/v1/cloud/sso/apple/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...extraHeaders },
      body: new URLSearchParams(fields).toString(),
      redirect: 'manual',
    });
    assert.equal((await fetch(`${origin}/v1/cloud/sso/apple/callback`, { redirect: 'manual' })).status, 405);

    process.env.APPLE_CLIENT_ID = 'ai.thumbgate.web.test';
    const issueAppleAuth = async () => {
      const r = await fetch(`${origin}/v1/cloud/sso/authorize?provider=apple`, { redirect: 'manual' });
      const u = new URL(r.headers.get('location'));
      return { state: u.searchParams.get('state'), nonce: u.searchParams.get('nonce'), redirectUri: u.searchParams.get('redirect_uri') };
    };

    // A1. Missing env (APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY absent) -> 303 sso_not_configured
    const missingEnvAuth = await issueAppleAuth();
    const missingEnvRes = await postAppleForm({ code: 'apple_code_env', state: missingEnvAuth.state });
    assert.equal(missingEnvRes.status, 303);
    assert.equal(missingEnvRes.headers.get('location'), '/dashboard?sso_error=sso_not_configured');
    assert.equal(missingEnvRes.headers.get('set-cookie'), null);

    process.env.APPLE_TEAM_ID = 'TEAM99TEST';
    process.env.APPLE_KEY_ID = 'KEY88TEST1';
    process.env.APPLE_PRIVATE_KEY = applePrivatePemEscaped;

    // A2. Bad state, missing code, and oauth_denied -> 303 error redirects
    const appleBadStateRes = await postAppleForm({ code: 'apple_code_1', state: 'st_wrong_apple' });
    assert.equal(appleBadStateRes.status, 303);
    assert.equal(appleBadStateRes.headers.get('location'), '/dashboard?sso_error=invalid_state');
    const appleNoCode = await issueAppleAuth();
    assert.equal((await postAppleForm({ state: appleNoCode.state })).headers.get('location'), '/dashboard?sso_error=missing_code');
    const appleDenied = await issueAppleAuth();
    assert.equal((await postAppleForm({ error: 'user_cancelled_authorize', state: appleDenied.state })).headers.get('location'), '/dashboard?sso_error=oauth_denied');

    let nextAppleIdToken = '';
    let verifiedClientSecretClaims = null;
    let capturedAppleTokenParams = null;
    serverTestHooks.setAppleOAuthFetchForTests(async (url, opts) => {
      if (String(url) === 'https://appleid.apple.com/auth/token') {
        capturedAppleTokenParams = new URLSearchParams(String(opts?.body || ''));
        const csParts = (capturedAppleTokenParams.get('client_secret') || '').split('.');
        assert.equal(csParts.length, 3);
        const csHeader = JSON.parse(Buffer.from(csParts[0], 'base64url').toString('utf8'));
        const csPayload = JSON.parse(Buffer.from(csParts[1], 'base64url').toString('utf8'));
        assert.equal(csHeader.alg, 'ES256');
        assert.equal(csHeader.kid, 'KEY88TEST1');
        assert.equal(
          crypto.verify('sha256', Buffer.from(`${csParts[0]}.${csParts[1]}`), { key: appleClientKeyPair.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(csParts[2], 'base64url')),
          true,
        );
        verifiedClientSecretClaims = csPayload;
        return { ok: true, status: 200, json: async () => ({ access_token: 'apple_at_1', id_token: nextAppleIdToken }) };
      }
      assert.equal(String(url), 'https://appleid.apple.com/auth/keys');
      return { ok: true, status: 200, json: async () => ({ keys: [appleIdpJwk] }) };
    });

    // A3. Bad signature, wrong aud, expired token, invalid issuer, and mismatched nonce -> 303 error redirects, no cookie
    const badSigAuth = await issueAppleAuth();
    nextAppleIdToken = signAppleIdToken({
      iss: 'https://appleid.apple.com',
      aud: 'ai.thumbgate.web.test',
      exp: nowSec + 600,
      nonce: badSigAuth.nonce,
      email: 'user@privaterelay.appleid.com',
      email_verified: 'true',
      sub: 'apple_sub_bad_sig',
    }, wrongAppleIdpKeyPair.privateKey);
    const badSigRes = await postAppleForm({ code: 'code_badsig', state: badSigAuth.state });
    assert.equal(badSigRes.status, 303);
    assert.equal(badSigRes.headers.get('location'), '/dashboard?sso_error=invalid_signature');
    assert.equal(badSigRes.headers.get('set-cookie'), null);

    const appleInvalidCases = [
      [(n) => ({ iss: 'https://appleid.apple.com', aud: 'com.other.service', exp: nowSec + 600, nonce: n, email: 'u@icloud.com', email_verified: 'true', sub: 's1' }), 'wrong_audience'],
      [(n) => ({ iss: 'https://appleid.apple.com', aud: 'ai.thumbgate.web.test', exp: nowSec - 30, nonce: n, email: 'u@icloud.com', email_verified: 'true', sub: 's1' }), 'expired_token'],
      [(n) => ({ iss: 'https://evil.example.com', aud: 'ai.thumbgate.web.test', exp: nowSec + 600, nonce: n, email: 'u@icloud.com', email_verified: 'true', sub: 's1' }), 'invalid_issuer'],
      [() => ({ iss: 'https://appleid.apple.com', aud: 'ai.thumbgate.web.test', exp: nowSec + 600, nonce: 'nc_tampered', email: 'u@icloud.com', email_verified: 'true', sub: 's1' }), 'invalid_nonce'],
    ];
    for (const [buildClaims, expectedErr] of appleInvalidCases) {
      const a = await issueAppleAuth();
      nextAppleIdToken = signAppleIdToken(buildClaims(a.nonce));
      const r = await postAppleForm({ code: 'code_invalid_claim', state: a.state });
      assert.equal(r.status, 303);
      assert.equal(r.headers.get('location'), `/dashboard?sso_error=${expectedErr}`);
      assert.equal(r.headers.get('set-cookie'), null);
    }

    // A4. Good sign-in: Free private-relay user on first sign-in (with `user` JSON) -> 303 + SameSite=Lax cookie + sso_free
    const freeAppleAuth = await issueAppleAuth();
    nextAppleIdToken = signAppleIdToken({
      iss: 'https://appleid.apple.com',
      aud: 'ai.thumbgate.web.test',
      exp: nowSec + 600,
      nonce: freeAppleAuth.nonce,
      email: 'relay-free-1@privaterelay.appleid.com',
      email_verified: 'true',
      is_private_email: 'true',
      sub: '001122.free_relay_user',
    });
    const freeAppleRes = await postAppleForm({
      code: 'valid_apple_code_free',
      state: freeAppleAuth.state,
      id_token: nextAppleIdToken,
      user: JSON.stringify({ name: { firstName: 'Ada', lastName: 'Lovelace' }, email: 'subscriber@thumbgate.ai' }),
    });
    assert.equal(freeAppleRes.status, 303);
    assert.equal(freeAppleRes.headers.get('location'), '/dashboard');
    assert.equal(verifiedClientSecretClaims.iss, 'TEAM99TEST');
    assert.equal(verifiedClientSecretClaims.sub, 'ai.thumbgate.web.test');
    assert.equal(verifiedClientSecretClaims.aud, 'https://appleid.apple.com');
    assert.ok(verifiedClientSecretClaims.exp > verifiedClientSecretClaims.iat && (verifiedClientSecretClaims.exp - verifiedClientSecretClaims.iat) <= 180 * 86400);
    assert.equal(capturedAppleTokenParams.get('redirect_uri'), freeAppleAuth.redirectUri);
    const freeAppleCookieHeader = freeAppleRes.headers.get('set-cookie') || '';
    assert.match(freeAppleCookieHeader, /^thumbgate_auth_session=[a-f0-9]{64};.*SameSite=Lax.*HttpOnly.*Secure/);
    const freeAppleCookie = freeAppleCookieHeader.split(';')[0];
    const freeAppleSession = await (await fetch(`${origin}/v1/auth/session`, { headers: { cookie: freeAppleCookie } })).json();
    assert.equal(freeAppleSession.authenticated, true);
    assert.equal(freeAppleSession.tier, 'Free');
    assert.equal(freeAppleSession.ssoProvider, 'apple');
    assert.equal(freeAppleSession.ssoEmail, 'relay-free-1@privaterelay.appleid.com');
    assert.equal((await fetch(`${origin}/v1/feedback/stats`, { headers: { cookie: freeAppleCookie } })).status, 401);

    // Replaying consumed Apple state must fail closed
    assert.equal((await postAppleForm({ code: 'valid_apple_code_free', state: freeAppleAuth.state })).headers.get('location'), '/dashboard?sso_error=invalid_state');

    // A5. Subscribed Apple private-relay user -> tier 'Pro' and survives redeploy
    provisionApiKey('cus_paid_apple_relay_1', {
      customerEmail: 'relay-pro@privaterelay.appleid.com',
      entitlementKind: 'subscription',
      subscriptionId: 'sub_apple_live_1',
      source: 'stripe_webhook_checkout_completed',
    });
    const proAppleAuth = await issueAppleAuth();
    nextAppleIdToken = signAppleIdToken({
      iss: 'https://appleid.apple.com',
      aud: 'ai.thumbgate.web.test',
      exp: nowSec + 600,
      nonce: proAppleAuth.nonce,
      email: 'relay-pro@privaterelay.appleid.com',
      email_verified: true,
      is_private_email: true,
      sub: '001122.pro_relay_user',
    });
    const proAppleRes = await postAppleForm({ code: 'valid_apple_code_pro', state: proAppleAuth.state });
    assert.equal(proAppleRes.status, 303);
    const proAppleCookie = (proAppleRes.headers.get('set-cookie') || '').split(';')[0];
    serverTestHooks.clearInMemoryAuthSessionsForTests();
    const proAppleSession = await (await fetch(`${origin}/v1/auth/session`, { headers: { cookie: proAppleCookie } })).json();
    assert.equal(proAppleSession.authenticated, true);
    assert.equal(proAppleSession.tier, 'Pro');
    assert.equal(proAppleSession.ssoProvider, 'apple');
    assert.equal(proAppleSession.ssoEmail, 'relay-pro@privaterelay.appleid.com');
    assert.equal((await fetch(`${origin}/v1/feedback/stats`, { headers: { cookie: proAppleCookie } })).status, 200);

    // A6. Login CSRF protection: cross-site non-Apple Origin and missing Origin must fail closed with 303 invalid_origin
    const evilOriginAuth = await issueAppleAuth();
    const evilOriginRes = await postAppleForm({ code: 'attacker_code', state: evilOriginAuth.state }, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' });
    assert.equal(evilOriginRes.status, 303);
    assert.equal(evilOriginRes.headers.get('location'), '/dashboard?sso_error=invalid_origin');
    assert.equal(evilOriginRes.headers.get('set-cookie'), null);
    const noOriginAuth = await issueAppleAuth();
    const noOriginRes = await fetch(`${origin}/v1/cloud/sso/apple/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: 'attacker_code', state: noOriginAuth.state }).toString(),
      redirect: 'manual',
    });
    assert.equal(noOriginRes.status, 303);
    assert.equal(noOriginRes.headers.get('location'), '/dashboard?sso_error=invalid_origin');

    serverTestHooks.setAppleOAuthFetchForTests(null);
    delete process.env.APPLE_CLIENT_ID;
    delete process.env.APPLE_TEAM_ID;
    delete process.env.APPLE_KEY_ID;
    delete process.env.APPLE_PRIVATE_KEY;
    const badJsonRes = await fetch(`${origin}/v1/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad',
    });
    assert.equal(badJsonRes.status, 400);

    const methodNotAllowedRes = await fetch(`${origin}/v1/auth/session`, { method: 'PUT' });
    assert.equal(methodNotAllowedRes.status, 405);

    const invalidRes = await fetch(`${origin}/v1/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: 'wrong_key' }),
    });
    assert.equal(invalidRes.status, 401);
    assert.equal(invalidRes.headers.get('set-cookie'), null);

    const loginRes = await fetch(`${origin}/v1/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiKey: 'tg_op_test_secret_888' }),
    });
    assert.equal(loginRes.status, 200);
    const setCookie = loginRes.headers.get('set-cookie') || '';
    assert.match(setCookie, /^thumbgate_auth_session=[a-f0-9]{64};/);
    assert.match(setCookie, /\bHttpOnly\b/);
    assert.match(setCookie, /\bSecure\b/);
    assert.match(setCookie, /\bSameSite=Lax\b/);
    assert.ok(!setCookie.includes('tg_op_test_secret_888'), 'raw key must never appear in Set-Cookie');

    const cookiePair = setCookie.split(';')[0];
    const checkRes = await fetch(`${origin}/v1/auth/session`, {
      headers: { cookie: cookiePair },
    });
    assert.equal(checkRes.status, 200);
    const checkBody = await checkRes.json();
    assert.equal(checkBody.authenticated, true);
    assert.equal(checkBody.tier, 'Enterprise');

    const statsRes = await fetch(`${origin}/v1/feedback/stats`, {
      headers: { cookie: cookiePair },
    });
    assert.equal(statsRes.status, 200);

    const logoutRes = await fetch(`${origin}/v1/auth/session`, {
      method: 'DELETE',
      headers: { cookie: cookiePair },
    });
    assert.equal(logoutRes.status, 200);
    assert.match(logoutRes.headers.get('set-cookie') || '', /\bMax-Age=0\b/);

    const afterLogoutRes = await fetch(`${origin}/v1/feedback/stats`, {
      headers: { cookie: cookiePair },
    });
    assert.equal(afterLogoutRes.status, 401);
  } finally {
    await new Promise((resolve) => handle.server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('visible text filtering consumes the complete script and style end tags', () => {
  const html = '<body>shown<script>hidden</script\t\n data-test>after<style>hidden</style extra>done</body>';
  assert.equal(visibleBodyText(html), 'shown after done');
});

test('homepage keeps conversion noise off while offering both paid paths', () => {
  assert.match(landingPage, /id="workflow-sprint-intake"[^>]*data-legacy-intake-alias/);
  assert.doesNotMatch(landingPage, /Enterprise pilot|newsletter/i);
  assert.doesNotMatch(landingPage, /offer-router|sticky-cta|buyer-intent\.js|revenue-assist-panel/i);
  assert.match(landingPage, /<body data-revenue-assist="off">/);
});

test('homepage names the installers that ship', () => {
  const installPage = fs.readFileSync(path.join(__dirname, '..', 'public', 'install.html'), 'utf8');
  assert.match(landingPage, /aria-label="Install ThumbGate"/);
  assert.match(landingPage, /title="npx thumbgate init --agent claude">Claude</);
  assert.match(landingPage, /href="\/install" title="[^"]*init --agent cursor[^"]*">Cursor</);
  assert.match(landingPage, /marketplace\.visualstudio\.com\/items\?itemName=igorganapolsky\.thumbgate/);
  assert.match(landingPage, /title="npx thumbgate init --agent codex">Codex</);
  assert.match(landingPage, /href="\/install#grok" title="grok mcp add thumbgate -- npx -y thumbgate mcp">Grok</);
  assert.match(landingPage, /href="\/install#hermes" title="[^"]*hermes-gate">Hermes</);
  assert.doesNotMatch(landingPage, /Cursor Marketplace listing is not live/);
  assert.doesNotMatch(landingPage, /thumbgate@1\.39\.0 init/);
  assert.doesNotMatch(landingPage, /Muse/);
  assert.match(installPage, /init --agent claude/);
  assert.match(installPage, /The public Cursor Marketplace listing is not live/);
  assert.match(installPage, /hermes-gate/);
  assert.match(installPage, /grok mcp add thumbgate/);
  assert.match(installPage, /id="grok"/);
  assert.match(installPage, /id="hermes"/);
});

test('homepage stays human-scannable instead of becoming a product monorepo', () => {
  const visibleText = visibleBodyText(landingPage);
  const words = visibleText.split(/\s+/).filter(Boolean);
  const h2Count = (landingPage.match(/<h2\b/g) || []).length;
  const h3Count = (landingPage.match(/<h3\b/g) || []).length;

  assert.ok(words.length <= 1100, `visible homepage is ${words.length} words`);
  assert.ok(h2Count <= 8, `homepage has ${h2Count} H2 headings`);
  assert.ok(h3Count <= 10, `homepage has ${h3Count} H3 headings`);
  for (const jargon of ['Thompson Sampling', 'DPO', 'LanceDB', 'ContextFS', 'MemAlign', 'FTS5']) {
    // DPO may appear in Pro bullets intentionally — only ban heavy infra jargon
    if (jargon === 'DPO') continue;
    assert.doesNotMatch(visibleText, new RegExp(jargon, 'i'));
  }
});

test('hero makes the approved supported-workflow offer primary without removing free evaluation', () => {
  const hero = landingPage.slice(landingPage.indexOf('<!-- HERO -->'), landingPage.indexOf('</section>', landingPage.indexOf('<!-- HERO -->')));
  assert.match(hero, /<h1>One repeated agent mistake\. One configured gate\.<\/h1>/);
  assert.match(hero, /supported hook integrations/);
  assert.match(hero, /\$499 Setup Sprint/);
  assert.match(hero, /href="\/diagnostic#intake"[^>]*>Check my workflow fit</);
  assert.match(hero, /Evaluate the free local runtime/);
  assert.match(hero, /npx thumbgate init/);
  assert.doesNotMatch(hero, /Start Pro/);
  assert.ok(landingPage.indexOf('id="pro"') > landingPage.indexOf('id="proof"'));
});

test('how-it-works sells the self-improving loop, not a static allowlist', () => {
  assert.match(landingPage, /Pre-action checks—and the systems that refine them/i);
  assert.match(landingPage, /Lessons are re-ranked per action/i);
  assert.match(landingPage, /repeated failures can promote into gates/i);
  assert.match(landingPage, /stale auto-promoted gates expire/i);
  assert.match(landingPage, /under your control/i);
  assert.match(landingPage, /silently rewriting policy|does not silently rewrite/i);
  assert.match(landingPage, /firewall improves from explicit feedback without retraining the model/i);
  assert.match(landingPage, /source\s+core protection · strict mode/i);
});

test('homepage explains the product with one four-stage self-improving loop', () => {
  assert.match(landingPage, /id="how-it-works"/);
  assert.match(landingPage, /Capture feedback/);
  assert.match(landingPage, /Remember locally/);
  assert.match(landingPage, /Rank and refine/);
  assert.match(landingPage, /Gate the next action/);
  assert.match(landingPage, />ALLOW</);
  assert.match(landingPage, />WARN</);
  assert.match(landingPage, />DENY</);
  assert.match(landingPage, /Each reviewed outcome closes the loop/);
  assert.match(landingPage, /data-loop-step="1"/);
  assert.match(landingPage, /data-loop-step="4"/);
  assert.match(landingPage, /id="loop-panel"/);
  assert.match(landingPage, /Under the hood/);
  assert.match(landingPage, /initLoopDemos|data-loop-step/);
  assert.match(landingPage, /THUMBGATE_STRICT_ENFORCEMENT|warn-by-default/);
  // Valid interactive cards: div[role=tab], not <button> wrapping <h3>/<div>
  // (invalid nesting auto-closes the control and breaks clicks in browsers).
  assert.match(landingPage, /<div class="loop-step" role="tab" tabindex="0"/);
  assert.doesNotMatch(landingPage, /<button[^>]*class="loop-step"/);
});

test('paid wedge includes managed implementation, regression, and rollout proof', () => {
  assert.match(landingPage, /Setup Sprint/);
  assert.match(landingPage, /Book the \$499 setup/);
  assert.match(landingPage, /One configured local gate \+ regression test|One configured local gate and its regression test/);
  assert.match(landingPage, /Delivery within two business days after access and agreed materials are available, subject to confirmed scheduling/);
  assert.match(landingPage, /If the workflow cannot be reduced to one supported gate, the order is refunded/);
  assert.match(landingPage, /Multi-system implementation[\s\S]*require separate scope/);
});

test('enforcement promise distinguishes default denies from strict-mode blocks', () => {
  assert.match(landingPage, /Detected secret exfiltration[\s\S]*denied by default/i);
  assert.match(landingPage, /Matching destructive actions warn by default and deny in strict mode/i);
  assert.match(landingPage, /not a claim that every free install blocks every risky command automatically/i);
  assert.match(landingPage, /mode\s+strict enforcement[\s\S]*decision\s+<span class="red">DENY<\/span>/i);
});

test('FAQPage JSON-LD matches the five visible buyer questions', () => {
  const jsonLd = parseJsonLd(landingPage);
  const faqSchema = jsonLd.find((document) => document['@type'] === 'FAQPage');
  const visibleFaq = visibleFaqAnswers(landingPage);

  assert.ok(jsonLd.some((document) => document['@type'] === 'SoftwareApplication'));
  assert.ok(jsonLd.some((document) => document['@type'] === 'Service'));
  assert.ok(faqSchema);
  assert.equal(faqSchema.mainEntity.length, 5);
  assert.equal(visibleFaq.size, 5);
  for (const entity of faqSchema.mainEntity) {
    const question = normalizeHtmlText(entity.name);
    const answer = normalizeHtmlText(entity.acceptedAnswer.text);
    assert.equal(visibleFaq.get(question), answer, `FAQ drift: ${question}`);
  }
});

test('checkout intent keeps first-party, Plausible, and optional GA4 telemetry', () => {
  assert.match(landingPage, /function sendFirstPartyTelemetry/);
  assert.match(landingPage, /\/v1\/telemetry\/ping/);
  assert.doesNotMatch(landingPage, /\/v1\/telemetry\/event/);
  assert.match(landingPage, /window\.plausible\('checkout_start'/);
  assert.match(landingPage, /sendGa4Event\('begin_checkout'/);
  assert.match(landingPage, /sendFirstPartyTelemetry\('checkout_start'/);
  assert.match(landingPage, /planId: 'sprint_diagnostic'/);
  assert.match(landingPage, /const serverTelemetryCaptured = '__SERVER_TELEMETRY_CAPTURED__' === 'true'/);
});

test('homepage preserves brand, version, repository, and deployment placeholders', () => {
  assert.match(landingPage, /class="nav-logo"[^>]*>[\s\S]*src="\/assets\/brand\/thumbgate-mark-inline-v3\.svg"/);
  assert.match(landingPage, /<span class="logo-text">ThumbGate<\/span>/);
  assert.match(landingPage, /<link rel="icon"[^>]*href="\/thumbgate-icon\.png"/);
  assert.match(landingPage, /<meta name="thumbgate-version" content="\d+\.\d+\.\d+">/);
  assert.match(landingPage, /MIT License · npm v\d+\.\d+\.\d+/);
  assert.match(landingPage, /https:\/\/github\.com\/IgorGanapolsky\/ThumbGate/);
  assert.match(landingPage, /__GOOGLE_SITE_VERIFICATION_META__/);
  assert.match(landingPage, /__GA_BOOTSTRAP__/);
  assert.doesNotMatch(landingPage, /Math\.random\(/);
});

test('homepage features thumbs branding and self-improving diagrams above the fold story', () => {
  const heroSvg = fs.readFileSync(path.join(__dirname, '..', 'public/assets/diagrams/hero-thumbs.svg'), 'utf8');
  assert.match(landingPage, /class="hero-thumbs"/);
  assert.match(landingPage, /id="thumb-glyph"/);
  assert.match(landingPage, /class="hero-thumb-up"/);
  assert.match(landingPage, /id="hero-thumb-down"/);
  assert.match(landingPage, /Illustrative example, not a recorded result/);
  assert.match(landingPage, /Matching destructive actions warn by default/);
  assert.doesNotMatch(landingPage, /every install|3 negatives, then strict mode|Deny needs strict mode, or three/);
  assert.match(landingPage, /data-cta-placement="offers"/);
  assert.match(landingPage, /name="cta_placement" value="offers"/);
  assert.match(landingPage, /scroll-margin-top: 92px/);
  assert.doesNotMatch(landingPage, /0\.4ms/);
  assert.match(heroSvg, /\+1 ALLOW/);
  assert.match(heroSvg, /-1 DENY/);
  assert.doesNotMatch(heroSvg, /👍|👎/);
  assert.match(landingPage, /\/assets\/diagrams\/hero-thumbs\.svg/);
  assert.match(landingPage, /\/assets\/diagrams\/before-after\.svg/);
  assert.match(landingPage, /\/assets\/diagrams\/loop\.svg/);
  assert.match(landingPage, /\/assets\/diagrams\/self-improving-thumbs-loop\.svg/);
  assert.match(landingPage, /Is it really self-improving\?/);
  assert.match(landingPage, /Thumbs teach\. The gate enforces\./);
  assert.match(landingPage, /control layer, not the LLM/i);

  const heroStart = landingPage.indexOf('<!-- HERO -->');
  const howStart = landingPage.indexOf('id="how-it-works"');
  const heroBlock = landingPage.slice(heroStart, howStart);
  assert.ok(heroBlock.includes('hero-thumbs.svg'), 'hero diagram must appear before how-it-works');
  assert.ok(heroBlock.includes('class="hero-thumbs"'), 'big thumbs must appear in hero');
  assert.doesNotMatch(heroBlock, /👍|👎/, 'hero art uses vector thumbs, not stock emoji');
});

test('THUMBGATE_OWNER_EMAILS grants Enterprise tier on Google and Apple SSO while leaving other emails unchanged', async () => {
  const crypto = require('node:crypto');
  const os = require('node:os');
  const { startServer, __test__: serverTestHooks } = require('../src/api/server');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-owner-pro-'));
  const prevEnv = {
    THUMBGATE_FEEDBACK_DIR: process.env.THUMBGATE_FEEDBACK_DIR,
    THUMBGATE_API_KEY: process.env.THUMBGATE_API_KEY,
    THUMBGATE_OPERATOR_KEY: process.env.THUMBGATE_OPERATOR_KEY,
    THUMBGATE_OWNER_EMAILS: process.env.THUMBGATE_OWNER_EMAILS,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    _TEST_API_KEYS_PATH: process.env._TEST_API_KEYS_PATH,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    APPLE_CLIENT_ID: process.env.APPLE_CLIENT_ID,
    APPLE_TEAM_ID: process.env.APPLE_TEAM_ID,
    APPLE_KEY_ID: process.env.APPLE_KEY_ID,
    APPLE_PRIVATE_KEY: process.env.APPLE_PRIVATE_KEY,
  };

  process.env.THUMBGATE_FEEDBACK_DIR = tmpDir;
  process.env.THUMBGATE_API_KEY = 'tg_admin_owner_test_key_01';
  process.env.THUMBGATE_OPERATOR_KEY = 'tg_op_owner_test_key_01';
  process.env.THUMBGATE_OWNER_EMAILS = '  IGanapolsky@gmail.com , igor.ganapolsky@icloud.com ';
  process.env.STRIPE_SECRET_KEY = '';
  process.env._TEST_API_KEYS_PATH = path.join(tmpDir, 'api-keys.json');
  process.env.GOOGLE_CLIENT_ID = 'google-client-owner-test.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = 'google-secret-owner-test';
  const { publicKey: rsaPub, privateKey: rsaPriv } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const googleJwk = { ...rsaPub.export({ format: 'jwk' }), kid: 'owner-google-kid', alg: 'RS256', use: 'sig' };
  const appleIdKeyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const appleIdJwk = { ...appleIdKeyPair.publicKey.export({ format: 'jwk' }), kid: 'owner-apple-kid', alg: 'RS256', use: 'sig' };
  const appleClientKeyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

  process.env.APPLE_CLIENT_ID = 'com.iganapolsky.thumbgate.web';
  process.env.APPLE_TEAM_ID = 'TEAM123456';
  process.env.APPLE_KEY_ID = 'KEY1234567';
  process.env.APPLE_PRIVATE_KEY = appleClientKeyPair.privateKey
    .export({ type: 'pkcs8', format: 'pem' })
    .replace(/\n/g, '\\n');

  let nextGoogleEmail = '';
  let nextAppleEmail = '';
  let nextAppleNonce = '';

  const signJwt = (privKey, kid, payload) => {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${body}`), privKey).toString('base64url');
    return `${header}.${body}.${sig}`;
  };

  serverTestHooks.setGoogleOAuthFetchForTests(async (url) => {
    if (String(url).includes('certs')) {
      return { ok: true, status: 200, json: async () => ({ keys: [googleJwk] }) };
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const idToken = signJwt(rsaPriv, 'owner-google-kid', {
      iss: 'https://accounts.google.com',
      aud: process.env.GOOGLE_CLIENT_ID,
      sub: `google_${nextGoogleEmail}`,
      email: nextGoogleEmail,
      email_verified: true,
      iat: nowSec - 10,
      exp: nowSec + 300,
    });
    return { ok: true, status: 200, json: async () => ({ id_token: idToken }) };
  });

  serverTestHooks.setAppleOAuthFetchForTests(async (url) => {
    if (String(url).includes('/auth/keys')) {
      return { ok: true, status: 200, json: async () => ({ keys: [appleIdJwk] }) };
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const idToken = signJwt(appleIdKeyPair.privateKey, 'owner-apple-kid', {
      iss: 'https://appleid.apple.com',
      aud: process.env.APPLE_CLIENT_ID,
      sub: `apple_${nextAppleEmail}`,
      email: nextAppleEmail,
      email_verified: 'true',
      nonce: nextAppleNonce,
      iat: nowSec - 10,
      exp: nowSec + 300,
    });
    return { ok: true, status: 200, json: async () => ({ id_token: idToken }) };
  });

  const started = await startServer({ port: 0, host: '127.0.0.1' });
  const origin = `http://127.0.0.1:${started.port}`;

  try {
    const googleStart = await fetch(`${origin}/v1/cloud/sso/authorize?provider=google`, { redirect: 'manual' });
    const googleStateCookie = (googleStart.headers.get('set-cookie') || '').split(';')[0];
    const googleState = new URL(googleStart.headers.get('location')).searchParams.get('state');
    nextGoogleEmail = 'iganapolsky@gmail.com';
    const googleCb = await fetch(
      `${origin}/v1/cloud/sso/callback?provider=google&code=ok_owner_google&state=${googleState}`,
      { redirect: 'manual', headers: { cookie: googleStateCookie } },
    );
    assert.equal(googleCb.status, 302);
    const ownerGoogleCookie = (googleCb.headers.get('set-cookie') || '').split(';')[0];
    const ownerGoogleSession = await (await fetch(`${origin}/v1/auth/session`, { headers: { cookie: ownerGoogleCookie } })).json();
    assert.equal(ownerGoogleSession.authenticated, true);
    assert.equal(ownerGoogleSession.tier, 'Enterprise');
    assert.equal(ownerGoogleSession.ssoProvider, 'google');
    assert.equal(ownerGoogleSession.ssoEmail, 'iganapolsky@gmail.com');
    assert.equal((await fetch(`${origin}/v1/feedback/stats`, { headers: { cookie: ownerGoogleCookie } })).status, 200);
    assert.equal((await fetch(`${origin}/v1/lessons/search?limit=5`, { headers: { cookie: ownerGoogleCookie } })).status, 200);
    assert.equal((await fetch(`${origin}/v1/search?q=*&limit=40&source=feedback`, { headers: { cookie: ownerGoogleCookie } })).status, 200);
    assert.equal((await fetch(`${origin}/v1/dashboard`, { headers: { cookie: ownerGoogleCookie } })).status, 200);

    const appleStart = await fetch(`${origin}/v1/cloud/sso/authorize?provider=apple`, { redirect: 'manual' });
    const appleRedirectUrl = new URL(appleStart.headers.get('location'));
    const appleState = appleRedirectUrl.searchParams.get('state');
    nextAppleNonce = appleRedirectUrl.searchParams.get('nonce');
    nextAppleEmail = 'Igor.Ganapolsky@icloud.com';
    const appleCb = await fetch(`${origin}/v1/cloud/sso/apple/callback`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://appleid.apple.com',
      },
      body: new URLSearchParams({ code: 'ok_owner_apple', state: appleState }).toString(),
    });
    assert.equal(appleCb.status, 303);
    const ownerAppleCookie = (appleCb.headers.get('set-cookie') || '').split(';')[0];
    serverTestHooks.clearInMemoryAuthSessionsForTests();
    const ownerAppleSession = await (await fetch(`${origin}/v1/auth/session`, { headers: { cookie: ownerAppleCookie } })).json();
    assert.equal(ownerAppleSession.authenticated, true);
    assert.equal(ownerAppleSession.tier, 'Enterprise');
    assert.equal(ownerAppleSession.ssoProvider, 'apple');
    assert.equal((await fetch(`${origin}/v1/feedback/stats`, { headers: { cookie: ownerAppleCookie } })).status, 200);

    const relayStart = await fetch(`${origin}/v1/cloud/sso/authorize?provider=apple`, { redirect: 'manual' });
    const relayUrl = new URL(relayStart.headers.get('location'));
    nextAppleNonce = relayUrl.searchParams.get('nonce');
    nextAppleEmail = 'anon123@privaterelay.appleid.com';
    const relayCb = await fetch(`${origin}/v1/cloud/sso/apple/callback`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://appleid.apple.com',
      },
      body: new URLSearchParams({ code: 'ok_relay_apple', state: relayUrl.searchParams.get('state') }).toString(),
    });
    const relayCookie = (relayCb.headers.get('set-cookie') || '').split(';')[0];
    const relaySession = await (await fetch(`${origin}/v1/auth/session`, { headers: { cookie: relayCookie } })).json();
    assert.equal(relaySession.authenticated, true);
    assert.equal(relaySession.tier, 'Free');
    assert.equal((await fetch(`${origin}/v1/feedback/stats`, { headers: { cookie: relayCookie } })).status, 401);

    const lessonsHtml = await (await fetch(`${origin}/lessons`)).text();
    assert.match(lessonsHtml, /fetch\('\/v1\/auth\/session',\s*\{\s*credentials:\s*'include'\s*\}\)/);
    assert.match(lessonsHtml, /resolveLessonsTierName/);
    assert.doesNotMatch(lessonsHtml, />Landing Page</);
    assert.match(lessonsHtml, /<a href="\/" class="nav-logo"/);
    assert.match(lessonsHtml, /aria-label="GitHub"/);
    const dashboardHtml = await (await fetch(`${origin}/dashboard`)).text();
    assert.doesNotMatch(dashboardHtml, />Landing Page</);
    assert.doesNotMatch(dashboardHtml, /<span class="logo-text">ThumbGate Dashboard<\/span>/);
    assert.match(dashboardHtml, /<a href="\/" class="nav-logo"/);
    assert.match(dashboardHtml, /aria-label="GitHub"/);
    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'server.js'), 'utf8');
    assert.doesNotMatch(serverSource, />Landing Page</);
  } finally {
    serverTestHooks.setGoogleOAuthFetchForTests(null);
    serverTestHooks.setAppleOAuthFetchForTests(null);
    await new Promise((resolve) => started.server.close(resolve));
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
