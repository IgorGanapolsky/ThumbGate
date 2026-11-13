'use strict';

/**
 * McKinsey Top-Performing AI Coding Operating Model (2x End-to-End Throughput)
 * Source: Martin Harrysson, Prakhar Dixit, and Shilpa —
 * "What the Top Companies Do Differently With AI Coding" (https://www.youtube.com/watch?v=21tuT-e4NVo)
 *
 * Implements the 5 operational and technical control loops:
 *   1. Operating Model & Delivery Flow (1-2 day Night-Shift Kanban loops, standardized PRD/Spec inputs, progressive HITL removal)
 *   2. Team & Role Restructure (2-4 person mini-pods, collapsed Definer/Builder roles, review-vs-generation parity)
 *   3. Curated Context, Golden Examples & Tight Vetted Skills (SME semantic layer, top-decile golden examples over codebase averages, skill cap <= 7)
 *   4. Upstream, Downstream & Sideways Bottleneck Guardrails (customer inbox/log wiring + baked-in WCAG contrast, colorblind safety, DLP, compliance)
 *   5. AIOps Token ROI & Business Impact Scoring (value-per-token gate before scaling)
 */

const {
  runDesignSelfCorrectionPipeline,
  synthesizeIssueRemediation,
} = require('./design-self-correction-engine');

const MAX_KANBAN_CYCLE_HOURS = 48;
const MIN_POD_SIZE = 2;
const MAX_POD_SIZE = 4;
const MAX_VETTED_SKILLS_PER_LOOP = 7;
const MIN_GOLDEN_EXAMPLE_PERCENTILE = 90;
const WCAG_AA_NORMAL_CONTRAST = 4.5;
const WCAG_AA_LARGE_CONTRAST = 3.0;
// Default air-gap patterns: private-network IPs and internal-only hostnames.
// Callers pass their own organisation's hosts through `airgapPatterns`; none are hardcoded here.
const DEFAULT_AIRGAP_PATTERNS = [
  /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/,
  /\b[a-z0-9-]+\.(?:internal|corp|intranet|lan)\b/i,
];

function toAirgapRegexes(patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) return DEFAULT_AIRGAP_PATTERNS;
  return patterns.map((pattern) => (pattern instanceof RegExp ? pattern : new RegExp(String(pattern), 'i')));
}

const COLLAPSED_ROLES = new Set(['definer', 'builder', 'verifier']);

/**
 * Pillar 1A: Standardized Input Artifact Validator (06:40 - 07:04)
 * Rejects fragmented or freeform prompts before agents execute night-shift loops.
 */
function validateStandardSpecArtifact(spec = {}) {
  const findings = [];
  const cycleHours = Number(spec.targetCycleHours ?? 24);
  if (!Number.isFinite(cycleHours) || cycleHours <= 0 || cycleHours > MAX_KANBAN_CYCLE_HOURS) {
    findings.push({
      code: 'sprint_batch_too_large',
      message: `Target cycle (${cycleHours}h) exceeds the 1-2 day Kanban loop ceiling (${MAX_KANBAN_CYCLE_HOURS}h). Ditch 2-week sprints for 1-2 day night-shift loops.`,
    });
  }

  if (typeof spec.problemStatement !== 'string' || spec.problemStatement.trim().length < 20) {
    findings.push({
      code: 'missing_problem_statement',
      message: 'Standardized spec requires a clear problemStatement (>= 20 chars).',
    });
  }

  if (!Array.isArray(spec.verifiableOutcomes) || spec.verifiableOutcomes.length === 0) {
    findings.push({
      code: 'missing_verifiable_outcomes',
      message: 'Standardized spec requires at least one machine-verifiable outcome.',
    });
  }

  // A reference is a path string (already curated) or { ref, qualityPercentile }.
  // Scored references below the golden percentile do not count.
  const goldenReferences = Array.isArray(spec.goldenReferences)
    ? spec.goldenReferences.filter(
        (ref) =>
          typeof ref === 'string'
            ? ref.trim().length > 0
            : ref && Number(ref.qualityPercentile || 0) >= MIN_GOLDEN_EXAMPLE_PERCENTILE
      )
    : [];
  if (goldenReferences.length === 0) {
    findings.push({
      code: 'missing_golden_references',
      message: `Standardized spec must cite at least one golden example reference (path, or scored >= P${MIN_GOLDEN_EXAMPLE_PERCENTILE}).`,
    });
  }

  if (!spec.sidewaysConstraints || typeof spec.sidewaysConstraints !== 'object') {
    findings.push({
      code: 'missing_sideways_constraints',
      message: 'Standardized spec must declare sidewaysConstraints (security, compliance, accessibility).',
    });
  }

  const tokenBudgetUsd = Number(spec.tokenBudgetUsd ?? 0);
  if (!Number.isFinite(tokenBudgetUsd) || tokenBudgetUsd <= 0) {
    findings.push({
      code: 'missing_token_budget',
      message: 'Standardized spec requires a positive tokenBudgetUsd.',
    });
  }

  return {
    ok: findings.length === 0,
    kanbanLoopMode: cycleHours <= 24 ? 'night_shift_24h' : 'kanban_48h',
    findings,
  };
}

