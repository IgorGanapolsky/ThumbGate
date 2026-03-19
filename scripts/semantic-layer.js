#!/usr/bin/env node
/**
 * scripts/semantic-layer.js
 * 
 * The Foundation of Enterprise AI for mcp-memory-gateway.
 * Centralizes business logic, metrics, and entity definitions.
 */
const { getBillingSummary } = require('./billing');
const { getTelemetryAnalytics } = require('./telemetry-analytics');
const { resolveAnalyticsWindow } = require('./analytics-window');

/**
 * Canonical Schema for Business Entities and Metrics.
 * Replaces direct file parsing with reasoning-oriented concepts.
 */
const SemanticSchema = {
  entities: {
    Customer: {
      description: 'An individual or organization using the gateway.',
      states: ['active', 'disabled'],
      tiers: ['free', 'pro', 'enterprise-sprint'],
    },
    Revenue: {
      description: 'Financial value captured by the system.',
      types: ['booked', 'reconciled', 'projected'],
    },
    Funnel: {
      description: 'The journey from anonymous visitor to paid customer.',
      stages: ['visitor', 'checkout_start', 'acquisition', 'paid'],
    },
  },
  metrics: {
    ConversionRate: {
      description: 'The percentage of unique visitors who become paid customers.',
      calculation: 'paid_customers / unique_visitors',
    },
    BookedRevenue: {
      description: 'Total revenue documented in the system (Stripe + GitHub + Manual).',
      unit: 'cents',
    },
    ActiveProUsers: {
      description: 'Count of unique customers with at least one active Pro API key.',
    },
  },
};

async function getBusinessMetrics(options = {}) {
  const window = resolveAnalyticsWindow(options);
  const billing = getBillingSummary(window);
  const { getFeedbackPaths } = require('./feedback-loop');
  const feedbackDir = options.feedbackDir || getFeedbackPaths().FEEDBACK_DIR;
  const telemetry = getTelemetryAnalytics(feedbackDir, window);

  const uniqueVisitors = telemetry.visitors.uniqueVisitors || 0;
  const paidCustomers = billing.revenue.paidCustomers || 0;
  const bookedRevenueCents = billing.revenue.bookedRevenueCents || 0;

  return {
    generatedAt: new Date().toISOString(),
    window: billing.window,
    metrics: {
      uniqueVisitors,
      checkoutStarts: telemetry.ctas.checkoutStarts || 0,
      acquisitionLeads: billing.signups.uniqueLeads || 0,
      paidCustomers,
      bookedRevenueCents,
      bookedRevenueFormatted: `$${(bookedRevenueCents / 100).toFixed(2)}`,
      conversionRate: safeRate(paidCustomers, uniqueVisitors),
      leadToPaidRate: safeRate(paidCustomers, billing.signups.uniqueLeads || 0),
      activeProKeys: billing.keys.active || 0,
      totalUsage: billing.keys.totalUsage || 0,
    },
    attribution: billing.attribution,
    status: {
      isPostFirstDollar: paidCustomers > 0 || bookedRevenueCents > 0,
      hasActivePipeline: (telemetry.ctas.checkoutStarts || 0) > 0 || billing.signups.uniqueLeads > 0,
    }
  };
}

async function getEntityDetails(type, id, options = {}) {
  const summary = await getBusinessMetrics(options);
  
  if (type === 'customer' || type === 'Customer') {
    const { loadKeyStore } = require('./billing');
    const store = loadKeyStore();
    const customerKeys = Object.entries(store.keys).filter(([, m]) => m.customerId === id);
    if (!customerKeys.length) return null;

    return {
      type: 'Customer',
      id,
      active: customerKeys.some(([, m]) => m.active),
      totalKeys: customerKeys.length,
      usageCount: customerKeys.reduce((sum, [, m]) => sum + (m.usageCount || 0), 0),
      createdAt: customerKeys.map(([, m]) => m.createdAt).sort()[0],
    };
  }

  if (type === 'campaign' || type === 'Campaign') {
    const attr = summary.attribution;
    return {
      type: 'Campaign',
      id,
      leads: attr.acquisitionByCampaign[id] || 0,
      paidOrders: attr.paidByCampaign[id] || 0,
      revenueCents: attr.bookedRevenueByCampaignCents[id] || 0,
    };
  }

  return null;
}

function safeRate(num, den) {
  if (!den) return 0;
  return Number((num / den).toFixed(4));
}

function describeSemanticSchema() {
  return SemanticSchema;
}

module.exports = {
  getBusinessMetrics,
  getEntityDetails,
  describeSemanticSchema,
  SemanticSchema,
};
