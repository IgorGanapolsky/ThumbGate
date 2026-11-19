'use strict';

// Landing-visit utm_* values reach the Stripe session metadata, and a LinkedIn
// referrer is named linkedin. Stripe is a fake in every test; no live call.

const { describe, it, before, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BROWSER_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'checkout-utm-'));
const ENV = {
  _TEST_API_KEYS_PATH: path.join(tmpRoot, 'api-keys.json'),
  _TEST_FUNNEL_LEDGER_PATH: path.join(tmpRoot, 'funnel-events.jsonl'),
  _TEST_REVENUE_LEDGER_PATH: path.join(tmpRoot, 'revenue-events.jsonl'),
  _TEST_LOCAL_CHECKOUT_SESSIONS_PATH: path.join(tmpRoot, 'local-checkout-sessions.json'),
  THUMBGATE_FEEDBACK_DIR: path.join(tmpRoot, 'feedback'),
  THUMBGATE_API_KEY: ['unit', 'test', 'api', 'access'].join('-'),
  STRIPE_SECRET_KEY: ['sk', 'test', 'fake', 'value'].join('_'),
  THUMBGATE_CHECKOUT_BURST_MAX: '1000',
  THUMBGATE_CHECKOUT_GLOBAL_MAX: '1000',
  RAILWAY_ENVIRONMENT_ID: '',
  RAILWAY_PROJECT_ID: '',
};
const savedEnv = {};
for (const [k, v] of Object.entries(ENV)) {
  savedEnv[k] = process.env[k];
  process.env[k] = v;
}
fs.mkdirSync(ENV.THUMBGATE_FEEDBACK_DIR, { recursive: true });

const billing = require('../scripts/billing');
const { startServer, __test__ } = require('../src/api/server');

// undici rewrites Sec-Fetch-Mode, so a navigation-shaped POST goes through node:http.
function navigationPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'POST', headers: { ...headers, 'content-length': Buffer.byteLength(body) } }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location || '' }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function makeFakeStripe() {
  const calls = [];
  return {
    calls,
    products: { list: async () => ({ data: [] }) },
    checkout: {
      sessions: {
        async create(payload) {
          calls.push(payload);
          return { id: `cs_test_fake_${calls.length}`, url: `https://checkout.example.invalid/pay/${calls.length}` };
        },
      },
    },
  };
}

describe('inferSource names LinkedIn', () => {
  it('linkedin.com and lnkd.in referrers are linkedin', () => {
    for (const host of ['linkedin.com', 'www.linkedin.com', 'lnkd.in', 'l.linkedin.com', 'LinkedIn.com']) {
      assert.equal(__test__.inferSource(host), 'linkedin', host);
    }
  });

  it('look-alike hosts are not linkedin, and other sources are unchanged', () => {
    assert.equal(__test__.inferSource('notlinkedin.com'), 'website');
    assert.equal(__test__.inferSource('linkedin.com.evil.example'), 'website');
    assert.equal(__test__.inferSource('www.reddit.com'), 'reddit');
    assert.equal(__test__.inferSource('www.google.com'), 'organic_search');
    assert.equal(__test__.inferSource(null), 'website');
  });
});

