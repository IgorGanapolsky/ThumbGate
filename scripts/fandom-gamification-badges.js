'use strict';

/**
 * ThumbGate Fandom & Gamification Engine: Verifiable Badges & Collector Milestones
 *
 * Adopted from David Meerman Scott (The Fandom Playbook - Play 3: Gamify Your Business Experience):
 * 1. Tap the "Collector Gene": Map a multi-step milestone checklist (The 5-Gate Hardened Fleet).
 * 2. Issue shareable status symbols: Verifiable dynamic SVG badges for GitHub READMEs.
 * 3. Insider tier recognition: Unlocking "Certified Agent Architect".
 */

const fs = require('node:fs');
const path = require('node:path');

const MILESTONES = [
  {
    id: 'credential_confinement',
    title: 'Credential Confinement',
    description: 'API keys & secrets isolated from LLM context via pre-action diode.',
    points: 20,
  },
  {
    id: 'mechanical_verifier',
    title: 'Mechanical Verification Loop',
    description: 'Tests automatically run on every agent output with zero manual copy-paste.',
    points: 20,
  },
  {
    id: 'mutation_hardening',
    title: 'Mutation Testing Hardening',
    description: 'Unit tests kill >80% of AST mutants; eliminates tautological AI tests.',
    points: 20,
  },
  {
    id: 'scatter_query_protection',
    title: 'Scatter Query & Load Shedding',
    description: 'Database queries enforce sharding keys; shedding drops non-essential traffic.',
    points: 20,
  },
  {
    id: 'immutable_spending_gate',
    title: 'Immutable Spending Diode',
    description: 'Hardware/database-level budget constraints prevent runaway token billing.',
    points: 20,
  },
];

/**
 * Calculates current milestone progress and rank tier.
 * @param {string[]} completedMilestoneIds
 */
function evaluateFleetRank(completedMilestoneIds = []) {
  const set = new Set(completedMilestoneIds);
  let totalPoints = 0;
  const milestonesStatus = MILESTONES.map(m => {
    const isCompleted = set.has(m.id);
    if (isCompleted) totalPoints += m.points;
    return {
      ...m,
      completed: isCompleted,
    };
  });

  let rank = 'Recruit (Level 1)';
  let badgeColor = '#e05d44'; // Red
  let badgeText = 'Level 1 Vulnerable';
  let certified = false;

  if (totalPoints === 100) {
    rank = 'Certified Agent Architect (Level 3 Master)';
    badgeColor = '#4c1'; // Bright Green
    badgeText = 'Level 3 Hardened 🛡️';
    certified = true;
  } else if (totalPoints >= 60) {
    rank = 'Guarded Fleet (Level 2)';
    badgeColor = '#dfb317'; // Yellow
    badgeText = 'Level 2 Guarded ⚡';
  }

  return {
    score: totalPoints,
    rank,
    badgeColor,
    badgeText,
    certified,
    completedCount: completedMilestoneIds.length,
    totalMilestones: MILESTONES.length,
    milestones: milestonesStatus,
  };
}

/**
 * Generates an SVG badge for embedding in GitHub README.md
 * @param {object} rankResult
 */
function generateSvgBadge(rankResult) {
  const label = 'thumbgate';
  const status = rankResult.badgeText || 'Hardened';
  const color = rankResult.badgeColor || '#4c1';

  // SVG dimensions
  const labelWidth = 72;
  const statusWidth = Math.max(90, status.length * 8 + 16);
  const totalWidth = labelWidth + statusWidth;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${label}: ${status}">
  <title>${label}: ${status}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${statusWidth}" height="20" fill="${color}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">
    <text aria-hidden="true" x="${labelWidth * 5}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(labelWidth - 14) * 10}">${label}</text>
    <text x="${labelWidth * 5}" y="140" transform="scale(.1)" fill="#fff" textLength="${(labelWidth - 14) * 10}">${label}</text>
    <text aria-hidden="true" x="${(labelWidth + statusWidth / 2) * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(statusWidth - 16) * 10}">${status}</text>
    <text x="${(labelWidth + statusWidth / 2) * 10}" y="140" transform="scale(.1)" fill="#fff" textLength="${(statusWidth - 16) * 10}">${status}</text>
  </g>
</svg>`;
}

/**
 * Returns ready-to-paste markdown for project README.md
 */
function getMarkdownBadgeCode(repoSlug = 'IgorGanapolsky/ThumbGate') {
  return `[![ThumbGate Hardened Fleet](https://thumbgate.ai/badge/${repoSlug}.svg)](https://thumbgate.ai)`;
}

module.exports = {
  MILESTONES,
  evaluateFleetRank,
  generateSvgBadge,
  getMarkdownBadgeCode,
};
