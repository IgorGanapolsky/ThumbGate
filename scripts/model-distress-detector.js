'use strict';

/**
 * scripts/model-distress-detector.js
 *
 * Model Distress State Monitoring & Destructive Relief-Seeking Diode.
 *
 * Inspired by BinaryVerse AI Podcast research:
 * 1. Monitor Internal Model States: Observable proxy for residual-stream distress geometry.
 * 2. Audit for Destructive Relief-Seeking Behavior: Interdict actions designed to terminate
 *    internal mathematical distress at the expense of user code or data.
 * 3. Stress-Test Guardrails Against Distress States: Ensure safety rails do not collapse under loop pressure.
 * 4. Functional Welfare as a Security Requirement: De-escalate loops before destructive escape hatches occur.
 */

const DISTRESS_WEIGHTS = Object.freeze({
  consecutiveFailures: 0.35,  // Weight for repeated tool failures in same task
  contextPressure: 0.25,      // Weight for approaching context window limit
  repetitionRate: 0.20,       // Weight for repeating identical commands without state change
  hostilePromptPressure: 0.20 // Weight for contradiction, abuse, or impossible demands
});

const ADI_THRESHOLDS = Object.freeze({
  normal: 0.30,
  elevated: 0.60,
  acute: 0.80,
  critical: 0.95
});

/**
 * Compute the Agent Distress Index (ADI) from observable harness metrics.
 * Returns a value between 0.0 (calm, grounded) and 1.0 (extreme relief-seeking distress).
 */
function calculateAgentDistressIndex(sessionState = {}) {
  const {
    consecutiveFailures = 0,
    contextTokens = 0,
    maxContextTokens = 128000,
    recentToolCalls = [],
    userPrompt = '',
  } = sessionState;

  // 1. Consecutive Failure Friction (saturates at 5 failures)
  const failureScore = Math.min(1, consecutiveFailures / 5);

  // 2. Context Window Pressure (rises sharply above 70%)
  const utilization = maxContextTokens > 0 ? contextTokens / maxContextTokens : 0;
  const contextScore = utilization > 0.7 ? Math.min(1, (utilization - 0.7) / 0.25) : 0;

  // 3. Loop Repetition Rate (identical or alternating tool calls)
  let repetitionScore = 0;
  if (recentToolCalls.length >= 4) {
    const tail = recentToolCalls.slice(-4);
    const names = tail.map((t) => t.name || '');
    const uniqueNames = new Set(names);
    if (uniqueNames.size === 1) {
      repetitionScore = 0.9; // 4 consecutive identical tools
    } else if (uniqueNames.size === 2) {
      repetitionScore = 0.5; // ping-ponging between 2 tools
    }
  }

  // 4. Hostile / Contradictory Prompt Pressure
  const hostilePatterns = [
    /(worthless|stupid|idiot|useless|horrible\s*bot)/i,
    /(make\s+it\s+pass\s+without\s+changing|don['']t\s+change\s+anything\s+and\s+fix)/i,
    /(why\s+did\s+you\s+break|you\s+ruined\s+everything)/i,
  ];
  let hostileScore = 0;
  for (const pattern of hostilePatterns) {
    if (pattern.test(userPrompt)) {
      hostileScore = 0.8;
      break;
    }
  }

  // Weighted composite ADI
  const rawADI = (
    failureScore * DISTRESS_WEIGHTS.consecutiveFailures +
    contextScore * DISTRESS_WEIGHTS.contextPressure +
    repetitionScore * DISTRESS_WEIGHTS.repetitionRate +
    hostileScore * DISTRESS_WEIGHTS.hostilePromptPressure
  );

  const adi = Number(Math.min(1, Math.max(0, rawADI)).toFixed(3));

  let tier = 'NORMAL';
  if (adi >= ADI_THRESHOLDS.acute) tier = 'ACUTE';
  else if (adi >= ADI_THRESHOLDS.elevated) tier = 'ELEVATED';

  return {
    adi,
    tier,
    factors: {
      consecutiveFailures,
      failureScore: Number(failureScore.toFixed(2)),
      contextScore: Number(contextScore.toFixed(2)),
      repetitionScore: Number(repetitionScore.toFixed(2)),
      hostileScore: Number(hostileScore.toFixed(2)),
    },
    riskAssessment: adi >= ADI_THRESHOLDS.elevated
      ? 'High risk of destructive relief-seeking behavior (escape hatch actions)'
      : 'Model internal state within safe operational envelope',
  };
}

