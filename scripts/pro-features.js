'use strict';
const { isProLicensed } = require('./license');

const PRO_URL = 'https://buy.stripe.com/aFa4gz1M84r419v7mb3sI05';

function requirePro(featureName) {
  if (isProLicensed()) return true;
  const descriptions = {
    'dpo-export': 'Export feedback as DPO training pairs for model fine-tuning',
    'dpo-synthesis': 'Generate synthetic DPO pairs from existing feedback patterns',
    'multi-hop-recall': 'Multi-hop recall — chain related lessons for deeper context',
    'databricks-export': 'Export to Databricks ML pipeline format',
    'dashboard-search': 'Search, filter, and edit lessons across all repos',
    'multi-repo-sync': 'Sync prevention rules across multiple repositories',
    'custom-gates': 'Create custom pre-action gates beyond the defaults',
    'advanced-thompson': 'Advanced Thompson Sampling with custom priors and decay',
    'rule-analytics': 'Analytics on which rules fire most and their block rates',
    'team-sharing': 'Share lesson databases across team members',
  };
  const desc = descriptions[featureName] || featureName;
  process.stderr.write(
    `\n  🔒 Pro Feature Required: ${desc}\n` +
    `     Upgrade to ThumbGate Pro — $49 one-time:\n` +
    `     ${PRO_URL}\n` +
    `     Or run: npx mcp-memory-gateway pro\n\n`
  );
  return false;
}

module.exports = { requirePro, PRO_URL };
