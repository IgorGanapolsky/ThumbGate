'use strict';
// Money board Stripe reads: paging with starting_after, waiting for a free read slot instead of failing "busy",
// one shared deadline, and the last good result for five minutes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const feedbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-money-stripe-'));
process.env.THUMBGATE_FEEDBACK_DIR = feedbackDir;
const admin = require('../scripts/owner-admin');
const billing = require('../scripts/billing');

const nowSec = Math.floor(Date.now() / 1000);
const makeSessions = (count) => Array.from({ length: count }, (_, i) => ({
  id: 'cs_' + String(i).padStart(4, '0'), success_url: 'https://thumbgate.ai/success', metadata: { uaClass: 'browser' },
  status: 'open', payment_status: 'unpaid', created: nowSec - i * 60,
}));

// Like Stripe: newest first, `limit` rows a page, the next page starts after `starting_after`.
function stripeWith(sessions, { calls = [], delayMs = 0, failWith = null, honorTimeout = true } = {}) {
  return {
    checkout: { sessions: { list: async (params = {}, options = {}) => {
      calls.push({ params, options });
      if (failWith) throw failWith;
      if (delayMs) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, delayMs);
          if (honorTimeout && options.timeout) setTimeout(() => { clearTimeout(timer); reject(Object.assign(new Error('request timed out'), { code: 'ETIMEDOUT' })); }, options.timeout);
        });
      }
      const rows = sessions.filter((row) => !(params.status && row.status !== params.status) && !(params.created?.gte && row.created < params.created.gte));
      const start = params.starting_after ? rows.findIndex((row) => row.id === params.starting_after) + 1 : 0;
      const limit = params.limit || 10;
      return { data: rows.slice(start, start + limit), has_more: start + limit < rows.length };
    } } },
    subscriptions: { list: async () => ({ has_more: false, data: [] }) },
  };
}

const deps = (stripe, extra = {}) => ({
  feedbackDir, getStripeClient: () => stripe, getOwnerEmails: () => [], moneyCacheMs: 0, lastGoodMs: 0, telemetryCacheMs: 0,
  getBillingSummaryLive: async () => ({ signups: {}, pipeline: {}, newsletter: {} }), ...extra,
});
const money = async (d) => (await admin.collectAdminSection({ section: 'money' }, { ...d, sectionTimeoutMs: 15000 })).data;

test('a list longer than one page is read with starting_after until Stripe says there are no more', async () => {
  const calls = [];
  const data = await money(deps(stripeWith(makeSessions(250), { calls })));
  const sessionPages = calls.filter((c) => !c.params.status);
  assert.equal(sessionPages.length, 3, '250 sessions at 100 a page is three pages');
  assert.deepEqual(sessionPages.map((c) => c.params.starting_after || null), [null, 'cs_0099', 'cs_0199']);
  assert.ok(sessionPages.every((c) => c.params.limit === 100));
  assert.equal(data.checkouts30d.started, 250);
  assert.equal(data.checkouts7d.started, 250);
  assert.equal(data.reasons.checkouts, null);
});

test('a read that finds both Stripe slots taken waits for one instead of reporting "busy"', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const holders = [billing.withStripeReadSlot(() => gate), billing.withStripeReadSlot(() => gate)];
  setTimeout(release, 250);
  const started = Date.now();
  const data = await money(deps(stripeWith(makeSessions(5))));
  await Promise.all(holders);
  assert.ok(Date.now() - started >= 200, 'it waited for the slot');
  assert.equal(data.checkouts7d.started, 5);
  assert.deepEqual(Object.values(data.reasons).filter((reason) => /busy/i.test(String(reason))), []);
});

test('one shared deadline: a Stripe that never answers gives a plain reason, and the slots are free afterwards', async () => {
  const started = Date.now();
  const data = await money(deps(stripeWith(makeSessions(5), { delayMs: 5000 }), { stripeDeadlineMs: 300 }));
  assert.ok(Date.now() - started < 3000, 'the whole call stays near the deadline, not one deadline per block');
  assert.equal(data.checkouts7d, null);
  assert.equal(data.reasons.checkouts, 'Stripe did not answer in time');
  assert.equal(data.reasons.revenue, 'Stripe did not answer in time');
  await new Promise((resolve) => setTimeout(resolve, 450));
  const free = await Promise.all([billing.withStripeReadSlot(async () => 'a'), billing.withStripeReadSlot(async () => 'b')]);
  assert.deepEqual(free, ['a', 'b'], 'no slot was left held by the timed-out reads');
});

test('a block that fails shows its last good result for five minutes, says so, and never invents a number', async () => {
  const good = await money(deps(stripeWith(makeSessions(7)), { lastGoodMs: 300000 }));
  assert.equal(good.checkouts7d.started, 7);
  const failing = stripeWith(makeSessions(7), { failWith: Object.assign(new Error('boom'), { type: 'StripeAPIError' }) });
  const stale = await admin.collectAdminSection({ section: 'money' }, { ...deps(failing, { lastGoodMs: 300000 }), sectionTimeoutMs: 15000 });
  assert.equal(stale.status, 'partial');
  assert.ok(stale.warnings.includes('showing_last_good_stripe_numbers'));
  assert.equal(stale.data.checkouts7d.started, 7);
  assert.ok(stale.data.notes.some((line) => /last good checkout counts from \d+ minutes? ago/.test(line)));
  const expired = await money(deps(failing, { lastGoodMs: 1 }));
  assert.equal(expired.checkouts7d, null, 'past the limit the numbers go away');
  assert.equal(expired.reasons.checkouts, 'Stripe unavailable');
});

test('the 30-day list is cut at 4,000 sessions and says it is a lower bound', async () => {
  const data = await admin.collectAdminSection({ section: 'money' }, { ...deps(stripeWith(makeSessions(4100))), sectionTimeoutMs: 15000 });
  assert.equal(data.data.checkouts30d.started, 4000);
  assert.ok(data.warnings.includes('checkout_list_partial'));
  assert.ok(data.data.notes.some((line) => /lower bound/.test(line)));
});
