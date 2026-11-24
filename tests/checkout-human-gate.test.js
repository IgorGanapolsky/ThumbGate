'use strict';

/**
 * Human-click gate for Stripe Checkout Session creation.
 * Spec: docs/designs/2026-11-18-human-click-checkout.md (REQ-01 to REQ-10).
 * Nothing here calls live Stripe: the unit cases use an injected fake client and
 * the server cases run with no Stripe key (local mode).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const gate = require('../scripts/checkout-human-gate');
const { activePrices } = require('./helpers/fake-stripe-prices');

// Throwaway signing values for the tests, built at runtime so no literal looks like a credential.
const SIGNING_A = ['unit', 'test', 'signing', 'a'].join('-');
const SIGNING_B = ['unit', 'test', 'signing', 'b'].join('-');
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const BROWSER_HEADERS = {
  'user-agent': BROWSER_UA,
  accept: 'text/html,application/xhtml+xml',
  'cf-connecting-ip': '203.0.113.7',
};

function makeClock(start = 1_700_000_000_000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

describe('token', () => {
  it('verifies a freshly issued token once and refuses a replay', () => {
    const now = makeClock();
    const svc = gate.createTokenService({ secret: SIGNING_A, now });
    const ctx = { ipKey: '203.0.113.7', userAgent: BROWSER_UA };
    const token = svc.issue({ ...ctx, buttonId: 'pricing_pro', landingPage: '/pricing' });
    const first = svc.verify(token, ctx);
    assert.equal(first.ok, true);
    assert.equal(first.claims.btn, 'pricing_pro');
    assert.equal(first.claims.lp, '/pricing');
    const second = svc.verify(token, ctx);
    assert.deepEqual({ ok: second.ok, reason: second.reason }, { ok: false, reason: 'replayed' });
  });

  it('refuses missing, malformed and tampered tokens with distinct reasons', () => {
    const now = makeClock();
    const svc = gate.createTokenService({ secret: SIGNING_A, now });
    const ctx = { ipKey: '203.0.113.7', userAgent: BROWSER_UA };
    const token = svc.issue({ ...ctx, buttonId: 'a', landingPage: '/' });
    assert.equal(svc.verify('', ctx).reason, 'missing');
    assert.equal(svc.verify(undefined, ctx).reason, 'missing');
    assert.equal(svc.verify('not-a-token', ctx).reason, 'malformed');
    const [payload, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), btn: 'forged' })).toString('base64url');
    assert.equal(svc.verify(`${forged}.${sig}`, ctx).reason, 'bad_signature');
    assert.equal(svc.verify(`${payload}.${sig.slice(0, -2)}xx`, ctx).reason, 'bad_signature');
  });

  it('refuses an expired token', () => {
    const now = makeClock();
    const svc = gate.createTokenService({ secret: SIGNING_A, now, ttlMs: 120_000 });
    const ctx = { ipKey: '203.0.113.7', userAgent: BROWSER_UA };
    const token = svc.issue({ ...ctx, buttonId: 'a', landingPage: '/' });
    now.advance(120_001);
    assert.equal(svc.verify(token, ctx).reason, 'expired');
  });

  it('refuses a token used from another IP or another user agent', () => {
    const now = makeClock();
    const svc = gate.createTokenService({ secret: SIGNING_A, now });
    const ctx = { ipKey: '203.0.113.7', userAgent: BROWSER_UA };
    const token = svc.issue({ ...ctx, buttonId: 'a', landingPage: '/' });
    assert.equal(svc.verify(token, { ...ctx, ipKey: '198.51.100.9' }).reason, 'ip_mismatch');
    assert.equal(svc.verify(token, { ...ctx, userAgent: 'curl/8.4.0' }).reason, 'ua_mismatch');
    assert.equal(svc.verify(token, ctx).ok, true, 'a refused attempt must not consume the token');
  });

  it('a token signed with another key is refused', () => {
    const now = makeClock();
    const a = gate.createTokenService({ secret: SIGNING_A, now });
    const b = gate.createTokenService({ secret: SIGNING_B, now });
    const ctx = { ipKey: '203.0.113.7', userAgent: BROWSER_UA };
    assert.equal(b.verify(a.issue({ ...ctx, buttonId: 'a', landingPage: '/' }), ctx).reason, 'bad_signature');
  });
});

describe('burst', () => {
  it('admits 2 per minute per IP and refuses the 3rd', () => {
    const now = makeClock();
    const limiter = gate.createBurstLimiter({ max: 2, windowMs: 60_000 });
    assert.equal(limiter.admit('203.0.113.7', now()), true);
    now.advance(1000);
    assert.equal(limiter.admit('203.0.113.7', now()), true);
    now.advance(1000);
    assert.equal(limiter.admit('203.0.113.7', now()), false);
    assert.equal(limiter.admit('203.0.113.7', now()), false);
  });

  it('admits again once the window has passed and keeps IPs separate', () => {
    const now = makeClock();
    const limiter = gate.createBurstLimiter({ max: 2, windowMs: 60_000 });
    limiter.admit('a', now());
    limiter.admit('a', now());
    assert.equal(limiter.admit('a', now()), false);
    assert.equal(limiter.admit('b', now()), true, 'another IP is not affected');
    now.advance(60_001);
    assert.equal(limiter.admit('a', now()), true);
  });

  it('refused calls do not extend the lockout', () => {
    const now = makeClock();
    const limiter = gate.createBurstLimiter({ max: 2, windowMs: 60_000 });
    limiter.admit('a', now());
    limiter.admit('a', now());
    for (let i = 0; i < 20; i += 1) { now.advance(1000); limiter.admit('a', now()); }
    now.advance(41_000);
    assert.equal(limiter.admit('a', now()), true);
  });

  it('keys on x-real-ip only behind Railway, else the socket; spoofable headers never move the key', () => {
    const railway = { RAILWAY_ENVIRONMENT_ID: 'env-1' };
    assert.equal(gate.clientIpKey({ 'x-real-ip': '198.51.100.4' }, '10.0.0.5', railway), '198.51.100.4');
    assert.equal(gate.clientIpKey({ 'x-real-ip': '198.51.100.4' }, '10.0.0.5', {}), '10.0.0.5', 'off Railway x-real-ip is caller controlled');
    const spoofA = { 'cf-connecting-ip': '9.9.9.1', 'x-forwarded-for': '9.9.9.1, 9.9.9.2', 'x-real-ip': '198.51.100.4' };
    const spoofB = { 'cf-connecting-ip': '9.9.9.7', 'x-forwarded-for': '9.9.9.7, 9.9.9.8', 'x-real-ip': '198.51.100.4' };
    assert.equal(gate.clientIpKey(spoofA, '10.0.0.5', railway), gate.clientIpKey(spoofB, '10.0.0.5', railway), 'rotating cf-connecting-ip or x-forwarded-for stays one IP');
    assert.equal(gate.clientIpKey(spoofA, '10.0.0.5', {}), '10.0.0.5');
    assert.equal(gate.clientIpKey({ 'x-real-ip': 'not an ip' }, '10.0.0.5', railway), '10.0.0.5');
    assert.equal(gate.clientIpKey({}, '', {}), 'no-ip');
  });

  it('a global ceiling of 60 an hour refuses the 61st admission from different IPs', () => {
    const now = makeClock();
    const human = gate.createHumanGate({ secret: SIGNING_A, now, env: {} });
    let admitted = 0;
    let refusedReason = null;
    for (let i = 0; i < 61; i += 1) {
      const ip = `203.0.113.${i + 1}`;
      const token = human.tokens.issue({ ipKey: ip, userAgent: BROWSER_UA, buttonId: 'a', landingPage: '/' });
      const result = human.admit({ method: 'POST', headers: BROWSER_HEADERS, remoteAddress: ip, token });
      if (result.ok) admitted += 1; else refusedReason = result.reason;
      now.advance(1000);
    }
    assert.equal(admitted, gate.GLOBAL_MAX);
    assert.equal(refusedReason, 'global_ceiling');
  });
});

describe('uaClass', () => {
  it('names browser, bot and unknown', () => {
    assert.equal(gate.classifyUserAgentClass(BROWSER_HEADERS), 'browser');
    assert.equal(gate.classifyUserAgentClass({ 'user-agent': 'curl/8.4.0', accept: '*/*' }), 'bot');
    assert.equal(gate.classifyUserAgentClass({ 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)', accept: 'text/html' }), 'bot');
    assert.equal(gate.classifyUserAgentClass({ accept: 'text/html' }), 'unknown');
    assert.equal(gate.classifyUserAgentClass({ 'user-agent': '   ' }), 'unknown');
  });

  it('keeps in-app browsers as browser', () => {
    const accept = 'text/html,application/xhtml+xml';
    const instagram = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21E236 Instagram 330.0.0.20.113 (iPhone14,5; iOS 17_4; en_US; en; scale=3.00; 1170x2532; 574004582)';
    const facebook = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21E236 [FBAN/FBIOS;FBAV/450.0.0.38.108;FBBV/565351470;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.4;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]';
    const linkedin = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 LinkedInApp/9.30.1234';
    for (const ua of [instagram, facebook, linkedin]) {
      assert.equal(gate.classifyUserAgentClass({ 'user-agent': ua, accept }), 'browser', ua.slice(0, 40));
    }
  });
});

