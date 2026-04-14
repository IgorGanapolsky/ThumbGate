#!/usr/bin/env node
/**
 * stripe-live-status.js — Pull live financial data from Stripe API.
 * Shows real revenue, not local ledger approximations.
 */

'use strict';

function parseArgs(argv = []) {
  return {
    strict: argv.includes('--strict'),
  };
}

function dollars(cents) {
  return Number(cents || 0) / 100;
}

function unavailableReport(status, gap) {
  return {
    generatedAt: new Date().toISOString(),
    source: 'stripe_live_api',
    status,
    configured: false,
    gaps: [gap],
    balance: {
      available: 0,
      pending: 0,
      currency: 'USD',
    },
    revenue: {
      grossLifetime: 0,
      refundedLifetime: 0,
      netLifetime: 0,
      today: 0,
      todayChargeCount: 0,
    },
    charges: {
      total: 0,
      paid: 0,
      refunded: 0,
      failed: 0,
    },
    subscriptions: {
      active: 0,
      cancelled: 0,
      total: 0,
      mrr: 0,
    },
    checkout: {
      completed: 0,
      expired: 0,
      total: 0,
      conversionRate: '0%',
    },
    products: [],
    activePrices: [],
  };
}

function loadStripe(requireFn = require) {
  return requireFn('stripe');
}

async function getLiveStatus({
  stripeClient = null,
  stripeCtor = null,
  secretKey = process.env.STRIPE_SECRET_KEY,
  now = new Date(),
} = {}) {
  if (!secretKey && !stripeClient) {
    return unavailableReport('missing_secret', 'STRIPE_SECRET_KEY is not set');
  }

  let stripe = stripeClient;
  if (!stripe) {
    let Stripe = stripeCtor;
    try {
      Stripe = Stripe || loadStripe();
    } catch (error) {
      return unavailableReport('missing_dependency', `Stripe SDK is unavailable: ${error.message}`);
    }
    stripe = new Stripe(secretKey);
  }

  const [balance, charges, subscriptions, products, prices, sessions] = await Promise.all([
    stripe.balance.retrieve(),
    stripe.charges.list({ limit: 100 }),
    stripe.subscriptions.list({ limit: 100, status: 'all' }),
    stripe.products.list({ limit: 20, active: true }),
    stripe.prices.list({ limit: 20, active: true }),
    stripe.checkout.sessions.list({ limit: 50 }),
  ]);

  const availableBalance = balance.available.reduce((sum, b) => sum + b.amount, 0);
  const pendingBalance = balance.pending.reduce((sum, b) => sum + b.amount, 0);

  const paidCharges = charges.data.filter(c => c.paid && !c.refunded);
  const refundedCharges = charges.data.filter(c => c.refunded);
  const failedCharges = charges.data.filter(c => c.status === 'failed');

  const grossRevenue = paidCharges.reduce((sum, c) => sum + c.amount, 0);
  const refundedAmount = refundedCharges.reduce((sum, c) => sum + c.amount_refunded, 0);

  const activeSubs = subscriptions.data.filter(s => s.status === 'active');
  const cancelledSubs = subscriptions.data.filter(s => s.status === 'canceled');

  const completedSessions = sessions.data.filter(s => s.payment_status === 'paid');
  const expiredSessions = sessions.data.filter(s => s.status === 'expired');

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayCharges = paidCharges.filter(c => c.created * 1000 >= todayStart.getTime());
  const todayRevenue = todayCharges.reduce((sum, c) => sum + c.amount, 0);

  const report = {
    generatedAt: new Date().toISOString(),
    source: 'stripe_live_api',
    status: 'ok',
    configured: true,
    gaps: [],
    balance: {
      available: dollars(availableBalance),
      pending: dollars(pendingBalance),
      currency: 'USD',
    },
    revenue: {
      grossLifetime: dollars(grossRevenue),
      refundedLifetime: dollars(refundedAmount),
      netLifetime: dollars(grossRevenue - refundedAmount),
      today: dollars(todayRevenue),
      todayChargeCount: todayCharges.length,
    },
    charges: {
      total: charges.data.length,
      paid: paidCharges.length,
      refunded: refundedCharges.length,
      failed: failedCharges.length,
    },
    subscriptions: {
      active: activeSubs.length,
      cancelled: cancelledSubs.length,
      total: subscriptions.data.length,
      mrr: dollars(activeSubs.reduce((sum, s) => sum + (s.plan?.amount || 0), 0)),
    },
    checkout: {
      completed: completedSessions.length,
      expired: expiredSessions.length,
      total: sessions.data.length,
      conversionRate: sessions.data.length > 0
        ? (completedSessions.length / sessions.data.length * 100).toFixed(1) + '%'
        : '0%',
    },
    products: products.data.map(p => ({
      id: p.id,
      name: p.name,
      defaultPrice: p.default_price,
    })),
    activePrices: prices.data.map(p => ({
      id: p.id,
      amount: dollars(p.unit_amount),
      type: p.type,
      interval: p.recurring?.interval || 'one_time',
      product: p.product,
    })),
  };

  return report;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const report = await getLiveStatus();
  console.log(JSON.stringify(report, null, 2));
  if (options.strict && report.status !== 'ok') {
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Stripe live status failed:', err.message);
    process.exit(1);
  });
}

module.exports = { parseArgs, dollars, unavailableReport, getLiveStatus };
