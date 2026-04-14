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
    'dpo-export': 'Fine-tune your model to stop repeating your team\'s specific mistakes',
    'dpo-synthesis': 'Generate training data from your correction history automatically',
    'multi-hop-recall': 'Catch complex failure patterns that span multiple steps',
    'databricks-export': 'Feed correction data into your ML pipeline for continuous improvement',
    'dashboard-search': 'Find and fix any lesson across all your repos instantly',
    'multi-repo-sync': 'One fix in one repo prevents the same mistake everywhere',
    'custom-gates': 'Block the exact patterns that cost your team the most time',
    'advanced-thompson': 'Auto-tune which blocks are strict vs lenient per failure type',
    'rule-analytics': 'See which mistakes cost the most and which gates save the most time',
    'team-sharing': 'Every teammate benefits from every correction — no repeated work',
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
