#!/usr/bin/env node
/**
 * scripts/semantic-layer.js
 * 
 * The Foundation of Enterprise AI for mcp-memory-gateway.
 * Centralizes business logic, metrics, and entity definitions.
 */
const { materializeAgenticDataPipeline } = require('./agentic-data-pipeline');

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
    DataPipeline: {
      description: 'The staged analytics pipeline that materializes raw, staging, semantic, and lineage artifacts.',
      stages: ['raw', 'staging', 'semantic', 'lineage'],
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
    AttributionCoverageRate: {
      description: 'The share of tracked web page views carrying attribution metadata.',
      unit: 'ratio',
    },
    UnreconciledPaidEvents: {
      description: 'Count of paid events still waiting for billing reconciliation.',
      unit: 'count',
    },
    PipelineWarnings: {
      description: 'Warning count emitted by the staged analytics reconciliation checks.',
      unit: 'count',
    },
    PredictedBookedRevenue: {
      description: 'Model-assisted projection of likely booked revenue from current funnel and attribution signals.',
      unit: 'cents',
    },
    IncrementalRevenueOpportunity: {
      description: 'Forecasted revenue left on the table relative to currently booked revenue.',
      unit: 'cents',
    },
    ProUpgradeScore: {
      description: '0-1 propensity score that free/local activity is ripe for Pro conversion.',
      unit: 'ratio',
    },
    TeamUpgradeScore: {
      description: '0-1 propensity score that current activity is ripe for Team rollout and expansion.',
      unit: 'ratio',
    },
    PredictiveAnomalyCount: {
      description: 'Count of predictive analytics anomalies requiring operator attention.',
      unit: 'count',
    },
  },
};

async function getBusinessMetrics(options = {}) {
  const snapshot = await materializeAgenticDataPipeline({
    ...options,
    write: false,
    recordWorkflowRun: false,
  });
  return snapshot.semantic;
}

function describeSemanticSchema() {
  return SemanticSchema;
}

module.exports = {
  getBusinessMetrics,
  describeSemanticSchema,
  SemanticSchema,
};
