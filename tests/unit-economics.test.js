'use strict';

// Owner console unit economics: the cost meter, delivery cost per install and per paying customer, and contribution per plan.

process.env.NODE_ENV = 'test';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const costMeter = require('../scripts/cost-meter');
const { computeUnitEconomics, hostingCost, planContribution, loadUnitCosts } = require('../scripts/unit-economics');

const costs = loadUnitCosts();
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tg-econ-'));

test('the shipped rate card parses and names a source for every rate', () => {
  assert.ok(costs, 'config/unit-costs.json must parse');
  for (const block of ['hosting', 'email', 'payments']) assert.match(costs[block].source, /https:\/\//, `${block} needs a source`);
  assert.equal(costs.hosting.vcpuMonthUsd, 20);
  assert.equal(costs.hosting.memoryGbMonthUsd, 10);
  assert.deepEqual(costs.fixedDeliveryMonthly, [], 'no fixed cost is invented');
});

test('the cost meter adds CPU and memory between samples, skips gaps, counts emails and survives a restart', () => {
  const dir = tmp();
  try {
    costMeter.reset();
    costMeter.configure({ feedbackDir: dir });
    const t0 = Date.UTC(2026, 10, 24, 12);
    const gb = 1e9;
    assert.equal(costMeter.sample({ nowMs: t0, counters: { source: 'container', cpuSeconds: 100, memoryBytes: gb } }), null, 'the first sample only sets a baseline');
    assert.deepEqual(costMeter.sample({ nowMs: t0 + 60000, counters: { source: 'container', cpuSeconds: 106, memoryBytes: gb } }), { seconds: 60, cpuSeconds: 6 });
    assert.equal(costMeter.sample({ nowMs: t0 + 60000 + 3600000, counters: { source: 'container', cpuSeconds: 107, memoryBytes: gb } }), null, 'an hour-long gap is skipped');
    assert.equal(costMeter.sample({ nowMs: t0 + 3720000, counters: { source: 'container', cpuSeconds: 50, memoryBytes: gb } }), null, 'a counter reset is skipped');
    costMeter.recordEmailSend({ nowMs: t0 });
    costMeter.recordEmailSend({ nowMs: t0, count: 2 });
    assert.equal(costMeter.flush(t0 + 3720000), true);
    costMeter.reset();
    const window = costMeter.readWindow({ feedbackDir: dir, days: 30, nowMs: t0 + 86400000 });
    assert.equal(window.sampledSeconds, 60);
    assert.equal(window.cpuSeconds, 6);
    assert.equal(window.memoryGbSeconds, 60);
    assert.equal(window.emails, 3);
    assert.deepEqual(window.sources, ['container']);
    const saved = fs.readFileSync(path.join(dir, costMeter.FILE), 'utf8');
    assert.doesNotMatch(saved, /@/, 'no address is ever stored');
  } finally { costMeter.reset(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('hosting at Railway list rates: one vCPU and one GB for a full month cost $30 plus volume and egress', () => {
  const month = 30 * 86400;
  const full = hostingCost({ sampledSeconds: month, cpuSeconds: month, memoryGbSeconds: month, coverage: 1, sources: ['container'] }, costs.hosting);
  const extras = costs.hosting.volumeGb * costs.hosting.volumeGbMonthUsd + costs.hosting.egressGbPerMonth * costs.hosting.egressGbUsd;
  assert.equal(full.basis, 'measured_30d');
  assert.equal(full.usd, Math.round((30 + extras) * 10000) / 10000);
  const half = hostingCost({ sampledSeconds: month / 2, cpuSeconds: month / 2, memoryGbSeconds: month / 2, coverage: 0.5 }, costs.hosting);
  assert.equal(half.basis, 'projected_from_partial_window');
  assert.equal(half.usd, full.usd, 'half a month at the same load projects to the same month');
  assert.match(half.reason, /50%/);
  assert.equal(hostingCost({ sampledSeconds: 0, coverage: 0 }, costs.hosting).usd, null, 'no samples is no number, not $0');
});

test('a $19 Pro sale keeps price minus card fee, Billing fee and the serving cost of one install', () => {
  const pro = planContribution({ priceUsd: 19, recurring: true, costPerCustomerUsd: 0.5, rates: costs.payments });
  assert.equal(pro.paymentFeeUsd, Math.round((19 * 0.029 + 0.3 + 19 * 0.007) * 100) / 100);
  assert.equal(pro.contributionUsd, Math.round((19 - (19 * 0.029 + 0.3 + 19 * 0.007) - 0.5) * 100) / 100);
  const sprint = planContribution({ priceUsd: 499, recurring: false, costPerCustomerUsd: 0, rates: costs.payments, laborNote: 'labor left out' });
  assert.equal(sprint.paymentFeeUsd, Math.round((499 * 0.029 + 0.3) * 100) / 100, 'a one-time sale pays no Billing fee');
  assert.equal(sprint.laborNote, 'labor left out');
});

test('the board divides delivery cost by active installs and paying customers, and never adds other currencies', () => {
  const month = 30 * 86400;
  const meter = { sampledSeconds: month, cpuSeconds: month * 0.01, memoryGbSeconds: month * 1, coverage: 1, emails: 1000, sources: ['container'] };
  const money = {
    payingCustomers: 4, activePro: 3,
    mrr: { USD: 5700, EUR: 1900 },
    revenueLast30Days: { USD: 49900 },
    recurring30d: { renewalRevenue: { USD: 3800 }, renewalInvoices: 2 },
    paymentFees30d: { reportedFees: { USD: 1477 }, unreportedCharges: 0, unreportedAmount: {}, subscriptionFirstCharges: {} },
    usage30d: { activeInstalls30d: 50 },
  };
  const board = computeUnitEconomics({ money, usage: money.usage30d, meter, costs });
  assert.equal(board.status, 'ok');
  assert.equal(board.delivery.emails, 1000);
  assert.equal(board.delivery.emailUsd, 0.4);
  assert.equal(board.delivery.paymentFees.reportedUsd, 14.77);
  assert.ok(board.delivery.paymentFees.estimatedUsd > 0, 'renewals are estimated at the published rate');
  assert.equal(board.revenue.totalUsd, 537);
  assert.equal(board.perActiveInstallUsd, Math.round(((board.delivery.hostingUsd + 0.4) / 50) * 10000) / 10000);
  assert.equal(board.perPayingCustomerUsd, Math.round((board.delivery.totalUsd / 4) * 10000) / 10000);
  assert.equal(board.plans.pro.priceBasis, 'stripe_average_active_subscription');
  assert.equal(board.plans.pro.priceUsd, 19);
  assert.match(board.reasons.currencies, /EUR/);
  assert.equal(board.contribution.revenueUsd, 537);
});

test('no installs, no customers and no meter give reasons instead of zeros', () => {
  const board = computeUnitEconomics({ money: { payingCustomers: 0, activePro: 0, mrr: {}, revenueLast30Days: {}, recurring30d: null, paymentFees30d: null }, usage: { activeInstalls30d: 0 }, meter: null, costs });
  assert.equal(board.status, 'partial');
  assert.equal(board.perActiveInstallUsd, null);
  assert.equal(board.perPayingCustomerUsd, null);
  assert.ok(board.reasons.hosting && board.reasons.activeInstalls && board.reasons.payingCustomers);
  assert.equal(board.plans.pro.priceBasis, 'list_price');
});
