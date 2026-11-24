'use strict';

// Money tab checkout panel: sessions created before the bot check began are reported as not classified; people, bots
// and owner counts cover only sessions created after it; the gap between the site's own start events and Stripe's
// sessions is shown with its reason. Counts only, no customer data.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-checkout-panel-'));
process.env.THUMBGATE_FEEDBACK_DIR = root;
process.env.STRIPE_SECRET_KEY = '';
process.env.THUMBGATE_BILLING_SUMMARY_SOURCE = 'local';
process.env.THUMBGATE_OWNER_EMAILS = 'owner@example.invalid';
const admin = require('../scripts/owner-admin');
const { BOT_CHECK_BEGAN_AT, BOT_CHECK_BEGAN_LABEL } = require('../scripts/checkout-session-count');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const nowSec = Math.floor(Date.now() / 1000);
const DAY = 86400;
const cutoff = new Date((nowSec - 2 * DAY) * 1000).toISOString();
const session = (id, created, metadata = {}, extra = {}) => ({ id, created, success_url: 'https://thumbgate.ai/success', metadata, status: 'open', payment_status: 'unpaid', ...extra });
const rows = [
  // Before the bot check: no class on record.
  session('a1', nowSec - 5 * DAY), session('a2', nowSec - 4 * DAY), session('a3', nowSec - 3 * DAY),
  // After it.
  session('b1', nowSec - DAY, { uaClass: 'browser' }),
  session('b2', nowSec - DAY + 60, { uaClass: 'bot' }),
  session('b3', nowSec - 3600, { uaClass: 'browser' }, { customer_email: 'owner@example.invalid' }),
];
const stripe = { checkout: { sessions: { list: async (params = {}) => ({ data: rows.filter((row) => !params.status || row.status === params.status), has_more: false }) } }, subscriptions: { list: async () => ({ data: [], has_more: false }) } };

function writeTelemetry(starts) {
  const stamp = new Date(Date.now() - 3600000).toISOString();
  const lines = [{ receivedAt: stamp, clientType: 'web', eventType: 'landing_page_view', visitorId: 'v1' }];
  for (const [type, count] of Object.entries(starts)) for (let i = 0; i < count; i += 1) lines.push({ receivedAt: stamp, clientType: 'web', eventType: type, visitorId: 'c' + type + i });
  fs.writeFileSync(path.join(root, 'telemetry-pings.jsonl'), lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
}
const deps = (extra = {}) => ({ feedbackDir: root, getStripeClient: () => stripe, getOwnerEmails: () => ['owner@example.invalid'], getBillingSummaryLive: async () => ({}), moneyCacheMs: 0, telemetryCacheMs: 0, lastGoodMs: 0, ...extra });

test('sessions before the bot check are the not-classified headline; people, bots and owner count only sessions after it', async () => {
  writeTelemetry({ checkout_start: 3, pro_checkout_direct_stripe: 4 });
  const { data } = await admin.collectAdminSection({ section: 'money' }, deps({ botCheckBeganAt: cutoff }));
  const panel = data.checkoutBotCheck;
  assert.equal(panel.notClassified, 3, 'the three sessions with no class on record');
  assert.equal(panel.beforeBotCheck.started, 3);
  assert.equal(panel.beforeBotCheck.human + panel.beforeBotCheck.bot + panel.beforeBotCheck.internal, 0, 'nothing before the bot check is called a person, bot or owner');
  assert.equal(panel.sinceBotCheck.started, 3);
  assert.equal(panel.sinceBotCheck.human, 1);
  assert.equal(panel.sinceBotCheck.bot, 1);
  assert.equal(panel.sinceBotCheck.internal, 1);
  assert.equal(panel.sinceBotCheck.notClassified, 0);
  assert.equal(panel.beforeBotCheck.started + panel.sinceBotCheck.started, data.checkouts30d.started, 'every session is in exactly one of the two groups');
  assert.equal(panel.botCheckBeganAt, cutoff);
  assert.equal(panel.firstClassifiedAt, new Date((nowSec - DAY) * 1000).toISOString(), 'the earliest session with a class on record');
});

test('the gap between site start events and Stripe sessions is shown with its reason, never hidden', async () => {
  writeTelemetry({ checkout_start: 3, pro_checkout_direct_stripe: 4 });
  const { data } = await admin.collectAdminSection({ section: 'money' }, deps({ botCheckBeganAt: cutoff }));
  const gap = data.checkoutBotCheck.siteVersusStripe;
  assert.equal(gap.siteStarts, 7);
  assert.equal(gap.stripeSessions, 6);
  assert.equal(gap.difference, 1);
  assert.equal(gap.status, 'unexplained');
  assert.match(gap.reason, /^Unexplained\./);
  assert.deepEqual(gap.siteStartsByType, { checkout_start: 3, pro_checkout_direct_stripe: 4 });

  writeTelemetry({ checkout_start: 6 });
  const equal = (await admin.collectAdminSection({ section: 'money' }, deps({ botCheckBeganAt: cutoff }))).data.checkoutBotCheck.siteVersusStripe;
  assert.equal(equal.difference, 0);
  assert.equal(equal.status, 'match');
});

test('with no telemetry the panel still shows the session groups and says nothing about the gap', async () => {
  fs.rmSync(path.join(root, 'telemetry-pings.jsonl'), { force: true });
  const { data } = await admin.collectAdminSection({ section: 'money' }, deps({ botCheckBeganAt: cutoff }));
  assert.equal(data.checkoutBotCheck.siteVersusStripe, null);
  assert.equal(data.checkoutBotCheck.notClassified, 3);
});

test('without an override the panel uses the date the human-click gate went live', async () => {
  const { data } = await admin.collectAdminSection({ section: 'money' }, deps());
  assert.equal(data.checkoutBotCheck.botCheckBeganAt, BOT_CHECK_BEGAN_AT);
  assert.equal(data.checkoutBotCheck.botCheckBeganLabel, BOT_CHECK_BEGAN_LABEL);
});
