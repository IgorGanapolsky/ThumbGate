#!/usr/bin/env node
/**
 * stripe-live-status.js — Pull live financial data from Stripe API.
 * Shows real revenue, not local ledger approximations.
 */

'use strict';

const Stripe = require('stripe');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  console.error('STRIPE_SECRET_KEY not set');
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY);

async function getLiveStatus() {
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

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayCharges = paidCharges.filter(c => c.created * 1000 >= todayStart.getTime());
  const todayRevenue = todayCharges.reduce((sum, c) => sum + c.amount, 0);

  const report = {
    generatedAt: new Date().toISOString(),
    source: 'stripe_live_api',
    balance: {
      available: availableBalance / 100,
      pending: pendingBalance / 100,
      currency: 'USD',
    },
    revenue: {
      grossLifetime: grossRevenue / 100,
      refundedLifetime: refundedAmount / 100,
      netLifetime: (grossRevenue - refundedAmount) / 100,
      today: todayRevenue / 100,
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
      mrr: activeSubs.reduce((sum, s) => sum + (s.plan?.amount || 0), 0) / 100,
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
      amount: p.unit_amount / 100,
      type: p.type,
      interval: p.recurring?.interval || 'one_time',
      product: p.product,
    })),
  };

  return report;
}

async function main() {
  const report = await getLiveStatus();
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main().catch(err => {
    console.error('Stripe live status failed:', err.message);
    process.exit(1);
  });
}

module.exports = { getLiveStatus };
