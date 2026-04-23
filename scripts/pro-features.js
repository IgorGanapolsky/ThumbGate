'use strict';
const { isProLicensed } = require('./license');
const {
  PRO_MONTHLY_PAYMENT_LINK,
  PRO_PRICE_LABEL,
  TEAM_PRICE_LABEL,
} = require('./commercial-offer');

const PRO_URL = PRO_MONTHLY_PAYMENT_LINK;

function requirePro(
  featureName,
  {
    isProLicensedFn = isProLicensed,
    write = (message) => process.stderr.write(message),
  } = {}
) {
  if (isProLicensedFn()) return true;
  const descriptions = {
    'dpo-export': 'Export feedback as DPO training pairs for model fine-tuning',
    'dpo-synthesis': 'Generate synthetic DPO pairs from existing feedback patterns',
    'multi-hop-recall': 'Multi-hop recall — chain related lessons for deeper context',
    'databricks-export': 'Export to Databricks ML pipeline format',
    'dashboard-search': 'Search, filter, and edit lessons across all repos',
    'multi-repo-sync': 'Sync prevention rules across multiple repositories',
    'custom-gates': 'Create custom pre-action checks beyond the defaults',
    'advanced-thompson': 'Advanced Thompson Sampling with custom priors and decay',
    'rule-analytics': 'Analytics on which rules fire most and their block rates',
    'team-sharing': 'Share lesson databases across team members',
  };
  const desc = descriptions[featureName] || featureName;
  write(
    `\n  🔒 Pro Feature Required: ${desc}\n` +
    `     Pro: ${PRO_PRICE_LABEL} — ${PRO_URL}\n` +
    `     Team: ${TEAM_PRICE_LABEL} after workflow qualification\n` +
    `     Or run: npx thumbgate pro\n\n`
  );
  return false;
}

module.exports = { requirePro, PRO_URL };