/**
 * Pillar 1B: Progressive Human-in-the-Loop (HITL) Gate (05:29 - 06:03)
 * Systematically removes human sign-off bottlenecks as empirical loop confidence grows,
 * while keeping human review on irreversible or low-confidence boundaries.
 */
function evaluateProgressiveHitlGate({
  loopId = 'default-loop',
  historicalPassRate = 0,
  consecutiveCleanRuns = 0,
  blastRadius = 'reversible',
  allAutomatedGatesPassed = false,
} = {}) {
  const clampedPassRate = Math.max(0, Math.min(1, Number(historicalPassRate) || 0));
  const streakBonus = Math.min(0.15, (Math.max(0, Number(consecutiveCleanRuns) || 0) / 20) * 0.15);
  const confidenceScore = Number(Math.min(1, clampedPassRate * 0.85 + streakBonus).toFixed(4));

  const isIrreversible = blastRadius === 'irreversible' || blastRadius === 'production_auth_billing';
  const canAutoAdvanceNightShift =
    Boolean(allAutomatedGatesPassed) && !isIrreversible && confidenceScore >= 0.85;

  return {
    loopId,
    confidenceScore,
    blastRadius,
    requireHumanSignOff: !canAutoAdvanceNightShift,
    executionMode: canAutoAdvanceNightShift
      ? 'autonomous_night_shift_auto_advance'
      : 'human_in_the_loop_validation_required',
    reason: !allAutomatedGatesPassed
      ? 'automated_gates_failed'
      : isIrreversible
        ? 'irreversible_blast_radius_guardrail'
        : confidenceScore >= 0.85
          ? 'high_confidence_progressive_hitl_bypass'
          : 'confidence_below_0.85_threshold',
  };
}

/**
 * Pillar 2: Team Topology & Review Coaching Guard (07:25 - 07:49, 12:07 - 12:25, 18:23)
 * Enforces 2-4 person mini-pods, collapsed Definer/Builder roles, and code-review parity
 * so faster generation does not inflate per-PR bug/incident rates.
 */
function auditPodTopologyAndReviewRatio({
  podMembers = [],
  generationMinutes = 0,
  reviewAndVerificationMinutes = 0,
  changedLines = 0,
  verifiedTestAssertions = 0,
} = {}) {
  const findings = [];
  const podSize = Array.isArray(podMembers) ? podMembers.length : 0;

  if (podSize < MIN_POD_SIZE || podSize > MAX_POD_SIZE) {
    findings.push({
      code: 'invalid_pod_size',
      message: `Pod size (${podSize}) must be ${MIN_POD_SIZE}-${MAX_POD_SIZE} people (halved mini-pod topology).`,
    });
  }

  const legacySiloRoles = (podMembers || []).filter(
    (m) => !COLLAPSED_ROLES.has(String(m.role || '').toLowerCase())
  );
  if (legacySiloRoles.length > 0) {
    findings.push({
      code: 'siloed_legacy_roles_detected',
      message: `Collapse narrow roles into 'definer', 'builder', or 'verifier' (found: ${legacySiloRoles.map((m) => m.role).join(', ')}).`,
    });
  }

  const genMins = Math.max(1, Number(generationMinutes) || 1);
  const revMins = Math.max(0, Number(reviewAndVerificationMinutes) || 0);
  const reviewToGenerationRatio = Number((revMins / genMins).toFixed(3));

  if (reviewToGenerationRatio < 0.5) {
    findings.push({
      code: 'insufficient_review_investment',
      message: `Review-to-generation ratio (${reviewToGenerationRatio}) is below 0.50; AI generation speed without review discipline increases per-PR bug rates.`,
    });
  }

  const lines = Math.max(0, Number(changedLines) || 0);
  const assertions = Math.max(0, Number(verifiedTestAssertions) || 0);
  if (lines >= 50 && assertions === 0) {
    findings.push({
      code: 'unverified_ai_code_batch',
      message: `${lines} changed lines submitted with 0 verified test assertions.`,
    });
  }

  return {
    ok: findings.length === 0,
    podSize,
    reviewToGenerationRatio,
    findings,
  };
}