describe('metadata', () => {
  it('always carries landingPage, referrer, uaClass and buttonId', () => {
    const meta = gate.buildClickMetadata({
      headers: { ...BROWSER_HEADERS, referer: 'https://thumbgate.ai/pricing?utm_source=x&email=a@b.co#plans' },
      claims: { btn: 'pricing_pro', lp: '/pricing' },
    });
    assert.deepEqual(Object.keys(meta).sort(), ['buttonId', 'landingPage', 'referrer', 'uaClass']);
    assert.equal(meta.landingPage, '/pricing');
    assert.equal(meta.buttonId, 'pricing_pro');
    assert.equal(meta.uaClass, 'browser');
    assert.equal(meta.referrer, 'https://thumbgate.ai/pricing', 'query string and fragment are removed');
  });

  it('fills every missing value with unknown, never leaves a key out', () => {
    const meta = gate.buildClickMetadata({ headers: {}, claims: null });
    assert.deepEqual(meta, { landingPage: 'unknown', referrer: 'unknown', uaClass: 'unknown', buttonId: 'unknown' });
  });

  it('keeps every value inside the Stripe 500 character limit and does not default to /', () => {
    const long = 'x'.repeat(900);
    const meta = gate.buildClickMetadata({
      headers: { ...BROWSER_HEADERS, referer: `https://example.com/${long}` },
      claims: { btn: long, lp: `/${long}` },
    });
    for (const value of Object.values(meta)) assert.ok(value.length <= 200, `value too long: ${value.length}`);
    assert.notEqual(gate.buildClickMetadata({ headers: BROWSER_HEADERS, claims: { btn: 'a', lp: '/pricing' } }).landingPage, '/');
  });

  it('records script-injected values as unknown instead of storing them', () => {
    const meta = gate.buildClickMetadata({
      headers: BROWSER_HEADERS,
      claims: { btn: '<script>alert(1)</script>', lp: 'javascript:alert(1)' },
    });
    assert.equal(meta.buttonId, 'unknown');
    assert.equal(meta.landingPage, 'unknown');
    const spaced = gate.buildClickMetadata({ headers: BROWSER_HEADERS, claims: { btn: 'two words', lp: '/a b' } });
    assert.equal(spaced.buttonId, 'unknown');
    assert.equal(spaced.landingPage, '/a%20b', 'a path is kept in its encoded form');
  });
});

