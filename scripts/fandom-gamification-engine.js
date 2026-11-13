/**
 * Fandom Gamification & Status Symbol Engine
 * 
 * Based on David Meerman Scott's "The Fandom Playbook":
 * 1. Tap into the "Collector Gene" (Multi-step milestone checklist: The 5-Gate Fortress Challenge)
 * 2. Issue shareable status symbols (Verifiable digital badges for README / LinkedIn)
 * 3. Insider access tiers for milestone finishers
 * 4. "Behind the Curtain" Open-Source Code Inspection
 */

'use strict';

const crypto = require('crypto');

const PRODUCTION_GATES = {
  PRETOOL_DIODE: {
    id: 'GATE_1_PRETOOL_DIODE',
    name: 'Pre-Action MCP Tool Diode',
    desc: 'Deterministic binary gate diode intercepting actions before tool execution.',
    points: 20
  },
  LAZY_CI_PRUNER: {
    id: 'GATE_2_LAZY_CI_PRUNER',
    name: 'Lazy PR CI Manager',
    desc: 'Halts obsolete GitHub Actions builds when newer agent commits push.',
    points: 20
  },
  MUTATION_KILLER: {
    id: 'GATE_3_MUTATION_KILLER',
    name: 'Mutation Testing Harness',
    desc: 'Kills sycophantic agent-written unit tests that pass when logic is mutated.',
    points: 20
  },
  HARDWARE_VRAM_ROUTER: {
    id: 'GATE_4_HARDWARE_VRAM_ROUTER',
    name: 'Hardware-Aware VRAM Diode',
    desc: 'Prevents 10x-50x latency cliffs by calculating KV-cache and routing to cloud when VRAM overflows.',
    points: 20
  },
  KROHN_RHODES_TRACKER: {
    id: 'GATE_5_KROHN_RHODES_TRACKER',
    name: 'StateBench Finite Register',
    desc: 'Externalizes multi-turn state tracking so agents never hallucinate variable swaps.',
    points: 20
  }
};

const CERTIFICATION_TIERS = {
  LEVEL_1: {
    tierId: 'LEVEL_1_ROOKIE_SHIELD',
    title: 'Hardened Agent Builder',
    minGates: 2,
    badgeColor: '#3b82f6'
  },
  LEVEL_2: {
    tierId: 'LEVEL_2_PRODUCTION_DEFENDER',
    title: 'Production Agent Defender',
    minGates: 4,
    badgeColor: '#8b5cf6'
  },
  LEVEL_3: {
    tierId: 'LEVEL_3_SOVEREIGN_ARCHITECT',
    title: 'Certified Sovereign Agent Architect',
    minGates: 5,
    badgeColor: '#10b981'
  }
};

class FandomGamificationEngine {
  constructor() {
    this.completedMilestones = new Map();
  }

  /**
   * Register a verified completed production gate for a developer or repo.
   */
  completeGateMilestone(userId, gateId) {
    if (!PRODUCTION_GATES[gateId]) {
      throw new Error(`[GamificationEngine] Unknown gate ID: ${gateId}`);
    }

    if (!this.completedMilestones.has(userId)) {
      this.completedMilestones.set(userId, new Set());
    }

    const userGates = this.completedMilestones.get(userId);
    userGates.add(gateId);

    return this.evaluateUserStatus(userId);
  }

  /**
   * Evaluates the collector status and awards shareable digital credentials.
   */
  evaluateUserStatus(userId) {
    const userGates = this.completedMilestones.get(userId) || new Set();
    const count = userGates.size;
    const implementedGates = Array.from(userGates).map(id => PRODUCTION_GATES[id]);
    const totalScore = implementedGates.reduce((sum, g) => sum + g.points, 0);

    let earnedTier = null;
    if (count >= CERTIFICATION_TIERS.LEVEL_3.minGates) {
      earnedTier = CERTIFICATION_TIERS.LEVEL_3;
    } else if (count >= CERTIFICATION_TIERS.LEVEL_2.minGates) {
      earnedTier = CERTIFICATION_TIERS.LEVEL_2;
    } else if (count >= CERTIFICATION_TIERS.LEVEL_1.minGates) {
      earnedTier = CERTIFICATION_TIERS.LEVEL_1;
    }

    const verificationHash = crypto
      .createHash('sha256')
      .update(`${userId}:${count}:${totalScore}:thumbgate-fandom-v1`)
      .digest('hex')
      .slice(0, 16);

    const shareableBadgeSvg = this._generateSvgBadge({
      title: earnedTier ? earnedTier.title : 'Novice Builder',
      score: totalScore,
      color: earnedTier ? earnedTier.badgeColor : '#64748b'
    });

    return {
      userId,
      completedCount: count,
      totalScore,
      implementedGates,
      remainingGates: Object.keys(PRODUCTION_GATES)
        .filter(k => !userGates.has(k))
        .map(k => PRODUCTION_GATES[k]),
      earnedTier,
      verificationToken: `tg_cert_${verificationHash}`,
      shareableBadgeSvg,
      isFullyCertified: count === 5
    };
  }

  _generateSvgBadge({ title, score, color }) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="70" viewBox="0 0 300 70">
  <rect width="300" height="70" rx="8" fill="#12141c" stroke="${color}" stroke-width="2"/>
  <text x="20" y="28" font-family="-apple-system, sans-serif" font-size="11" font-weight="700" fill="${color}" letter-spacing="1">THUMBGATE VERIFIED</text>
  <text x="20" y="52" font-family="-apple-system, sans-serif" font-size="15" font-weight="800" fill="#f0f3f8">${title}</text>
  <circle cx="265" cy="35" r="18" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="1.5"/>
  <text x="265" y="40" font-family="-apple-system, sans-serif" font-size="12" font-weight="800" fill="${color}" text-anchor="middle">${score}%</text>
</svg>`.trim();
  }
}

module.exports = {
  FandomGamificationEngine,
  PRODUCTION_GATES,
  CERTIFICATION_TIERS
};