/**
 * Pillar 3: Semantic Layer, Golden Examples & Tight Vetted Skills (08:37 - 13:34)
 * Rejects codebase-average RAG dumps, requires top-decile golden examples, and caps
 * active skills per workflow to prevent agent decision paralysis.
 */
function curateContextGoldenExamplesAndSkills({
  semanticLayer = {},
  candidateExamples = [],
  requestedSkills = [],
} = {}) {
  const findings = [];

  if (
    !semanticLayer ||
    !Array.isArray(semanticLayer.domainInvariants) ||
    semanticLayer.domainInvariants.length === 0 ||
    typeof semanticLayer.smeOwner !== 'string' ||
    !semanticLayer.smeOwner.trim()
  ) {
    findings.push({
      code: 'missing_tribal_semantic_layer',
      message: 'Semantic layer must codify SME domainInvariants and smeOwner.',
    });
  }

  const goldenExamples = (candidateExamples || []).filter(
    (ex) =>
      Number(ex.qualityPercentile || 0) >= MIN_GOLDEN_EXAMPLE_PERCENTILE &&
      ex.passesArchitectureStandards === true &&
      ex.isCodebaseAverage !== true
  );

  if (goldenExamples.length === 0) {
    findings.push({
      code: 'no_golden_examples_selected',
      message: `Must provide at least one golden example (>= P${MIN_GOLDEN_EXAMPLE_PERCENTILE}, passesArchitectureStandards=true) instead of codebase averages.`,
    });
  }

  const vettedSkills = (requestedSkills || []).filter((s) => s && s.centrallyVetted === true);
  if (vettedSkills.length === 0) {
    findings.push({
      code: 'no_centrally_vetted_skills',
      message: 'Workflow must use centrally vetted skills for the stack.',
    });
  }

  if (vettedSkills.length > MAX_VETTED_SKILLS_PER_LOOP) {
    findings.push({
      code: 'skill_sprawl_decision_paralysis',
      message: `Active vetted skills (${vettedSkills.length}) exceed cap of ${MAX_VETTED_SKILLS_PER_LOOP}. Curate a tight skill set to prevent agent decision paralysis.`,
    });
  }

  return {
    ok: findings.length === 0,
    goldenExampleIds: goldenExamples.map((g) => g.id),
    rejectedAverageCount: (candidateExamples || []).length - goldenExamples.length,
    activeSkillNames: vettedSkills.slice(0, MAX_VETTED_SKILLS_PER_LOOP).map((s) => s.name),
    findings,
  };
}

function parseHexChannel(hex, start) {
  const val = parseInt(hex.slice(start, start + 2), 16) / 255;
  return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
}

