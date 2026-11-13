'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateStandardSpecArtifact,
  evaluateProgressiveHitlGate,
  auditPodTopologyAndReviewRatio,
  curateContextGoldenExamplesAndSkills,
  computeContrastRatio,
  evaluateSidewaysEnterpriseGuardrails,
  scoreTokenRoiAndBusinessImpact,
  runMcKinseyAiCodingAudit,
} = require('../src/mckinsey-top-company-ai-coding');

test('Pillar 1: standardized spec rejects 2-week sprints and approves 1-2 day night-shift Kanban loops', () => {
  const twoWeekSprint = validateStandardSpecArtifact({
    targetCycleHours: 336,
    problemStatement: 'short',
  });
  assert.equal(twoWeekSprint.ok, false);
  assert.ok(twoWeekSprint.findings.some((f) => f.code === 'sprint_batch_too_large'));

  const cleanKanban = validateStandardSpecArtifact({
    targetCycleHours: 24,
    problemStatement: 'Eliminate manual cross-team accessibility and DLP review bottlenecks in PreToolUse.',
    verifiableOutcomes: ['node --test tests/mckinsey-top-company-ai-coding.test.js exits 0'],
    goldenReferences: ['src/webmcp-governance.js'],
    sidewaysConstraints: { wcagContrast: 'AA', dlpAirgap: true },
    tokenBudgetUsd: 1.5,
  });
  assert.equal(cleanKanban.ok, true);
  assert.equal(cleanKanban.kanbanLoopMode, 'night_shift_24h');
});

test('Pillar 1B: progressive HITL removes human sign-off on high-confidence reversible night-shift loops', () => {
  const autoAdvance = evaluateProgressiveHitlGate({
    loopId: 'night-shift-seo-audit',
    historicalPassRate: 0.96,
    consecutiveCleanRuns: 12,
    blastRadius: 'reversible',
    allAutomatedGatesPassed: true,
  });
  assert.equal(autoAdvance.requireHumanSignOff, false);
  assert.equal(autoAdvance.executionMode, 'autonomous_night_shift_auto_advance');

  const irreversible = evaluateProgressiveHitlGate({
    loopId: 'prod-billing-mutation',
    historicalPassRate: 0.99,
    consecutiveCleanRuns: 20,
    blastRadius: 'irreversible',
    allAutomatedGatesPassed: true,
  });
  assert.equal(irreversible.requireHumanSignOff, true);
  assert.equal(irreversible.reason, 'irreversible_blast_radius_guardrail');
});

test('Pillar 2: pod topology enforces 2-4 person mini-pods, collapsed roles, and review parity', () => {
  const bloatedScrum = auditPodTopologyAndReviewRatio({
    podMembers: [
      { name: 'A', role: 'product_manager' },
      { name: 'B', role: 'qa_tester' },
      { name: 'C', role: 'frontend_dev' },
      { name: 'D', role: 'backend_dev' },
      { name: 'E', role: 'scrum_master' },
    ],
    generationMinutes: 60,
    reviewAndVerificationMinutes: 10,
    changedLines: 120,
    verifiedTestAssertions: 0,
  });
  assert.equal(bloatedScrum.ok, false);
  assert.ok(bloatedScrum.findings.some((f) => f.code === 'invalid_pod_size'));
  assert.ok(bloatedScrum.findings.some((f) => f.code === 'siloed_legacy_roles_detected'));
  assert.ok(bloatedScrum.findings.some((f) => f.code === 'insufficient_review_investment'));
  assert.ok(bloatedScrum.findings.some((f) => f.code === 'unverified_ai_code_batch'));

  const miniPod = auditPodTopologyAndReviewRatio({
    podMembers: [
      { name: 'Igor', role: 'definer' },
      { name: 'Builder-Core', role: 'builder' },
      { name: 'Judge-Clinic', role: 'verifier' },
    ],
    generationMinutes: 20,
    reviewAndVerificationMinutes: 15,
    changedLines: 180,
    verifiedTestAssertions: 14,
  });
  assert.equal(miniPod.ok, true);
  assert.equal(miniPod.podSize, 3);
});

test('Pillar 3: curates golden examples (>= P90) over codebase averages and caps active skills <= 7', () => {
  const badCuration = curateContextGoldenExamplesAndSkills({
    semanticLayer: {},
    candidateExamples: [{ id: 'avg-file', qualityPercentile: 55, passesArchitectureStandards: true, isCodebaseAverage: true }],
    requestedSkills: Array.from({ length: 9 }, (_, i) => ({ name: `skill-${i}`, centrallyVetted: true })),
  });
  assert.equal(badCuration.ok, false);
  assert.ok(badCuration.findings.some((f) => f.code === 'missing_tribal_semantic_layer'));
  assert.ok(badCuration.findings.some((f) => f.code === 'no_golden_examples_selected'));
  assert.ok(badCuration.findings.some((f) => f.code === 'skill_sprawl_decision_paralysis'));

  const cleanCuration = curateContextGoldenExamplesAndSkills({
    semanticLayer: {
      smeOwner: 'igor@igorganapolsky.com',
      domainInvariants: ['PreToolUse latency < 0.5ms', 'outboundCashSpendUsd === 0'],
    },
    candidateExamples: [
      { id: 'avg-1', qualityPercentile: 60, passesArchitectureStandards: true, isCodebaseAverage: true },
      { id: 'golden-webmcp', qualityPercentile: 96, passesArchitectureStandards: true, isCodebaseAverage: false },
    ],
    requestedSkills: [
      { name: 'inbound-partner-flip-monetizer', centrallyVetted: true },
      { name: 'zero-outbound-spend-they-pay-us', centrallyVetted: true },
      { name: 'unvetted-random-skill', centrallyVetted: false },
    ],
  });
  assert.equal(cleanCuration.ok, true);
  assert.deepEqual(cleanCuration.goldenExampleIds, ['golden-webmcp']);
  assert.equal(cleanCuration.rejectedAverageCount, 1);
  assert.deepEqual(cleanCuration.activeSkillNames, [
    'inbound-partner-flip-monetizer',
    'zero-outbound-spend-they-pay-us',
  ]);
});

