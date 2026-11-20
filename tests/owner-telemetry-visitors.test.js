'use strict';

// Visitors are distinct visitor identifiers seen on ANY web event; page views are landing_page_view events only, so
// the two are different measures and identifiers can exceed page views. The headline excludes bot, internal and test
// identifiers. `pageViewers` is the identifiers with at least one landing page view, which never exceeds page views.

process.env.NODE_ENV = 'test';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readTrafficWindow } = require('../scripts/owner-telemetry');

const hoursAgo = (hours) => new Date(Date.now() - hours * 3600000).toISOString();
const row = (hours, eventType, who, extra = {}) => JSON.stringify({ receivedAt: hoursAgo(hours), clientType: 'web', eventType, visitorId: who, ...extra });

function readFixture(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-visitors-'));
  fs.writeFileSync(path.join(dir, 'telemetry-pings.jsonl'), lines.join('\n') + '\n');
  return readTrafficWindow({ feedbackDir: dir, days: 30 }).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

test('identifiers come from any web event, page views from landing_page_view only, and the flagged ones are left out of the headline', async () => {
  const lines = [
    row(50, 'landing_page_view', 'v1'),
    row(49, 'landing_page_view', 'v1'),
    row(30, 'landing_page_view', 'v2'),
    row(29, 'cta_click', 'c1'),
    row(28, 'checkout_start', 'c2'),
    row(27, 'pro_checkout_direct_stripe', 'c3', { isInternal: true }),
    row(26, 'checkout_interstitial_view', 'c4', { isTest: true }),
    row(25, 'section_view', 'c5'),
    row(5, 'landing_page_view', 'v3', { isBotTraffic: true }),
  ];
  const { traffic, daily } = await readFixture(lines);
  assert.equal(traffic.pageViews, 4);
  assert.equal(traffic.visitors, 8, 'all identifiers: v1, v2, v3 and c1 to c5');
  assert.ok(traffic.visitors > traffic.pageViews, 'identifiers may exceed page views: they count different events');
  assert.equal(traffic.realVisitors, 5, 'v3 (bot), c3 (internal) and c4 (test) are left out');
  assert.equal(traffic.botOrInternalVisitors, 3);
  assert.equal(traffic.pageViewers, 3);
  assert.ok(traffic.pageViewers <= traffic.pageViews);
  for (const day of daily) assert.ok(day.pageViewers <= day.pageViews, day.date);
});

test('checkout starts are counted per event type so the total can be explained', async () => {
  const lines = [
    row(10, 'pro_checkout_direct_stripe', 'a'),
    row(9, 'pro_checkout_direct_stripe', 'b'),
    row(8, 'checkout_start', 'c'),
    row(7, 'checkout_bootstrap', 'd'),
    row(6, 'diagnostic_checkout_confirmed', 'e'),
  ];
  const { traffic } = await readFixture(lines);
  assert.equal(traffic.checkoutStarts, 5);
  assert.deepEqual(traffic.checkoutStartsByType, { pro_checkout_direct_stripe: 2, checkout_start: 1, checkout_bootstrap: 1, diagnostic_checkout_confirmed: 1 });
});