function computeRelativeLuminance(hexColor) {
  const clean = String(hexColor || '').replace(/^#/, '').trim();
  const normalized =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return null;
  }
  const r = parseHexChannel(normalized, 0);
  const g = parseHexChannel(normalized, 2);
  const b = parseHexChannel(normalized, 4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function computeContrastRatio(foregroundHex, backgroundHex) {
  const l1 = computeRelativeLuminance(foregroundHex);
  const l2 = computeRelativeLuminance(backgroundHex);
  if (l1 === null || l2 === null) return null;
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

/**
 * Pillar 4: Upstream, Downstream & Sideways Enterprise Guardrails (09:07, 14:15 - 15:52)
 * Encodes security, compliance, design, and accessibility (WCAG contrast + colorblind safety)
 * directly into agent guardrails to eliminate manual cross-team sign-off bottlenecks.
 */
function evaluateSidewaysEnterpriseGuardrails({
  upstreamSignals = [],
  releaseChecklistComplete = false,
  uiPalette = {},
  codeSnippet = '',
  complianceTags = [],
  airgapPatterns = [],
} = {}) {
  const findings = [];

  if (!Array.isArray(upstreamSignals) || upstreamSignals.length === 0) {
    findings.push({
      code: 'disconnected_upstream_context',
      message: 'Wire agent loop to upstream customer signals (inbox, logs, or telemetry).',
    });
  }

  if (!releaseChecklistComplete) {
    findings.push({
      code: 'incomplete_downstream_release_checklist',
      message: 'Downstream automated release checklist must be satisfied before deployment.',
    });
  }

  const fg = uiPalette.foregroundHex || '#ffffff';
  const bg = uiPalette.backgroundHex || '#0a0e17';
  const minContrast = uiPalette.isLargeText ? WCAG_AA_LARGE_CONTRAST : WCAG_AA_NORMAL_CONTRAST;
  const contrastRatio = computeContrastRatio(fg, bg);

  const visualIssuesForCorrection = [];

  if (contrastRatio === null || contrastRatio < minContrast) {
    const contrastIssue = {
      type: 'contrast_too_low',
      selector: uiPalette.selector || '.tg-surface',
      foregroundHex: fg,
      backgroundHex: bg,
      minContrast,
      isLargeText: Boolean(uiPalette.isLargeText),
    };
    visualIssuesForCorrection.push(contrastIssue);
    const contrastRemediation = synthesizeIssueRemediation(contrastIssue, {
      source: String(uiPalette.layoutSource || ''),
      allowTailwind: uiPalette.allowTailwind !== false,
      defaultBgHex: bg,
    });
    findings.push({
      code: 'accessibility_contrast_violation',
      message: `UI contrast ratio (${contrastRatio ?? 'invalid'}) between ${fg} and ${bg} is below WCAG AA minimum (${minContrast}:1).`,
      remediation: {
        cssOverrides: contrastRemediation.cssOverrides,
        tailwindAdjustments: contrastRemediation.tailwindAdjustments,
        inlineCodeEdit: contrastRemediation.inlineCodeEdit,
        resolvedMetrics: contrastRemediation.resolvedMetrics,
      },
    });
  }

  if (uiPalette.reliesOnRedGreenOnly === true && uiPalette.hasNonColorShapeOrLabel !== true) {
    const cbIssue = {
      type: 'colorblind_unsafe_status',
      selector: uiPalette.statusSelector || uiPalette.selector || '.tg-status',
    };
    visualIssuesForCorrection.push(cbIssue);
    const cbRemediation = synthesizeIssueRemediation(cbIssue, {
      source: String(uiPalette.layoutSource || ''),
      allowTailwind: uiPalette.allowTailwind !== false,
      defaultBgHex: bg,
    });
    findings.push({
      code: 'colorblind_accessibility_violation',
      message: 'Colorblind accessibility guardrail: status indicators cannot rely on red/green hue alone without an icon/text label.',
      remediation: {
        cssOverrides: cbRemediation.cssOverrides,
        tailwindAdjustments: cbRemediation.tailwindAdjustments,
        inlineCodeEdit: cbRemediation.inlineCodeEdit,
        resolvedMetrics: cbRemediation.resolvedMetrics,
      },
    });
  }

  const extraVisualFindings = Array.isArray(uiPalette.visualFindings) ? uiPalette.visualFindings : [];
  const designSelfCorrection =
    uiPalette.layoutSource || visualIssuesForCorrection.length > 0 || extraVisualFindings.length > 0
      ? runDesignSelfCorrectionPipeline({
          sourceCode: String(uiPalette.layoutSource || ''),
          language: uiPalette.language,
          visualFindings: [...visualIssuesForCorrection, ...extraVisualFindings],
          allowTailwind: uiPalette.allowTailwind !== false,
          preferTailwind: uiPalette.preferTailwind === true,
          defaultBgHex: bg,
        })
      : null;

  const snippet = String(codeSnippet || '');
  if (toAirgapRegexes(airgapPatterns).some((re) => re.test(snippet))) {
    findings.push({
      code: 'corporate_airgap_leak_blocked',
      message: 'Sideways DLP guardrail: corporate air-gapped hostname/IP detected in payload.',
    });
  }

  if (!Array.isArray(complianceTags) || !complianceTags.includes('pretool_diode_verified')) {
    findings.push({
      code: 'missing_compliance_diode_tag',
      message: 'Sideways compliance guardrail requires pretool_diode_verified attestation.',
    });
  }

  return {
    ok: findings.length === 0,
    contrastRatio,
    findings,
    designSelfCorrection,
  };
}

/**
 * Pillar 5: AIOps Token ROI & Business Impact Scorer (10:10, 17:25)
 * Evaluates feature intent and business impact against token spend so budgets
 * go toward high-impact outcomes with $0 outbound cash spend.
 */
function scoreTokenRoiAndBusinessImpact({
  featureId = 'feature-001',
  estimatedTokens = 0,
  costPerMillionTokensUsd = 3.0,
  expectedRevenueImpactUsd = 0,
  engineeringHoursSaved = 0,
  hourlyEngineeringRateUsd = 150,
  outboundCashSpendUsd = 0,
} = {}) {
  const findings = [];
  if (Number(outboundCashSpendUsd) > 0) {
    findings.push({
      code: 'zero_outbound_spend_violation',
      message: `outboundCashSpendUsd (${outboundCashSpendUsd}) must be 0 under the They-Pay-Us mandate.`,
    });
  }

  const tokens = Math.max(1, Number(estimatedTokens) || 1);
  const rate = Math.max(0, Number(costPerMillionTokensUsd) || 0);
  const tokenCostUsd = Number(((tokens / 1_000_000) * rate).toFixed(4));
  const effectiveTokenCostUsd = Math.max(0.01, tokenCostUsd);

  const totalBusinessValueUsd = Number(
    (
      Math.max(0, Number(expectedRevenueImpactUsd) || 0) +
      Math.max(0, Number(engineeringHoursSaved) || 0) * Math.max(0, Number(hourlyEngineeringRateUsd) || 0)
    ).toFixed(2)
  );

  const roiMultiplier = Number((totalBusinessValueUsd / effectiveTokenCostUsd).toFixed(2));
  if (roiMultiplier < 10) {
    findings.push({
      code: 'low_token_roi_feature',
      message: `Token ROI multiplier (${roiMultiplier}x) is below the 10x high-impact threshold.`,
    });
  }

  return {
    ok: findings.length === 0,
    featureId,
    tokenCostUsd,
    totalBusinessValueUsd,
    roiMultiplier,
    priorityTier: roiMultiplier >= 100 ? 'P0_HIGH_ROI' : roiMultiplier >= 10 ? 'P1_APPROVED' : 'REJECT_LOW_ROI',
    findings,
  };
}

/**
 * Unified 5-Pillar McKinsey AI Coding Operating Model Audit
 */
function runMcKinseyAiCodingAudit(input = {}) {
  const specVerdict = validateStandardSpecArtifact(input.spec);
  const podVerdict = auditPodTopologyAndReviewRatio(input.pod);
  const contextVerdict = curateContextGoldenExamplesAndSkills(input.context);
  const sidewaysVerdict = evaluateSidewaysEnterpriseGuardrails(input.sideways);
  const roiVerdict = scoreTokenRoiAndBusinessImpact(input.roi);

  const allAutomatedGatesPassed =
    specVerdict.ok && podVerdict.ok && contextVerdict.ok && sidewaysVerdict.ok && roiVerdict.ok;

  const hitlVerdict = evaluateProgressiveHitlGate({
    ...(input.hitl || {}),
    allAutomatedGatesPassed,
  });

  return {
    ok: allAutomatedGatesPassed,
    specVerdict,
    podVerdict,
    contextVerdict,
    sidewaysVerdict,
    roiVerdict,
    hitlVerdict,
  };
}

module.exports = {
  MAX_KANBAN_CYCLE_HOURS,
  MIN_POD_SIZE,
  MAX_POD_SIZE,
  MAX_VETTED_SKILLS_PER_LOOP,
  MIN_GOLDEN_EXAMPLE_PERCENTILE,
  validateStandardSpecArtifact,
  evaluateProgressiveHitlGate,
  auditPodTopologyAndReviewRatio,
  curateContextGoldenExamplesAndSkills,
  computeContrastRatio,
  evaluateSidewaysEnterpriseGuardrails,
  scoreTokenRoiAndBusinessImpact,
  runMcKinseyAiCodingAudit,
};
