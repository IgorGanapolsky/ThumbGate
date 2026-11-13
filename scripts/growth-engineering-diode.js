'use strict';

/**
 * ThumbGate Growth Engineering Diode
 *
 * Adopted from Letterpress-1 (The Letter Company):
 * - "A coding agent built for growth engineering."
 * - Reacts proactively to market forces, competitor releases, and agent traffic.
 * - 3 Execution Modes:
 *   1. PLAN: Analyzes outside market signals and outputs high-leverage growth actions.
 *   2. BUILD: Creates targeted comparison pages, simulation endpoints, and proofs.
 *   3. FIX: Audits marketing site integrity, links, pricing congruency, and agent metadata.
 */

const fs = require('node:fs');
const path = require('node:path');

const GROWTH_MODES = {
  PLAN: 'PLAN',
  BUILD: 'BUILD',
  FIX: 'FIX',
};

class GrowthEngineeringDiode {
  constructor(options = {}) {
    this.options = options;
  }

  /**
   * Generates a growth action plan from market signals.
   * @param {object} signal
   */
  planGrowthActions(signal = {}) {
    const topic = signal.topic || 'general';
    const actions = [];

    switch (topic) {
      case 'competitor_acquisition':
        actions.push({
          action: 'create_comparison_page',
          targetUrl: `/compare/${signal.competitorSlug || 'alternative'}`,
          priority: 'HIGH',
          reason: 'Capture organic search and agent procurement traffic triggered by acquisition news.',
        });
        actions.push({
          action: 'stage_thought_leadership_essay',
          priority: 'HIGH',
          reason: 'Position ThumbGate pre-action diode vs heavyweight post-incident SIEM scanners.',
        });
        break;

      case 'agent_procurement_traffic':
        actions.push({
          action: 'update_agent_proofs',
          priority: 'HIGH',
          reason: 'Refresh .well-known/agent-proofs.json with latest latency and mutation kill rates.',
        });
        actions.push({
          action: 'expand_simulation_sandbox',
          priority: 'MEDIUM',
          reason: 'Allow buying agents to test pre-tool gate decisions with zero API keys.',
        });
        break;

      default:
        actions.push({
          action: 'audit_site_pricing_congruence',
          priority: 'MEDIUM',
          reason: 'Ensure landing page, pricing page, and Stripe/Gumroad links match exactly.',
        });
        break;
    }

    return {
      mode: GROWTH_MODES.PLAN,
      signalTopic: topic,
      recommendedActionsCount: actions.length,
      actions,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Fix mode: audits site links and verifies pricing congruency.
   * @param {string} publicDir
   */
  auditSiteIntegrity(publicDir = path.join(__dirname, '..', 'public')) {
    const issues = [];
    const pricingHtmlPath = path.join(publicDir, 'pricing.html');

    if (fs.existsSync(pricingHtmlPath)) {
      const content = fs.readFileSync(pricingHtmlPath, 'utf8');

      // Check Pro direct link
      if (!content.includes('/go/pro-direct') && !content.includes('https://thumbgate.ai/go/pro-direct') && !content.includes('buy.stripe.com/8x2dR91M84r4cSd9uj3sI3f')) {
        issues.push({ file: 'pricing.html', issue: 'Missing canonical Pro checkout link.' });
      }

      // Check $49 Bundle link
      if (!content.includes('/go/bundle-49') && !content.includes('https://thumbgate.ai/go/bundle-49') && !content.includes('iganapolsky.gumroad.com/l/vcrho')) {
        issues.push({ file: 'pricing.html', issue: 'Missing canonical $49 Rule-Pack link.' });
      }
    }

    return {
      mode: GROWTH_MODES.FIX,
      status: issues.length === 0 ? 'HEALTHY_CONGRUENT' : 'NEEDS_FIX',
      issuesCount: issues.length,
      issues,
    };
  }
}

module.exports = {
  GROWTH_MODES,
  GrowthEngineeringDiode,
};
