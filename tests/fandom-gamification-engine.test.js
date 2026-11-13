/**
 * Tests for Fandom Gamification Engine (David Meerman Scott Play)
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FandomGamificationEngine,
  CERTIFICATION_TIERS
} = require('../scripts/fandom-gamification-engine');

test('FandomGamificationEngine - tracks milestone completion and awards level tiers', () => {
  const engine = new FandomGamificationEngine();
  const userId = 'dev_sarah';

  // Complete 2 gates -> Rookie Shield
  engine.completeGateMilestone(userId, 'PRETOOL_DIODE');
  const level1 = engine.completeGateMilestone(userId, 'LAZY_CI_PRUNER');

  assert.equal(level1.completedCount, 2);
  assert.equal(level1.totalScore, 40);
  assert.equal(level1.earnedTier.tierId, CERTIFICATION_TIERS.LEVEL_1.tierId);
  assert.ok(level1.verificationToken.startsWith('tg_cert_'));
  assert.ok(level1.shareableBadgeSvg.includes('Hardened Agent Builder'));

  // Complete remaining 3 gates -> Sovereign Architect
  engine.completeGateMilestone(userId, 'MUTATION_KILLER');
  engine.completeGateMilestone(userId, 'HARDWARE_VRAM_ROUTER');
  const level3 = engine.completeGateMilestone(userId, 'KROHN_RHODES_TRACKER');

  assert.equal(level3.completedCount, 5);
  assert.equal(level3.totalScore, 100);
  assert.equal(level3.earnedTier.tierId, CERTIFICATION_TIERS.LEVEL_3.tierId);
  assert.equal(level3.isFullyCertified, true);
  assert.ok(level3.shareableBadgeSvg.includes('Certified Sovereign Agent Architect'));
  assert.ok(level3.shareableBadgeSvg.includes('100%'));
});
