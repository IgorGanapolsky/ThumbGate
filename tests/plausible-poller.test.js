'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CHECKOUT_EVENT_NAMES,
} = require('../scripts/plausible-server-events');

const {
  CTA_CLICK_EVENT_NAME,
  getFunnelMetrics,
} = require('../scripts/social-analytics/pollers/plausible');

test('getFunnelMetrics queries the canonical Plausible checkout event names', async () => {
  const savedApiKey = process.env.PLAUSIBLE_API_KEY;
  const savedSiteId = process.env.PLAUSIBLE_SITE_ID;
  const savedFetch = global.fetch;
  const urls = [];

  process.env.PLAUSIBLE_API_KEY = 'test_plausible_key';
  process.env.PLAUSIBLE_SITE_ID = 'thumbgate.test';

  const eventCounts = new Map([
    [CTA_CLICK_EVENT_NAME, 10],
    [CHECKOUT_EVENT_NAMES.view, 7],
    [CHECKOUT_EVENT_NAMES.emailSubmitted, 6],
    [CHECKOUT_EVENT_NAMES.stripeRedirect, 5],
    [CHECKOUT_EVENT_NAMES.purchase, 2],
  ]);

  global.fetch = async (url) => {
    urls.push(String(url));
    const parsed = new URL(url);
    const filter = parsed.searchParams.get('filters') || '';
    const eventName = filter.startsWith('event:name==')
      ? filter.slice('event:name=='.length)
      : null;
    const body = eventName
      ? { results: { events: { value: eventCounts.get(eventName) || 0 } } }
      : { results: { visitors: { value: 100 }, pageviews: { value: 150 } } };

    return {
      ok: true,
      json: async () => body,
    };
  };

  try {
    const funnel = await getFunnelMetrics('7d');

    assert.equal(funnel.visitors, 100);
    assert.equal(funnel.cta_clicks, 10);
    assert.equal(funnel.checkout_viewed, 7);
    assert.equal(funnel.email_submitted, 6);
    assert.equal(funnel.stripe_redirects, 5);
    assert.equal(funnel.purchases, 2);
    assert.equal(funnel.visitor_to_purchase_pct, 2);

    const filters = urls
      .map((url) => new URL(url).searchParams.get('filters'))
      .filter(Boolean);
    assert.deepEqual(filters.sort(), [
      `event:name==${CTA_CLICK_EVENT_NAME}`,
      `event:name==${CHECKOUT_EVENT_NAMES.emailSubmitted}`,
      `event:name==${CHECKOUT_EVENT_NAMES.purchase}`,
      `event:name==${CHECKOUT_EVENT_NAMES.stripeRedirect}`,
      `event:name==${CHECKOUT_EVENT_NAMES.view}`,
    ].sort());
  } finally {
    if (savedApiKey === undefined) delete process.env.PLAUSIBLE_API_KEY;
    else process.env.PLAUSIBLE_API_KEY = savedApiKey;
    if (savedSiteId === undefined) delete process.env.PLAUSIBLE_SITE_ID;
    else process.env.PLAUSIBLE_SITE_ID = savedSiteId;
    global.fetch = savedFetch;
  }
});