describe('admit', () => {
  function build() {
    const now = makeClock();
    const human = gate.createHumanGate({ secret: SIGNING_A, now, env: {} });
    const issue = (headers = BROWSER_HEADERS) => human.issueToken({
      headers, remoteAddress: '', buttonId: 'pricing_pro', landingPage: '/pricing',
    });
    const admit = (token, headers = BROWSER_HEADERS, method = 'POST') => human.admit({
      method, headers, remoteAddress: '', token,
    });
    return { now, human, issue, admit };
  }

  it('refuses a bare GET even with a valid token', () => {
    const { issue, admit } = build();
    const result = admit(issue(), BROWSER_HEADERS, 'GET');
    assert.deepEqual({ ok: result.ok, status: result.status, reason: result.reason }, { ok: false, status: 405, reason: 'method_not_post' });
  });

  it('refuses a POST with no token', () => {
    const { admit } = build();
    const result = admit('');
    assert.deepEqual({ ok: result.ok, status: result.status, reason: result.reason }, { ok: false, status: 403, reason: 'token_missing' });
  });

  it('admits a POST with a fresh token from a browser and returns click metadata', () => {
    const { issue, admit } = build();
    const result = admit(issue());
    assert.equal(result.ok, true);
    assert.equal(result.humanClick.admitted, true);
    assert.deepEqual(Object.keys(result.humanClick.metadata).sort(), ['buttonId', 'landingPage', 'referrer', 'uaClass']);
    assert.equal(result.humanClick.metadata.buttonId, 'pricing_pro');
  });

  it('refuses a bot user agent even when it holds a valid token', () => {
    const { human } = build();
    const botHeaders = { 'user-agent': 'python-requests/2.31', accept: '*/*' };
    const token = human.tokens.issue({
      ipKey: gate.clientIpKey(botHeaders, '', {}), userAgent: botHeaders['user-agent'], buttonId: 'a', landingPage: '/',
    });
    const result = human.admit({ method: 'POST', headers: botHeaders, remoteAddress: '', token });
    assert.deepEqual({ ok: result.ok, status: result.status, reason: result.reason }, { ok: false, status: 403, reason: 'ua_bot' });
  });

  it('refuses the 3rd admission from one IP inside a minute with 429 and a clear reason', () => {
    const { now, issue, admit } = build();
    assert.equal(admit(issue()).ok, true);
    now.advance(500);
    assert.equal(admit(issue()).ok, true);
    now.advance(500);
    const third = admit(issue());
    assert.deepEqual({ ok: third.ok, status: third.status, reason: third.reason }, { ok: false, status: 429, reason: 'burst_limit' });
    now.advance(60_001);
    assert.equal(admit(issue()).ok, true);
  });

  it('a token refused for the burst limit is not burned', () => {
    const { now, issue, admit } = build();
    admit(issue());
    admit(issue());
    const held = issue();
    assert.equal(admit(held).status, 429);
    now.advance(60_001);
    assert.equal(admit(held).ok, true, 'still inside its 2 minute life once the window has moved');
  });

  it('a replayed token is refused', () => {
    const { issue, admit } = build();
    const token = issue();
    assert.equal(admit(token).ok, true);
    assert.equal(admit(token).reason, 'token_replayed');
  });

  it('issueToken gives no token to a non-browser user agent', () => {
    const { human } = build();
    const out = human.issueToken({ headers: { 'user-agent': 'curl/8.4.0' }, remoteAddress: '', buttonId: 'a', landingPage: '/' });
    assert.equal(out, null);
  });
});

