#!/usr/bin/env node
'use strict';

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function evaluateModelAccessEligibility(input = {}) {
  const model = normalizeText(input.model) || 'unknown';
  const accessType = normalizeText(input.accessType) || 'public';
  const approved = input.approved === true || input.invited === true || input.allowListed === true;
  const maintainerPath = input.openSourceMaintainer === true;
  const gated = /mythos|preview|research|private|invite|glasswing/i.test(`${model} ${accessType}`);
  const issues = [];

  if (gated && !approved) {
    issues.push('approval_required_before_platform_setup');
  }
  if (gated && !approved && maintainerPath) {
    issues.push('maintainer_path_is_possible_not_guaranteed');
  }
  if (gated && /aws|bedrock|vertex|foundry|azure|gcp/i.test(normalizeText(input.platform)) && !approved) {
    issues.push('platform_docs_do_not_create_model_access');
  }

  return {
    model,
    accessType,
    decision: issues.length === 0 ? 'allow' : 'warn',
    issues,
    fallback: gated && !approved ? 'Use a public model route until approval exists.' : null,
  };
}

module.exports = {
  evaluateModelAccessEligibility,
};
