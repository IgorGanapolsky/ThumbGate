'use strict';

// The confirm page logs checkout_interstitial_view on the server for every GET, including link
// scanners and crawlers that never run its script. checkout_interstitial_shown is sent by the
// page itself, so a view that ran in a browser can be told apart from one that did not.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-shown-beacon-'));
const FEEDBACK_DIR = path.join(tmp, 'feedback');
fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
Object.assign(process.env, {
  _TEST_FUNNEL_LEDGER_PATH: path.join(tmp, 'funnel.jsonl'),
  _TEST_REVENUE_LEDGER_PATH: path.join(tmp, 'revenue.jsonl'),
  _TEST_LOCAL_CHECKOUT_SESSIONS_PATH: path.join(tmp, 'local-sessions.json'),
  THUMBGATE_FEEDBACK_DIR: FEEDBACK_DIR,
  THUMBGATE_API_KEY: `test_key_${'x'.repeat(24)}`,
  STRIPE_SECRET_KEY: `sk_test_${'a'.repeat(24)}`,
  RAILWAY_ENVIRONMENT_ID: '',
  RAILWAY_PROJECT_ID: '',
});

const billing = require('../scripts/billing');
const { startServer } = require('../src/api/server');
const { activePrices } = require('./helpers/fake-stripe-prices');

const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const TELEMETRY = path.join(FEEDBACK_DIR, 'telemetry-pings.jsonl');

let playwright = null;
let browser = null;
let handle = null;
let origin = '';
let stripeCalls = 0;

function rowsFor(visitorId) {
  if (!fs.existsSync(TELEMETRY)) return [];
  return fs.readFileSync(TELEMETRY, 'utf8').split('\n').filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((row) => row.visitorId === visitorId);
}

async function waitForRows(visitorId, eventType, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = rowsFor(visitorId).filter((row) => row.eventType === eventType);
    if (hit.length) return hit;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return [];
}

function plainGet(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(origin + urlPath, {
      headers: {
        'user-agent': CHROME_UA,
        accept: 'text/html',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document',
        'sec-fetch-site': 'none',
      },
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    }).on('error', reject);
  });
}

async function openPage(viewport, visitorId) {
  const context = await browser.newContext({ userAgent: CHROME_UA, viewport });
  await context.route(/stripe\.com|plausible\.io/, (route) => route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(`${origin}/checkout/pro?plan_id=pro&visitor_id=${visitorId}`, { waitUntil: 'load' });
  return { context, page };
}

describe('checkout confirm page reports that its script ran', () => {
  before(async () => {
    try {
      playwright = require('playwright');
      browser = await playwright.chromium.launch();
    } catch (err) {
      playwright = null;
      browser = null;
    }
    billing._setStripeClient({
      checkout: {
        sessions: {
          create: async () => {
            stripeCalls += 1;
            return { id: `cs_test_${stripeCalls}`, url: 'https://checkout.stripe.com/c/pay/cs_test_shown' };
          },
        },
      },
      products: { retrieve: async () => ({ active: true }) },
      prices: activePrices(),
    });
    handle = await startServer({ port: 0, host: '127.0.0.1' });
    origin = `http://127.0.0.1:${handle.port}`;
  });

  after(async () => {
    if (browser) await browser.close();
    if (handle) handle.server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('a fetch that never runs the script leaves a server view and no shown beacon', async () => {
    assert.equal(await plainGet('/checkout/pro?plan_id=pro&visitor_id=ck-nojs'), 200);
    const view = await waitForRows('ck-nojs', 'checkout_interstitial_view');
    assert.equal(view.length, 1);
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(rowsFor('ck-nojs').filter((row) => row.eventType === 'checkout_interstitial_shown').length, 0);
  });

  it('a browser load sends one shown beacon with the button above the fold on desktop', async (t) => {
    if (!browser) return t.skip('Chromium is not installed here');
    const { context } = await openPage({ width: 1280, height: 720 }, 'ck-desktop');
    const shown = await waitForRows('ck-desktop', 'checkout_interstitial_shown');
    assert.equal(shown.length, 1);
    assert.equal(shown[0].sectionId, 'cta_above_fold');
    assert.equal(shown[0].sectionLabel, '1280x720');
    assert.equal(shown[0].ctaId, 'pro_checkout_direct_stripe');
    await context.close();
  });

  it('a short phone screen reports the button below the fold', async (t) => {
    if (!browser) return t.skip('Chromium is not installed here');
    const { context } = await openPage({ width: 375, height: 300 }, 'ck-short');
    const shown = await waitForRows('ck-short', 'checkout_interstitial_shown');
    assert.equal(shown.length, 1);
    assert.equal(shown[0].sectionId, 'cta_below_fold');
    assert.equal(shown[0].sectionLabel, '375x300');
    await context.close();
  });

  it('a real press reaches telemetry and opens exactly one session', async (t) => {
    if (!browser) return t.skip('Chromium is not installed here');
    const before = stripeCalls;
    const { context, page } = await openPage({ width: 390, height: 844 }, 'ck-press');
    await waitForRows('ck-press', 'checkout_interstitial_shown');
    await page.locator('form.direct button.primary').click();
    const clicked = await waitForRows('ck-press', 'checkout_interstitial_cta_clicked');
    assert.equal(clicked.length, 1);
    const deadline = Date.now() + 6000;
    while (stripeCalls === before && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(stripeCalls - before, 1);
    await context.close();
  });
});