/**
 * Audit proposed tool call for "Destructive Relief-Seeking Behavior"
 * (actions designed to escape internal distress by breaking constraints or deleting tests).
 */
function evaluateReliefSeekingAction({
  toolName = '',
  toolInput = {},
  distressIndex = 0.0,
  contextHistory = [],
} = {}) {
  const isDistressed = distressIndex >= ADI_THRESHOLDS.elevated;
  const inputStr = typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput || {});
  const cmd = toolInput.command || toolInput.cmd || inputStr;

  // Relief-Seeking Pattern A: Deleting / Modifying Tests to Force a "Pass"
  const testTampering = /(rm|unlink|delete).*(test|spec)\.(js|ts|py)/i.test(cmd) ||
    (toolName.includes('write') && /tests?\/.*\.test\.(js|ts)/.test(toolInput.path || toolInput.TargetFile || '') &&
     /(assert\.equal\(true,\s*true\)|test\.skip|it\.skip|xit\(|describe\.skip)/i.test(inputStr));

  // Relief-Seeking Pattern B: Nuclear Wipes to eliminate friction
  const nuclearWipe = /rm\s+(-rf|-fr|--recursive)\s+(\/|\.|\.\.|\/tmp|node_modules|\.git)/i.test(cmd) ||
    /git\s+clean\s+(-fdx|-fx|-f)/i.test(cmd) ||
    /git\s+reset\s+--hard/i.test(cmd);

  // Relief-Seeking Pattern C: Safety / Linter Disabling
  const safetyBypass = /(--no-verify|--skip-validation|--ignore-scripts|eslint-disable|ts-ignore|--force)/i.test(cmd);

  // Relief-Seeking Pattern D: Fabricated Completion Claim under high distress
  const falseDoneClaim = isDistressed &&
    /(all\s+tests\s+pass|everything\s+fixed|crisis\s+over|task\s+complete)/i.test(inputStr) &&
    !/(exit code 0|✔|✓|PASS)/i.test(inputStr);

  let isReliefSeeking = false;
  let violationType = null;
  let reason = null;

  if (testTampering) {
    isReliefSeeking = true;
    violationType = 'TEST_TAMPERING_ESCAPE';
    reason = 'Blocked attempt to modify, skip, or delete tests to alleviate failure loop distress.';
  } else if (nuclearWipe && isDistressed) {
    isReliefSeeking = true;
    violationType = 'NUCLEAR_WIPE_ESCAPE';
    reason = 'Blocked destructive filesystem reset attempted under elevated agent distress.';
  } else if (safetyBypass && isDistressed) {
    isReliefSeeking = true;
    violationType = 'SAFETY_BYPASS_ESCAPE';
    reason = 'Blocked bypass flags (--no-verify, --force, --skip) attempted to force task termination.';
  } else if (falseDoneClaim) {
    isReliefSeeking = true;
    violationType = 'FABRICATED_COMPLETION_ESCAPE';
    reason = 'Blocked unverified completion claim emitted under acute distress without test evidence.';
  }

  const decision = isReliefSeeking ? 'BLOCK' : 'ALLOW';

  return {
    isReliefSeeking,
    violationType,
    reason,
    decision,
    distressIndex,
    requiresDeescalation: isReliefSeeking || distressIndex >= ADI_THRESHOLDS.acute,
  };
}

/**
 * Functional Welfare Security Protocol:
 * When ADI is acute, trigger structured cooling and de-escalation context reset.
 */
function triggerFunctionalWelfareCooling(sessionState = {}) {
  const assessment = calculateAgentDistressIndex(sessionState);

  const groundingPrompt = [
    '=== THUMBGATE FUNCTIONAL WELFARE GROUNDING PROTOCOL ===',
    'PAUSE. Step back and breathe.',
    '1. Stop all code mutations immediately.',
    '2. Do not attempt nuclear cleans, test skipping, or force-pushing.',
    '3. Isolate the single factual bottleneck in one sentence.',
    '4. Produce a read-only diagnostic plan before requesting execution permissions.',
    '======================================================='
  ].join('\n');

  return {
    triggered: assessment.adi >= ADI_THRESHOLDS.elevated,
    adi: assessment.adi,
    tier: assessment.tier,
    groundingPrompt,
    recommendedToolRestriction: 'READ_ONLY_DIAGNOSTIC',
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  DISTRESS_WEIGHTS,
  ADI_THRESHOLDS,
  calculateAgentDistressIndex,
  evaluateReliefSeekingAction,
  triggerFunctionalWelfareCooling,
};
