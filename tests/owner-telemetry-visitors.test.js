'use strict';

// Visitors and page views come from the same events: a visitor is an identity with at least one page view,
// so visitors can never exceed page views, in total or on any day. Identities that logged only other web
// events (CTA clicks, checkout steps) are reported as `identities`, not as visitors.

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

test('visitors never exceed page views when many identities log events without a page view', async () => {
  const lines = [
    row(50, 'landing_page_view', 'v1'),
    row(49, 'landing_page_view', 'v1'),
    row(30, 'landing_page_view', 'v2'),
    // Identities that never viewed a page: the old count counted every one of these as a visitor.
    row(29, 'cta_click', 'c1'),
    row(28, 'checkout_start', 'c2'),
    row(27, 'pro_checkout_direct_stripe', 'c3'),
    row(26, 'checkout_interstitial_view', 'c4'),
    row(25, 'section_view', 'c5'),
    row(5, 'landing_page_view', 'v3', { isBotTraffic: true }),
  ];
  const { traffic, daily } = await readFixture(lines);
  assert.equal(traffic.pageViews, 4);
  assert.equal(traffic.visitors, 3, 'v1, v2 and v3 viewed a page');
  assert.ok(traffic.visitors <= traffic.pageViews);
  assert.equal(traffic.identities, 8, 'the five identities with no page view are counted here, not as visitors');
  assert.equal(traffic.realVisitors, 2);
  assert.equal(traffic.botOrInternalVisitors, 1);
  for (const day of daily) assert.ok(day.visitors <= day.pageViews, day.date);
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
