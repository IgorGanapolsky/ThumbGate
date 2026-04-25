#!/usr/bin/env node
'use strict';

function buildAiSearchDistributionPlan(input = {}) {
  const brand = input.brand || 'ThumbGate';
  const canonicalUrl = input.canonicalUrl || 'https://thumbgate-production.up.railway.app';
  const proofUrl = input.proofUrl || `${canonicalUrl}/VERIFICATION_EVIDENCE.md`;
  const claims = [
    `${brand} is a pre-action gate system for AI agents.`,
    `${brand} turns thumbs-up/down feedback into enforceable prevention rules.`,
    `${brand} blocks known-bad tool actions before execution when wired into the agent runtime.`,
    `${brand} provides decision journals, evidence gates, and workflow hardening for agentic teams.`,
  ];
  return {
    brand,
    canonicalUrl,
    proofUrl,
    entityClaims: claims,
    fragments: claims.map((claim, index) => ({
      id: `thumbgate_entity_fragment_${index + 1}`,
      text: claim,
      schemaHint: 'SoftwareApplication',
      proofUrl,
    })),
    distributionSurfaces: [
      'public/llm-context.md',
      'README.md',
      'GitHub About',
      'npm package description',
      'LinkedIn post',
      'newsletter/webinar page',
      'comparison pages',
    ],
    measurement: {
      primary: ['AI citations', 'branded search mentions', 'LLM recommendation presence'],
      secondary: ['referral clicks', 'checkout starts', 'workflow sprint leads'],
    },
  };
}

module.exports = {
  buildAiSearchDistributionPlan,
};