test('Pillar 4: sideways enterprise guardrails enforce WCAG contrast, colorblind safety, and air-gap DLP', () => {
  assert.ok(computeContrastRatio('#ffffff', '#0a0e17') >= 15);

  const failingSideways = evaluateSidewaysEnterpriseGuardrails({
    upstreamSignals: [],
    releaseChecklistComplete: false,
    uiPalette: {
      foregroundHex: '#777777',
      backgroundHex: '#888888',
      reliesOnRedGreenOnly: true,
      hasNonColorShapeOrLabel: false,
    },
    codeSnippet: 'fetch("https://api.ecinexus.com/internal")',
    complianceTags: [],
  });
  assert.equal(failingSideways.ok, false);
  assert.ok(failingSideways.findings.some((f) => f.code === 'accessibility_contrast_violation'));
  assert.ok(failingSideways.findings.some((f) => f.code === 'colorblind_accessibility_violation'));
  assert.ok(failingSideways.findings.some((f) => f.code === 'corporate_airgap_leak_blocked'));

  const passingSideways = evaluateSidewaysEnterpriseGuardrails({
    upstreamSignals: ['gmail:1881571581278958594', 'webmcp:origin-trial-20270329'],
    releaseChecklistComplete: true,
    uiPalette: {
      foregroundHex: '#f8fafc',
      backgroundHex: '#0f172a',
      reliesOnRedGreenOnly: false,
      hasNonColorShapeOrLabel: true,
    },
    codeSnippet: 'const ok = true;',
    complianceTags: ['pretool_diode_verified'],
  });
  assert.equal(passingSideways.ok, true);
});

test('Pillar 5 & end-to-end audit: scores token ROI and approves autonomous night-shift execution', () => {
  const audit = runMcKinseyAiCodingAudit({
    spec: {
      targetCycleHours: 24,
      problemStatement: 'Automate McKinsey 5-pillar AI coding guardrails and partner attribution loop.',
      verifiableOutcomes: ['100% unit test pass', 'Sent Mail UID verified'],
      goldenReferences: ['src/webmcp-governance.js'],
      sidewaysConstraints: { wcag: 'AA', dlp: 'strict' },
      tokenBudgetUsd: 0.5,
    },
    pod: {
      podMembers: [
        { name: 'Igor', role: 'definer' },
        { name: 'Antigravity', role: 'builder' },
        { name: 'IsolatedVerifier', role: 'verifier' },
      ],
      generationMinutes: 15,
      reviewAndVerificationMinutes: 12,
      changedLines: 220,
      verifiedTestAssertions: 18,
    },
    context: {
      semanticLayer: {
        smeOwner: 'igor@igorganapolsky.com',
        domainInvariants: ['PreToolUse < 0.5ms', '$0 outbound spend'],
      },
      candidateExamples: [
        { id: 'golden-1', qualityPercentile: 95, passesArchitectureStandards: true },
      ],
      requestedSkills: [
        { name: 'mckinsey-ai-coding-operating-model', centrallyVetted: true },
      ],
    },
    sideways: {
      upstreamSignals: ['gmail:manjunath@miraqal.com'],
      releaseChecklistComplete: true,
      uiPalette: {
        foregroundHex: '#ffffff',
        backgroundHex: '#0a0e17',
        reliesOnRedGreenOnly: false,
        hasNonColorShapeOrLabel: true,
      },
      codeSnippet: 'module.exports = {};',
      complianceTags: ['pretool_diode_verified'],
    },
    roi: {
      featureId: 'mckinsey-operating-model',
      estimatedTokens: 25000,
      costPerMillionTokensUsd: 3.0,
      expectedRevenueImpactUsd: 499,
      engineeringHoursSaved: 4,
      hourlyEngineeringRateUsd: 150,
      outboundCashSpendUsd: 0,
    },
    hitl: {
      loopId: 'mckinsey-night-shift',
      historicalPassRate: 0.95,
      consecutiveCleanRuns: 10,
      blastRadius: 'reversible',
    },
  });

  assert.equal(audit.ok, true);
  assert.equal(audit.roiVerdict.priorityTier, 'P0_HIGH_ROI');
  assert.equal(audit.hitlVerdict.requireHumanSignOff, false);
});
