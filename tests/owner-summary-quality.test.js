'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbgate-summary-quality-'));
process.env.THUMBGATE_FEEDBACK_DIR = root;
process.env.STRIPE_SECRET_KEY = '';
const admin = require('../scripts/owner-admin');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const stripe = { checkout: { sessions: { list: async () => ({ data: [], has_more: false }) } }, subscriptions: { list: async () => ({ data: [], has_more: false }) } };
const deps = (reconciliation) => ({ feedbackDir: root, getStripeClient: () => stripe, getOwnerEmails: () => [], moneyCacheMs: 0, telemetryCacheMs: 0, lastGoodMs: 0,
  getBillingSummaryLive: async () => ({ reconciliation, signups: { emailSignups: 0 }, revenue: { external: { paidOrders: 0, bookedRevenueByCurrency: {} } } }) });

test('incomplete reconciliation never becomes a verified-zero paid order summary', async () => {
  for (const status of ['timeout', 'partial', 'unavailable', 'unconfigured']) {
    const summary = await admin.collectSummary(deps({ status, complete: false }));
    for (const key of ['analytics.external_paid_orders', 'analytics.external_booked_revenue_30d']) {
      assert.equal(summary.data.fields[key].status, 'partial', status + ':' + key);
      assert.match(summary.data.fields[key].reason, /reconciliation/i);
    }
    assert.equal(summary.data.fields['analytics.email_signups'].status, 'verified_zero', 'independent signup records keep their own completeness');
  }
});

test('a completed reconciliation retains verified-zero paid orders', async () => {
  const summary = await admin.collectSummary(deps({ status: 'ok', complete: true }));
  assert.equal(summary.data.fields['analytics.external_paid_orders'].status, 'verified_zero');
});
