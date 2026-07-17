#!/usr/bin/env node
/**
 * stripe-live-status.js — Pull live financial data from Stripe API.
 * Shows real revenue, not local ledger approximations.
 */

'use strict';

const {
  DEFAULT_SECRET_PATHS,
  resolveStripeSecretKey,
} = require('./stripe-credentials');
const {
  listAllPaged,
  subscriptionMRRCents,
} = require('./external-customer-audit');

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
    credentialSource: null,
    gaps: [gap],
    attribution: {
      scope: 'stripe_account_wide_unattributed',
      thumbgateVerified: false,
      note: 'Account-wide Stripe activity is not ThumbGate product or external-customer revenue proof.',
    },
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
      statusComplete: 0,
      paymentStatusPaid: 0,
      positiveAmountPaid: 0,
      zeroAmountPaidStatus: 0,
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

function createStripeClient(stripeFactory, secretKey) {
  if (typeof stripeFactory !== 'function') {
    throw new TypeError('Stripe SDK did not export a client factory');
  }
  return stripeFactory(secretKey);
}

async function getLiveStatus({
  stripeClient = null,
  stripeCtor = null,
  secretKey,
  env = process.env,
  secretPaths = DEFAULT_SECRET_PATHS,
  catalogOutputLimit = 20,
  now = new Date(),
} = {}) {
  let credentialSource = stripeClient ? 'injected_client' : null;
  let resolvedSecretKey = null;
  if (!stripeClient) {
    const credential = secretKey === undefined
      ? resolveStripeSecretKey({ env, secretPaths })
      : {
        secretKey: String(secretKey || '').trim() || null,
        source: String(secretKey || '').trim() ? 'argument' : null,
      };
    resolvedSecretKey = credential.secretKey;
    credentialSource = credential.source;
  }

  if (!resolvedSecretKey && !stripeClient) {
    return unavailableReport(
      'missing_secret',
      'STRIPE_SECRET_KEY is not set and no managed local key file is available',
    );
  }

  let stripe = stripeClient;
  if (!stripe) {
    let stripeFactory = stripeCtor;
    try {
      stripeFactory = stripeFactory || loadStripe();
      stripe = createStripeClient(stripeFactory, resolvedSecretKey);
    } catch (error) {
      return unavailableReport('missing_dependency', `Stripe SDK is unavailable: ${error.message}`);
    }
  }

  if (
    !stripe ||
    !stripe.balance ||
    typeof stripe.balance.retrieve !== 'function' ||
    !stripe.charges ||
    typeof stripe.charges.list !== 'function' ||
    !stripe.subscriptions ||
    typeof stripe.subscriptions.list !== 'function' ||
    !stripe.products ||
    typeof stripe.products.list !== 'function' ||
    !stripe.prices ||
    typeof stripe.prices.list !== 'function' ||
    !stripe.checkout ||
    !stripe.checkout.sessions ||
    typeof stripe.checkout.sessions.list !== 'function'
  ) {
    return unavailableReport('missing_dependency', 'Stripe SDK did not create a client');
  }

  const balanceApi = stripe.balance;
  const chargesApi = stripe.charges;
  const subscriptionsApi = stripe.subscriptions;
  const productsApi = stripe.products;
  const pricesApi = stripe.prices;
  const checkoutSessionsApi = stripe.checkout.sessions;

  const [balance, charges, subscriptions, products, prices, sessions] = await Promise.all([
    balanceApi.retrieve(),
    listAllPaged((params) => chargesApi.list(params)),
    listAllPaged((params) => subscriptionsApi.list(params), { status: 'all' }),
    listAllPaged((params) => productsApi.list(params), { active: true }),
    listAllPaged((params) => pricesApi.list(params), { active: true }),
    listAllPaged((params) => checkoutSessionsApi.list(params)),
  ]);

  const availableBalance = balance.available.reduce((sum, b) => sum + b.amount, 0);
  const pendingBalance = balance.pending.reduce((sum, b) => sum + b.amount, 0);

  const successfulCharges = charges.filter((charge) => (
    charge.status === 'succeeded' || charge.paid === true
  ));
  const refundedCharges = successfulCharges.filter((charge) => Number(charge.amount_refunded || 0) > 0);
  const failedCharges = charges.filter((charge) => charge.status === 'failed');

  const grossRevenue = successfulCharges.reduce((sum, c) => sum + Number(c.amount || 0), 0);
  const refundedAmount = refundedCharges.reduce((sum, c) => sum + c.amount_refunded, 0);

  const activeSubs = subscriptions.filter(s => s.status === 'active');
  const cancelledSubs = subscriptions.filter(s => s.status === 'canceled');

  const statusCompleteSessions = sessions.filter((session) => session.status === 'complete');
  const paymentStatusPaidSessions = sessions.filter((session) => session.payment_status === 'paid');
  const positiveAmountPaidSessions = paymentStatusPaidSessions.filter((session) => Number(session.amount_total || 0) > 0);
  const zeroAmountPaidStatusSessions = paymentStatusPaidSessions.filter((session) => Number(session.amount_total || 0) <= 0);
  const expiredSessions = sessions.filter(s => s.status === 'expired');

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayCharges = successfulCharges.filter(c => c.created * 1000 >= todayStart.getTime());
  const todayGross = todayCharges.reduce((sum, c) => sum + Number(c.amount || 0), 0);
  const todayRefunded = todayCharges.reduce((sum, c) => sum + Number(c.amount_refunded || 0), 0);
  const todayNet = todayGross - todayRefunded;

  const report = {
    generatedAt: new Date().toISOString(),
    source: 'stripe_live_api',
    status: 'ok',
    configured: true,
    credentialSource,
    gaps: [],
    attribution: {
      scope: 'stripe_account_wide_unattributed',
      thumbgateVerified: false,
      note: 'Account-wide Stripe activity is not ThumbGate product or external-customer revenue proof. Use external-customer-audit.js for attribution.',
    },
    balance: {
      available: dollars(availableBalance),
      pending: dollars(pendingBalance),
      currency: 'USD',
    },
    revenue: {
      grossLifetime: dollars(grossRevenue),
      refundedLifetime: dollars(refundedAmount),
      netLifetime: dollars(grossRevenue - refundedAmount),
      today: dollars(todayNet),
      todayGross: dollars(todayGross),
      todayRefunded: dollars(todayRefunded),
      todayNet: dollars(todayNet),
      todayChargeCount: todayCharges.length,
    },
    charges: {
      total: charges.length,
      paid: successfulCharges.length,
      refunded: refundedCharges.length,
      failed: failedCharges.length,
    },
    subscriptions: {
      active: activeSubs.length,
      cancelled: cancelledSubs.length,
      total: subscriptions.length,
      mrr: dollars(activeSubs.reduce((sum, subscription) => sum + subscriptionMRRCents(subscription), 0)),
    },
    checkout: {
      completed: positiveAmountPaidSessions.length,
      statusComplete: statusCompleteSessions.length,
      paymentStatusPaid: paymentStatusPaidSessions.length,
      positiveAmountPaid: positiveAmountPaidSessions.length,
      zeroAmountPaidStatus: zeroAmountPaidStatusSessions.length,
      expired: expiredSessions.length,
      total: sessions.length,
      conversionRate: sessions.length > 0
        ? (positiveAmountPaidSessions.length / sessions.length * 100).toFixed(1) + '%'
        : '0%',
    },
    catalog: {
      activeProductCount: products.length,
      activePriceCount: prices.length,
      outputLimit: catalogOutputLimit,
      productsTruncated: products.length > catalogOutputLimit,
      pricesTruncated: prices.length > catalogOutputLimit,
    },
    products: products.slice(0, catalogOutputLimit).map(p => ({
      id: p.id,
      name: p.name,
      defaultPrice: p.default_price,
    })),
    activePrices: prices.slice(0, catalogOutputLimit).map(p => ({
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