describe('landing utm_* carry into the checkout session metadata', () => {
  let handle;
  let origin = '';
  let stripe;

  before(() => {
    fs.mkdirSync(ENV.THUMBGATE_FEEDBACK_DIR, { recursive: true });
  });

  beforeEach(async () => {
    stripe = makeFakeStripe();
    billing._setStripeClient(stripe);
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

  const LANDING = '/pricing?utm_source=linkedin&utm_medium=social&utm_campaign=launch_q4&utm_content=post_1';

  async function landingCookies(pathAndQuery = LANDING, headers = {}) {
    const res = await fetch(`${origin}${pathAndQuery}`, {
      redirect: 'manual',
      headers: { 'user-agent': BROWSER_UA, accept: BROWSER_ACCEPT, ...headers },
    });
    assert.equal(res.status, 200);
    return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  }

  async function freshToken(cookie) {
    const res = await fetch(`${origin}/v1/checkout/click-token`, {
      method: 'POST',
      headers: {
        'user-agent': BROWSER_UA, accept: '*/*', 'content-type': 'application/json', origin, cookie,
      },
      body: JSON.stringify({ buttonId: 'pro_checkout_direct_stripe', landingPage: '/pricing' }),
    });
    assert.equal(res.status, 200);
    return (await res.json()).token;
  }

  function hiddenFields(html, formDataI) {
    const form = html.match(new RegExp(`<form[^>]*data-i="${formDataI}"[^>]*>([\\s\\S]*?)</form>`));
    assert.ok(form, `form ${formDataI} present`);
    const fields = {};
    for (const m of form[1].matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) fields[m[1]] = m[2];
    return fields;
  }

  async function confirmPage(cookie, query = '') {
    const res = await fetch(`${origin}/checkout/pro${query}`, {
      redirect: 'manual',
      headers: { 'user-agent': BROWSER_UA, accept: BROWSER_ACCEPT, cookie },
    });
    assert.equal(res.status, 200);
    return res.text();
  }

  it('a landing visit with utm_* leaves an attribution cookie', async () => {
    const cookie = await landingCookies();
    assert.match(cookie, /thumbgate_utm=/);
  });

  it('the direct Pro form carries the landing utm values instead of website defaults', async () => {
    const cookie = await landingCookies();
    const fields = hiddenFields(await confirmPage(cookie), 'pro_checkout_direct_stripe');
    assert.equal(fields.utm_source, 'linkedin');
    assert.equal(fields.utm_medium, 'social');
    assert.equal(fields.utm_campaign, 'launch_q4');
    assert.equal(fields.utm_content, 'post_1');
  });

  it('the confirm form carries them too', async () => {
    const cookie = await landingCookies();
    const fields = hiddenFields(await confirmPage(cookie), 'pro_checkout_confirmed');
    assert.equal(fields.utm_source, 'linkedin');
    assert.equal(fields.utm_campaign, 'launch_q4');
  });

  it('with no landing utm and no cookie the form keeps its defaults', async () => {
    const fields = hiddenFields(await confirmPage(''), 'pro_checkout_direct_stripe');
    assert.equal(fields.utm_source, 'website');
    assert.equal(fields.utm_medium, 'checkout_interstitial');
    assert.equal(fields.utm_campaign, 'pro_upgrade');
  });

  it('utm_* in the checkout URL win over the cookie', async () => {
    const cookie = await landingCookies();
    const fields = hiddenFields(await confirmPage(cookie, '?utm_source=newsletter&utm_medium=email&utm_campaign=nov'), 'pro_checkout_direct_stripe');
    assert.equal(fields.utm_source, 'newsletter');
    assert.equal(fields.utm_campaign, 'nov');
  });

  it('POST /go/pro-direct after a click records the landing utm in the session metadata', async () => {
    const cookie = await landingCookies();
    const fields = hiddenFields(await confirmPage(cookie), 'pro_checkout_direct_stripe');
    const body = new URLSearchParams({ ...fields, customer_email: '', click_token: await freshToken(cookie) });
    const res = await navigationPost(`${origin}/go/pro-direct`, {
      'user-agent': BROWSER_UA,
      accept: BROWSER_ACCEPT,
      'content-type': 'application/x-www-form-urlencoded',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document',
      cookie,
    }, body.toString());
    assert.ok([302, 303].includes(res.status), `status ${res.status}`);
    assert.equal(stripe.calls.length, 1);
    const meta = stripe.calls[0].metadata;
    assert.equal(meta.utmSource, 'linkedin');
    assert.equal(meta.utmMedium, 'social');
    assert.equal(meta.utmCampaign, 'launch_q4');
    assert.equal(meta.utmContent, 'post_1');
    assert.equal(meta.uaClass, 'browser', 'the human-click metadata is still recorded');
    assert.equal(meta.buttonId, 'pro_checkout_direct_stripe');
  });

  it('POST /checkout/pro (email path) records the landing utm in the session metadata', async () => {
    const cookie = await landingCookies();
    const body = new URLSearchParams({
      confirm: '1', customer_email: 'buyer@example.com', click_token: await freshToken(cookie),
    });
    const res = await fetch(`${origin}/checkout/pro`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'user-agent': BROWSER_UA, accept: BROWSER_ACCEPT, 'content-type': 'application/x-www-form-urlencoded', cookie,
      },
      body,
    });
    assert.equal(res.status, 302);
    assert.equal(stripe.calls.length, 1);
    const meta = stripe.calls[0].metadata;
    assert.equal(meta.utmSource, 'linkedin');
    assert.equal(meta.utmMedium, 'social');
    assert.equal(meta.utmCampaign, 'launch_q4');
    assert.equal(meta.uaClass, 'browser');
  });

  it('a cookie never opens a session by itself: a bare GET with the cookie creates nothing', async () => {
    const cookie = await landingCookies();
    await confirmPage(cookie, '?confirm=1&customer_email=buyer%40example.com');
    assert.equal(stripe.calls.length, 0);
  });

  it('script-injected utm values in the cookie are not echoed as markup', async () => {
    const evil = encodeURIComponent(JSON.stringify({ utm_source: '"><script>alert(1)</script>' }));
    const html = await confirmPage(`thumbgate_utm=${evil}`);
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  });
});