// ---------------------------------------------------------------------------
// Server wiring and createCheckoutSession. A fake Stripe client is injected, the
// key is a made-up test value, and every funnel/telemetry path points at a temp
// directory, so nothing here can reach live Stripe or the real ledgers.
// ---------------------------------------------------------------------------

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { before, after, beforeEach, afterEach } = require('node:test');

const BROWSER_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const NAV_HEADERS = {
  'user-agent': BROWSER_UA,
  accept: BROWSER_ACCEPT,
  'sec-fetch-mode': 'navigate',
  'sec-fetch-dest': 'document',
  'sec-fetch-site': 'same-origin',
};

function makeFakeStripe({ failFirstWith } = {}) {
  const calls = [];
  return {
    calls,
    products: { list: async () => ({ data: [] }) },
    prices: activePrices(),
    checkout: {
      sessions: {
        async create(payload) {
          calls.push(payload);
          if (failFirstWith && calls.length === 1) throw new Error(failFirstWith);
          return {
            id: `cs_test_fake_${calls.length}`,
            url: `https://checkout.example.invalid/pay/cs_test_fake_${calls.length}`,
          };
        },
      },
    },
  };
}

describe('server wiring and session creation', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'checkout-human-gate-'));
  const savedEnv = {};
  const fakeKey = ['sk', 'test', 'fake', 'value'].join('_');
  const apiAccess = ['unit', 'test', 'api', 'access'].join('-');
  const ENV = {
    _TEST_API_KEYS_PATH: path.join(tmpRoot, 'api-keys.json'),
    _TEST_FUNNEL_LEDGER_PATH: path.join(tmpRoot, 'funnel-events.jsonl'),
    _TEST_REVENUE_LEDGER_PATH: path.join(tmpRoot, 'revenue-events.jsonl'),
    _TEST_LOCAL_CHECKOUT_SESSIONS_PATH: path.join(tmpRoot, 'local-checkout-sessions.json'),
    THUMBGATE_FEEDBACK_DIR: path.join(tmpRoot, 'feedback'),
    THUMBGATE_API_KEY: apiAccess,
    STRIPE_SECRET_KEY: fakeKey,
    RAILWAY_ENVIRONMENT_ID: '',
    RAILWAY_PROJECT_ID: '',
  };
  let billing;
  let startServer;
  let handle;
  let origin = '';
  let stripe;

  before(() => {
    for (const [k, v] of Object.entries(ENV)) {
      savedEnv[k] = process.env[k];
      process.env[k] = v;
    }
    fs.mkdirSync(ENV.THUMBGATE_FEEDBACK_DIR, { recursive: true });
    billing = require('../scripts/billing');
    ({ startServer } = require('../src/api/server'));
  });

  beforeEach(async () => {
    stripe = makeFakeStripe();
    billing._setStripeClient(stripe);
    try { fs.unlinkSync(ENV._TEST_FUNNEL_LEDGER_PATH); } catch { /* none yet */ }
    handle = await startServer({ port: 0, host: '127.0.0.1' });
    origin = `http://127.0.0.1:${handle.port}`;
  });

  afterEach(() => {
    if (handle) handle.server.close();
    billing._setStripeClient(null);
  });

  after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  function funnelEvents() {
    try {
      return fs.readFileSync(ENV._TEST_FUNNEL_LEDGER_PATH, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  }

  function clickToken(extra = {}) {
    return fetch(`${origin}/v1/checkout/click-token`, {
      method: 'POST',
      headers: {
        'user-agent': BROWSER_UA,
        accept: '*/*',
        'content-type': 'application/json',
        origin,
        'sec-fetch-site': 'same-origin',
        ...(extra.headers || {}),
      },
      body: JSON.stringify({ buttonId: 'pricing_pro', landingPage: '/pricing', ...(extra.body || {}) }),
    });
  }

  async function freshToken() {
    const res = await clickToken();
    assert.equal(res.status, 200);
    return (await res.json()).token;
  }

  function postConfirm(token, extra = {}) {
    return fetch(`${origin}/checkout/pro`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'user-agent': BROWSER_UA,
        accept: BROWSER_ACCEPT,
        'content-type': 'application/x-www-form-urlencoded',
        referer: 'https://thumbgate.ai/pricing?utm_source=x',
        ...(extra.headers || {}),
      },
      body: new URLSearchParams({
        confirm: '1',
        customer_email: 'buyer@example.com',
        ...(token ? { click_token: token } : {}),
        ...(extra.form || {}),
      }),
    });
  }

  it('bare GET creates no session', async () => {
    for (const headers of [NAV_HEADERS, { 'user-agent': 'curl/8.4.0', accept: '*/*' }]) {
      const res = await fetch(`${origin}/checkout/pro?confirm=1&customer_email=buyer%40example.com`, { redirect: 'manual', headers });
      assert.equal(res.status, 200, 'the confirm page is shown, not a redirect to checkout');
      assert.match(res.headers.get('content-type') || '', /text\/html/);
    }
    assert.equal(stripe.calls.length, 0, 'Stripe client was not called');
    assert.equal(funnelEvents().filter((e) => e.event === 'checkout_session_created').length, 0);
  });

  it('POST without token creates no session', async () => {
    const res = await postConfirm('');
    assert.equal(res.status, 403);
    assert.equal(stripe.calls.length, 0);
    const bad = await postConfirm('not-a-real-token');
    assert.equal(bad.status, 403);
    assert.equal(stripe.calls.length, 0);
  });

  it('POST with token creates one session carrying the click metadata and after_expiration', async () => {
    const res = await postConfirm(await freshToken());
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location') || '', /^https:\/\/checkout\.example\.invalid\/pay\/cs_test_fake_1/);
    assert.equal(stripe.calls.length, 1);
    const payload = stripe.calls[0];
    assert.equal(payload.metadata.landingPage, '/pricing');
    assert.equal(payload.metadata.buttonId, 'pricing_pro');
    assert.equal(payload.metadata.uaClass, 'browser');
    assert.equal(payload.metadata.referrer, 'https://thumbgate.ai/pricing', 'query string removed');
    assert.equal(payload.after_expiration.recovery.enabled, true);
    assert.ok(Object.keys(payload.metadata).length <= 50);
    for (const value of Object.values(payload.metadata)) assert.ok(String(value).length <= 500);
    const created = funnelEvents().filter((e) => e.event === 'checkout_session_created');
    assert.equal(created.length, 1);
    assert.equal(created[0].metadata.uaClass, 'browser');
  });

  it('a token cannot be used twice', async () => {
    const token = await freshToken();
    assert.equal((await postConfirm(token)).status, 302);
    assert.equal((await postConfirm(token)).status, 403);
    assert.equal(stripe.calls.length, 1);
  });

  it('third POST in a minute from one IP is refused with 429', async () => {
    assert.equal((await postConfirm(await freshToken())).status, 302);
    assert.equal((await postConfirm(await freshToken())).status, 302);
    const third = await postConfirm(await freshToken());
    assert.equal(third.status, 429);
    assert.equal(stripe.calls.length, 2);
  });

  it('click-token endpoint gives nothing to bots, cross-origin pages or GET', async () => {
    const bot = await clickToken({ headers: { 'user-agent': 'python-requests/2.31', accept: '*/*' } });
    assert.equal(bot.status, 403);
    const cross = await clickToken({ headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } });
    assert.equal(cross.status, 403);
    const get = await fetch(`${origin}/v1/checkout/click-token`, { headers: NAV_HEADERS });
    assert.ok([404, 405].includes(get.status), `GET status ${get.status}`);
    assert.equal(stripe.calls.length, 0);
  });

  it('pro slugs never redirect to a payment link', async () => {
    for (const slug of ['pro', 'pro-direct', 'pro-annual', 'founding-100', 'operator-pro']) {
      for (const headers of [NAV_HEADERS, { 'user-agent': 'curl/8.4.0', accept: '*/*' }]) {
        const res = await fetch(`${origin}/go/${slug}`, { redirect: 'manual', headers });
        const location = res.headers.get('location') || '';
        assert.ok([301, 302, 303, 307].includes(res.status), `${slug} status ${res.status}`);
        assert.ok(!/buy\.stripe\.com/.test(location), `${slug} must not send a bare GET to a payment link: ${location}`);
        assert.match(new URL(location, origin).pathname, /^\/(checkout\/pro|operator-framework)$/, slug);
      }
      const post = await fetch(`${origin}/go/${slug}`, {
        method: 'POST', redirect: 'manual', headers: { ...NAV_HEADERS, 'content-type': 'application/x-www-form-urlencoded' }, body: '',
      });
      assert.ok(!/buy\.stripe\.com/.test(post.headers.get('location') || ''), `${slug} POST without a token`);
    }
    assert.equal(stripe.calls.length, 0);
  });

  // undici rewrites Sec-Fetch-Mode, so a browser-shaped form navigation is sent with node:http.
  function navigationPost(pathname, form) {
    return new Promise((resolve, reject) => {
      const body = new URLSearchParams(form).toString();
      const req = http.request(`${origin}${pathname}`, {
        method: 'POST',
        headers: { ...NAV_HEADERS, 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) },
      }, (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
      });
      req.on('error', reject);
      req.end(body);
    });
  }

  it('POST /go/pro-direct with a token creates the session', async () => {
    const res = await navigationPost('/go/pro-direct', { click_token: await freshToken() });
    assert.equal(res.status, 303, `gate reason: ${res.headers['x-thumbgate-gate-reason']}`);
    assert.match(res.headers.location || '', /example\.invalid/);
    assert.equal(stripe.calls.length, 1);
    assert.equal(stripe.calls[0].metadata.uaClass, 'browser');
    assert.equal(stripe.calls[0].metadata.buttonId, 'pricing_pro');
    assert.equal(stripe.calls[0].after_expiration.recovery.enabled, true);
  });

  it('POST /go/pro-direct without a token goes to the confirm page and creates nothing', async () => {
    const res = await navigationPost('/go/pro-direct', {});
    assert.equal(res.status, 302);
    assert.equal(new URL(res.headers.location, origin).pathname, '/checkout/pro');
    assert.equal(res.headers['x-thumbgate-gate-reason'], 'token_missing');
    assert.equal(stripe.calls.length, 0);
  });

  // A refused click used to bounce to an identical page with an empty note.
  async function noteOnPage(location) {
    const page = await fetch(new URL(location, origin), { headers: NAV_HEADERS });
    assert.equal(page.status, 200);
    const html = await page.text();
    const note = html.match(/<p class="gate-note" id="gate-note" role="status"([^>]*)>([^<]*)<\/p>/);
    assert.ok(note, 'gate note element is on the page');
    return { hidden: /display:none/.test(note[1]), text: note[2] };
  }

  it('a refused click tells the buyer to press the button again', async () => {
    const res = await navigationPost('/go/pro-direct', {});
    assert.equal(res.status, 302);
    assert.equal(new URL(res.headers.location, origin).searchParams.get('gate_notice'), 'retry');
    const note = await noteOnPage(res.headers.location);
    assert.equal(note.hidden, false);
    assert.match(note.text, /couldn't confirm that click\. Press the button again\./);
    assert.equal(stripe.calls.length, 0);
  });

  it('a replayed token gets the same notice and a third click in a minute is told to wait', async () => {
    const token = await freshToken();
    assert.equal((await navigationPost('/go/pro-direct', { click_token: token })).status, 303);
    const replay = await navigationPost('/go/pro-direct', { click_token: token });
    assert.equal(replay.headers['x-thumbgate-gate-reason'], 'token_replayed');
    assert.equal(new URL(replay.headers.location, origin).searchParams.get('gate_notice'), 'retry');
    assert.equal((await navigationPost('/go/pro-direct', { click_token: await freshToken() })).status, 303);
    const third = await navigationPost('/go/pro-direct', { click_token: await freshToken() });
    assert.equal(third.headers['x-thumbgate-gate-reason'], 'burst_limit');
    assert.equal(new URL(third.headers.location, origin).searchParams.get('gate_notice'), 'busy');
    const note = await noteOnPage(third.headers.location);
    assert.equal(note.hidden, false);
    assert.match(note.text, /Wait a minute, then press the button again\./);
    assert.equal(stripe.calls.length, 2, 'only the two admitted clicks opened a session');
  });

  it('the confirm form shows the notice on a refused POST as well', async () => {
    const res = await postConfirm('');
    assert.equal(res.status, 403);
    const html = await res.text();
    assert.match(html, /id="gate-note" role="status">We couldn't confirm that click\. Press the button again\./);
  });

  it('the notice appears only for the three known codes and is hidden otherwise', async () => {
    const quiet = await noteOnPage('/checkout/pro');
    assert.equal(quiet.hidden, true);
    for (const hostile of ['%3Cscript%3Ealert(1)%3C%2Fscript%3E', '__proto__', 'toString', 'constructor']) {
      const page = await fetch(`${origin}/checkout/pro?gate_notice=${hostile}`, { headers: NAV_HEADERS });
      const html = await page.text();
      assert.doesNotMatch(html, /alert\(1\)/);
      assert.match(html, /id="gate-note" role="status" style="display:none"><\/p>/, hostile);
    }
    const bot = await navigationPost('/go/pro-direct', {});
    assert.equal(bot.status, 302);
    const curl = await new Promise((resolve, reject) => {
      const req = http.request(`${origin}/go/pro-direct`, {
        method: 'POST',
        headers: { 'user-agent': 'curl/8.4.0', accept: '*/*', 'content-type': 'application/x-www-form-urlencoded' },
      }, (r) => { r.resume(); r.on('end', () => resolve({ status: r.statusCode, headers: r.headers })); });
      req.on('error', reject);
      req.end('');
    });
    assert.ok(![...new URL(curl.headers.location || '/', origin).searchParams.keys()].includes('gate_notice'), 'a non-browser agent gets no notice');
  });

  it('one-time packs and operator links are unchanged', async () => {
    const res = await fetch(`${origin}/go/playbook-999`, { redirect: 'manual', headers: NAV_HEADERS });
    assert.ok(/^https:\/\/buy\.stripe\.com\//.test(res.headers.get('location') || '') || /\/checkout\/pro/.test(res.headers.get('location') || ''), 'playbook keeps its existing behaviour');
    const before = res.headers.get('location');
    assert.ok(before, 'redirect present');
  });

  it('billing checkout needs a token', async () => {
    const none = await fetch(`${origin}/v1/billing/checkout`, {
      method: 'POST',
      headers: { 'user-agent': BROWSER_UA, accept: '*/*', 'content-type': 'application/json' },
      body: JSON.stringify({ customerEmail: 'buyer@example.com' }),
    });
    assert.equal(none.status, 403);
    assert.match(await none.text(), /HUMAN_CLICK_REQUIRED/);
    assert.equal(stripe.calls.length, 0);
    const ok = await fetch(`${origin}/v1/billing/checkout`, {
      method: 'POST',
      headers: {
        'user-agent': BROWSER_UA,
        accept: '*/*',
        'content-type': 'application/json',
        'x-thumbgate-click-token': await freshToken(),
      },
      body: JSON.stringify({ customerEmail: 'buyer@example.com' }),
    });
    assert.equal(ok.status, 200);
    assert.equal(stripe.calls.length, 1);
    assert.equal(stripe.calls[0].metadata.buttonId, 'pricing_pro');
  });

  it('confirm page primary button is a form, its script parses and disables the button after submit', async () => {
    const res = await fetch(`${origin}/checkout/pro`, { headers: NAV_HEADERS });
    const html = await res.text();
    assert.match(html, /<form action="\/go\/pro-direct" method="POST"[^>]*data-i="pro_checkout_direct_stripe"/);
    assert.doesNotMatch(html, /<a class="primary"/);
    assert.match(html, /name="click_token"/);
    assert.match(html, /isTrusted/);
    assert.match(html, /\.disabled\s*=\s*true/);
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.ok(scripts.length >= 2);
    for (const code of scripts) assert.doesNotThrow(() => new vm.Script(code), 'inline script must be valid JavaScript');
  });

  it('createCheckoutSession refuses without a human click', async () => {
    const args = {
      successUrl: 'https://thumbgate.ai/success',
      cancelUrl: 'https://thumbgate.ai/cancel',
      customerEmail: 'buyer@example.com',
      installId: 'inst-1',
      traceId: 'trace-1',
      metadata: { planId: 'pro' },
      appOrigin: 'https://thumbgate.ai',
    };
    await assert.rejects(billing.createCheckoutSession(args), (err) => err.code === 'HUMAN_CLICK_REQUIRED' && err.statusCode === 403);
    assert.equal(stripe.calls.length, 0, 'no Stripe call before the refusal');
  });

  it('session create carries after_expiration and consent_collection', async () => {
    await billing.createCheckoutSession({
      successUrl: 'https://thumbgate.ai/success',
      cancelUrl: 'https://thumbgate.ai/cancel',
      customerEmail: 'buyer@example.com',
      installId: 'inst-1',
      traceId: 'trace-1',
      metadata: { planId: 'pro' },
      appOrigin: 'https://thumbgate.ai',
      humanClick: { admitted: true, metadata: { landingPage: '/pricing', referrer: 'unknown', uaClass: 'browser', buttonId: 'pricing_pro' } },
    });
    assert.equal(stripe.calls.length, 1);
    assert.equal(stripe.calls[0].mode, 'subscription');
    assert.equal(stripe.calls[0].after_expiration.recovery.enabled, true);
    assert.deepEqual(stripe.calls[0].consent_collection, { promotions: 'auto' });
  });

  it('retry keeps after_expiration when consent_collection is dropped', async () => {
    const retrying = makeFakeStripe({ failFirstWith: 'Checkout cannot set consent_collection yet' });
    billing._setStripeClient(retrying);
    await billing.createCheckoutSession({
      successUrl: 'https://thumbgate.ai/success',
      cancelUrl: 'https://thumbgate.ai/cancel',
      customerEmail: 'buyer@example.com',
      installId: 'inst-1',
      traceId: 'trace-2',
      metadata: { planId: 'pro' },
      appOrigin: 'https://thumbgate.ai',
      humanClick: { admitted: true, metadata: { landingPage: '/pricing', referrer: 'unknown', uaClass: 'browser', buttonId: 'pricing_pro' } },
    });
    assert.equal(retrying.calls.length, 2);
    assert.ok(!('consent_collection' in retrying.calls[1]), 'second attempt dropped consent_collection');
    assert.equal(retrying.calls[1].after_expiration.recovery.enabled, true);
  });

  it('the interstitial bypass redirect to a payment link is gone', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'api', 'server.js'), 'utf8');
    assert.equal(source.includes('checkout_interstitial_bypass_redirect'), false);
  });
});
