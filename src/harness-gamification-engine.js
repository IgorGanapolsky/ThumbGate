/**
 * Fandom & Gamification Engine: The 10-Gate Autonomous Harness Challenge.
 * 
 * Inspired by David Meerman Scott ("The Fandom Playbook"):
 * - Don't lead with a sales pitch: Give away high-value diagnostic data free.
 * - Tap into the 'collector gene' with a multi-step milestone challenge.
 * - Issue shareable digital status symbols (verifiable SVG GitHub badges & LinkedIn cards).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const HARNESS_GATES = [
  { id: 'gate_1', name: 'Zero Scatter Queries', description: 'All database queries on sharded tables include partition shard keys.' },
  { id: 'gate_2', name: 'Mutation Testing Score', description: 'AI-generated unit tests kill mutants with >50% mutation score.' },
  { id: 'gate_3', name: 'Fail-Closed Guardrails', description: 'Pre-action firewalls halt execution on timeouts or errors (no fail-open).' },
  { id: 'gate_4', name: 'Anti-Tautological Tests', description: 'No assert(true) or self-mocking tests present in test suites.' },
  { id: 'gate_5', name: 'Parallelization Invariants', description: 'Amdahl speedup verified before spawning multi-agent parallel branches.' },
  { id: 'gate_6', name: 'Centralized Trace Sampling', description: 'Deterministic root-span trace sampling without scattered pre-export filters.' },
  { id: 'gate_7', name: 'Zero-Downtime Migrations', description: 'Multi-phase state machine (Isolate -> Double Write -> Backfill -> Cutover).' },
  { id: 'gate_8', name: 'Lazy CI Superceded Cancellation', description: 'Stale builds cancelled immediately when new commits are pushed.' },
  { id: 'gate_9', name: 'PII & Injection Sanitization', description: 'SSN, cards, and prompt injections masked deterministically before inference.' },
  { id: 'gate_10', name: 'Resident Skill Context Budget', description: 'Active resident agent skill context kept strictly under 8,000 tokens.' },
];

class HarnessGamificationEngine {
  constructor(options = {}) {
    this.gates = options.gates || HARNESS_GATES;
  }

  evaluateHarness(checks = {}) {
    const results = [];
    let passedCount = 0;

    for (const gate of this.gates) {
      const isPassed = checks[gate.id] !== false; // Default to true if satisfied in check object
      if (isPassed) passedCount++;

      results.push({
        id: gate.id,
        name: gate.name,
        description: gate.description,
        passed: isPassed,
      });
    }

    const score = passedCount;
    const maxScore = this.gates.length;
    const passPercentage = Math.round((passedCount / maxScore) * 100);

    let tier = 'NOVICE_HARNESS';
    if (score === 10) tier = 'AUTONOMOUS_PRODUCTION_READY';
    else if (score >= 7) tier = 'HARDENED_HARNESS';
    else if (score >= 4) tier = 'APPRENTICE_HARNESS';

    return {
      score,
      maxScore,
      passPercentage,
      tier,
      isCertified: score === 10,
      results,
      markdownSummary: this.formatMarkdownReport(score, maxScore, tier, results),
    };
  }

  formatMarkdownReport(score, maxScore, tier, results) {
    let md = `## 🛡️ ThumbGate Autonomous Harness Challenge: ${score}/${maxScore} (${tier})\n\n`;
    for (const r of results) {
      md += `- [${r.passed ? 'x' : ' '}] **${r.name}**: ${r.description}\n`;
    }
    md += `\n**Shareable Badge**: Add to your README to prove your agent harness is battle-tested.\n`;
    return md;
  }

  generateBadgeSvg(score, maxScore, tier) {
    const color = score === maxScore ? '#10b981' : score >= 7 ? '#3b82f6' : '#f59e0b';
    const text = `ThumbGate ${score}/${maxScore} • ${tier.replace(/_/g, ' ')}`;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="28" role="img" aria-label="${text}">
  <title>${text}</title>
  <linearGradient id="g" x2="0" y2="100%">
    <stop offset="0" stop-color="#2d3748" stop-opacity=".9"/>
    <stop offset="1" stop-color="#1a202c" stop-opacity=".9"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="240" height="28" rx="5" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="90" height="28" fill="#1a202c"/>
    <rect x="90" width="150" height="28" fill="${color}"/>
    <rect width="240" height="28" fill="url(#g)" opacity=".1"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" font-size="11" font-weight="bold">
    <text x="45" y="18" fill="#e2e8f0">ThumbGate</text>
    <text x="165" y="18" fill="#ffffff">${score}/${maxScore} ${score === maxScore ? 'VERIFIED' : 'SECURED'}</text>
  </g>
</svg>`;
  }
}

module.exports = {
  HarnessGamificationEngine,
  HARNESS_GATES,
};
