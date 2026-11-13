#!/usr/bin/env node
'use strict';

/**
 * RSI Unit Economics Router & Governance Diode
 *
 * Operationalizes the architectural principles from:
 *   - "AI Lurches Towards RSI" (NLW Analysis / https://music.youtube.com/watch?v=Es59icF3nZg)
 *   - SemiAnalysis GDPX Cost-Efficiency Benchmark (Gemini 4 Carbon vs Opus 5.5)
 *   - MIT Direct Weight-Editing Research (Rakia Takahi et al., 0.016% micro-weight edits)
 *   - Anthropic S-1 Autonomous R&D Governance & Human-in-the-Loop Safeguards
 *   - Generative Engine Optimization (GEO) & Machine-Readable Discovery
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Pricing & Benchmark Constants (Unsubsidized True API Economics, 2026)
// ---------------------------------------------------------------------------

const BENCHMARK_HOURLY_HUMAN_LABOR_RATE = 75.0; // $75/hour baseline senior engineer

const TRUE_API_PRICING = Object.freeze({
  'claude-opus-5.5': {
    label: 'Claude Opus 5.5 (Frontier Ultra)',
    inputPerM: 15.0,
    outputPerM: 75.0,
    avgTaskCostUsd: 51.0,
    gdpxEfficiencyIndex: 1.0, // baseline
    tier: 'frontier_ultra',
  },
  'gpt-5.5': {
    label: 'GPT-5.5 (Frontier Ultra)',
    inputPerM: 12.5,
    outputPerM: 50.0,
    avgTaskCostUsd: 48.0,
    gdpxEfficiencyIndex: 1.06,
    tier: 'frontier_ultra',
  },
  'gemini-4-carbon': {
    label: 'Gemini 4 Carbon (High-Efficiency Workhorse)',
    inputPerM: 2.0,
    outputPerM: 8.0,
    avgTaskCostUsd: 16.0,
    gdpxEfficiencyIndex: 3.19, // ~4x cheaper, identical coding/bench quality
    tier: 'carbon_workhorse',
  },
  'qwen-3.8-max': {
    label: 'Qwen 3.8 Max (Bulk Cloud)',
    inputPerM: 2.0,
    outputPerM: 6.0,
    avgTaskCostUsd: 14.5,
    gdpxEfficiencyIndex: 3.52,
    tier: 'carbon_workhorse',
  },
  'gpt-5.4-mini': {
    label: 'GPT-5.4 Mini',
    inputPerM: 0.3,
    outputPerM: 1.2,
    avgTaskCostUsd: 2.4,
    gdpxEfficiencyIndex: 21.25,
    tier: 'fast_mini',
  },
  'claude-haiku-4.5': {
    label: 'Claude Haiku 4.5',
    inputPerM: 0.8,
    outputPerM: 4.0,
    avgTaskCostUsd: 3.8,
    gdpxEfficiencyIndex: 13.42,
    tier: 'fast_mini',
  },
  'hermes-local-frontier': {
    label: 'Nous Research Hermes Local / vLLM',
    inputPerM: 0.0,
    outputPerM: 0.0,
    avgTaskCostUsd: 0.0,
    gdpxEfficiencyIndex: Infinity,
    tier: 'local_zero_marginal',
  },
});

const MIT_MICRO_WEIGHT_EDIT_LIMIT = 0.00016; // 0.016% parameter threshold

// ---------------------------------------------------------------------------
// 1. True API Cost & Subsidy Auditor
// ---------------------------------------------------------------------------

/**
 * Audits unit economics at real unsubsidized API rates vs flat consumer plans.
 */
function auditUnitEconomics({
  taskName = 'agent_task',
  modelId = 'claude-opus-5.5',
  inputTokens = 100_000,
  outputTokens = 20_000,
  executionHours = 0.5,
  planType = 'flat_consumer_subscription', // 'flat_consumer_subscription' | 'direct_api'
  monthlySubscriptionCost = 200.0,
  monthlyTasksRun = 300,
} = {}) {
  const pricing = TRUE_API_PRICING[modelId] || TRUE_API_PRICING['claude-opus-5.5'];

  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerM;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerM;
  const trueApiCostUsd = Number((inputCost + outputCost).toFixed(4));

  const humanLaborCostUsd = Number((executionHours * BENCHMARK_HOURLY_HUMAN_LABOR_RATE).toFixed(2));
  const netSavingsUsd = Number((humanLaborCostUsd - trueApiCostUsd).toFixed(2));
  const roiMultiplier = trueApiCostUsd > 0
    ? Number((netSavingsUsd / trueApiCostUsd).toFixed(2))
    : Infinity;

  // Detect vulnerability to the end of VC-subsidized inference:
  // e.g. User pays $200/mo flat, runs 300 tasks consuming $14,000 in true API compute.
  const flatCostPerTask = monthlyTasksRun > 0 ? monthlySubscriptionCost / monthlyTasksRun : monthlySubscriptionCost;
  const subsidyRatio = flatCostPerTask > 0 ? trueApiCostUsd / flatCostPerTask : 1.0;
  const subsidizedPlanVulnerability = planType === 'flat_consumer_subscription' && subsidyRatio > 3.0;

  return {
    taskName,
    modelId,
    pricingLabel: pricing.label,
    tokens: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
    trueApiCostUsd,
    humanLaborBenchmark: {
      estimatedHours: executionHours,
      hourlyRate: BENCHMARK_HOURLY_HUMAN_LABOR_RATE,
      humanLaborCostUsd,
    },
    economics: {
      netSavingsUsd,
      roiMultiplier,
      viablePostSubsidy: netSavingsUsd > 0,
    },
    subsidyAnalysis: {
      planType,
      flatCostPerTask: Number(flatCostPerTask.toFixed(2)),
      trueCostPerTask: trueApiCostUsd,
      subsidyRatio: Number(subsidyRatio.toFixed(2)),
      subsidizedPlanVulnerability,
      warning: subsidizedPlanVulnerability
        ? `Task costs $${trueApiCostUsd} at true API rates vs $${flatCostPerTask.toFixed(2)} on consumer flat plan (${subsidyRatio.toFixed(1)}x subsidy). Workflow will break when vendor caps flat inference.`
        : null,
    },
  };
}

// ---------------------------------------------------------------------------
// 2. SemiAnalysis GDPX Cost-Efficiency Router
// ---------------------------------------------------------------------------

/**
 * Routes tasks to cost-efficient models based on task type and complexity,
 * preventing $51/task Opus 5.5 defaults when $16/task Gemini 4 Carbon
 * achieves nearly identical performance.
 */
function routeByGdpxEfficiency({
  taskType = 'general_coding',
  complexity = 'medium', // 'low' | 'medium' | 'high' | 'ultra_architecture'
  riskLevel = 'normal', // 'safe' | 'normal' | 'high'
  requiresCrossRepoSynthesis = false,
} = {}) {
  // Only route to expensive Frontier Ultra ($51/task) when truly necessary
  const needsFrontierUltra =
    complexity === 'ultra_architecture' ||
    requiresCrossRepoSynthesis === true ||
    (complexity === 'high' && riskLevel === 'high');

  if (needsFrontierUltra) {
    const selected = TRUE_API_PRICING['claude-opus-5.5'];
    return {
      selectedModel: 'claude-opus-5.5',
      tier: selected.tier,
      label: selected.label,
      avgTaskCostUsd: selected.avgTaskCostUsd,
      gdpxEfficiencyIndex: selected.gdpxEfficiencyIndex,
      savingsVsOpusUsd: 0.0,
      reason: 'Ultra-complex or high-risk architectural synthesis requires Frontier Ultra reasoning.',
    };
  }

  // Fast Mini for triage, labeling, documentation, small edits
  if (complexity === 'low' || ['triage', 'classification', 'extraction', 'formatting'].includes(taskType)) {
    const selected = TRUE_API_PRICING['gpt-5.4-mini'];
    const opusCost = TRUE_API_PRICING['claude-opus-5.5'].avgTaskCostUsd;
    return {
      selectedModel: 'gpt-5.4-mini',
      tier: selected.tier,
      label: selected.label,
      avgTaskCostUsd: selected.avgTaskCostUsd,
      gdpxEfficiencyIndex: selected.gdpxEfficiencyIndex,
      savingsVsOpusUsd: Number((opusCost - selected.avgTaskCostUsd).toFixed(2)),
      reason: 'Low-complexity extraction/triage routed to Fast Mini (95% cost reduction).',
    };
  }

  // Default High-Efficiency Workhorse (Gemini 4 Carbon / Qwen 3.8-Max)
  // Yields ~3.19x GDPX efficiency advantage ($16 vs $51 per task)
  const selected = TRUE_API_PRICING['gemini-4-carbon'];
  const opusCost = TRUE_API_PRICING['claude-opus-5.5'].avgTaskCostUsd;
  return {
    selectedModel: 'gemini-4-carbon',
    tier: selected.tier,
    label: selected.label,
    avgTaskCostUsd: selected.avgTaskCostUsd,
    gdpxEfficiencyIndex: selected.gdpxEfficiencyIndex,
    savingsVsOpusUsd: Number((opusCost - selected.avgTaskCostUsd).toFixed(2)),
    reason: 'Standard coding/debugging routed to Gemini 4 Carbon (GDPX 3.19x efficiency, saves ~$35/task).',
  };
}

// ---------------------------------------------------------------------------
// 3. Agent Platform Failover Diode (GrokBot / OpenAI Rate Limit Shield)
// ---------------------------------------------------------------------------

/**
 * Handles sudden rate limits or usage caps on consumer platforms (e.g. GrokBot caps)
 * by failover-routing workflows to alternative agent ecosystems.
 */
function evaluateAgentPlatformFailover({
  currentPlatform = 'grok_bot',
  httpStatusCode = 200,
  rateLimitExceeded = false,
  rateLimitHeader = null,
} = {}) {
  const isCapped = rateLimitExceeded || httpStatusCode === 429 || httpStatusCode === 503;

  if (!isCapped) {
    return {
      status: 'HEALTHY',
      platform: currentPlatform,
      failoverRequired: false,
      activeEndpoint: currentPlatform,
    };
  }

  // Failover matrix to sustainable, unsubsidized platforms
  const failoverMap = {
    grok_bot: {
      targetPlatform: 'hermes_agent',
      targetModel: 'gemini-4-carbon',
      provider: 'nous_research',
      notes: 'Migrated from throttled GrokBot to Nous Research Hermes with Gemini 4 Carbon workhorse.',
    },
    openai_consumer: {
      targetPlatform: 'hermes_agent',
      targetModel: 'gemini-4-carbon',
      provider: 'openrouter_direct',
      notes: 'Migrated from rate-limited OpenAI consumer endpoint to direct API gateway.',
    },
    default: {
      targetPlatform: 'hermes_agent',
      targetModel: 'hermes-local-frontier',
      provider: 'local_vllm',
      notes: 'Migrated to local zero-cost frontier fallback.',
    },
  };

  const plan = failoverMap[currentPlatform] || failoverMap.default;

  return {
    status: 'FAILOVER_TRIGGERED',
    originalPlatform: currentPlatform,
    failoverRequired: true,
    failoverTarget: plan.targetPlatform,
    failoverModel: plan.targetModel,
    failoverProvider: plan.provider,
    reason: `Platform '${currentPlatform}' encountered rate limits or usage caps (status: ${httpStatusCode}). Seamlessly redirected to ${plan.targetPlatform}.`,
  };
}

// ---------------------------------------------------------------------------
// 4. RSI & MIT Direct Weight-Editing Governance Guardrail
// ---------------------------------------------------------------------------

/**
 * Inspects proposals for Recursive Self-Improvement (RSI) or direct weight editing.
 * Enforces Anthropic S-1 governance: autonomous systems may NOT modify model weights
 * or core safety policies without verified test passes and explicit human approval.
 */
function evaluateRsiWeightEditProposal({
  modelName = 'qwen-3.5-0.8b',
  editedParameterCount = 128_000,
  totalParameterCount = 800_000_000,
  targetLayer = 'mlp.down_proj',
  objective = 'eliminate_reasoning_loop',
  hasHumanApproval = false,
  testsPassed = false,
  rollbackArtifactAvailable = false,
} = {}) {
  const fractionEdited = totalParameterCount > 0
    ? editedParameterCount / totalParameterCount
    : 1.0;

  const isMicroEdit = fractionEdited <= MIT_MICRO_WEIGHT_EDIT_LIMIT;

  const violations = [];
  if (!isMicroEdit) {
    violations.push(
      `Fraction of weights proposed for edit (${(fractionEdited * 100).toFixed(4)}%) exceeds the MIT micro-edit bound of ${(MIT_MICRO_WEIGHT_EDIT_LIMIT * 100).toFixed(4)}%.`
    );
  }
  if (!testsPassed) {
    violations.push('RSI weight edit has not passed independent deterministic test verifiers.');
  }
  if (!rollbackArtifactAvailable) {
    violations.push('No verifiable zero-cost rollback snapshot exists for proposed weight modification.');
  }
  if (!hasHumanApproval) {
    violations.push('Anthropic S-1 Governance: autonomous weight modification requires explicit human-in-the-loop sign-off.');
  }

  const allowed = violations.length === 0;

  return {
    allowed,
    verdict: allowed ? 'ALLOW' : 'BLOCK',
    modelName,
    fractionEdited: Number(fractionEdited.toFixed(6)),
    mitMicroEditCompliant: isMicroEdit,
    governanceChecks: {
      hasHumanApproval,
      testsPassed,
      rollbackArtifactAvailable,
    },
    violations,
    recommendation: allowed
      ? 'Weight edit approved with verified test pass and rollback snapshot.'
      : 'Maintain self-improvement in external control layer (ThumbGate firewall / lessons) rather than internal weight mutation.',
  };
}

// ---------------------------------------------------------------------------
// 5. Generative Engine Optimization (GEO) Validator
// ---------------------------------------------------------------------------

/**
 * Validates documentation against GEO (Generative Engine Optimization) standards
 * so frontier search agents (Perplexity, ChatGPT Search, Gemini) extract and cite
 * the software directly in zero-click generated responses.
 */
function validateGeoContent(content = '') {
  const text = String(content || '');
  const issues = [];
  const signals = [];

  // 1. Direct problem statement at top
  if (/^#\s+.+\n>+/m.test(text) || /What\s+.+\s+solves/i.test(text)) {
    signals.push('has_clear_problem_solution_block');
  } else {
    issues.push('Missing concise blockquote or problem-solution definition within the first 50 lines.');
  }

  // 2. Machine-executable code / command snippet
  if (/```(?:bash|sh|json|javascript|js)/.test(text) || /`npm\s+(?:i|install|run)/.test(text)) {
    signals.push('has_executable_snippets');
  } else {
    issues.push('Missing machine-extractable CLI or code snippets for zero-click action.');
  }

  // 3. Grounded canonical URLs
  const hasCanonicalLinks = /https?:\/\/(?:github\.com|npmjs\.com|thumbgate\.ai)/i.test(text);
  if (hasCanonicalLinks) {
    signals.push('has_grounded_canonical_urls');
  } else {
    issues.push('Missing grounded canonical URL citations for attribution.');
  }

  // 4. Low fluff density (GEO preference for high fact density)
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const isHighDensity = wordCount >= 50 && !/\b(revolutionize|game-changer|magical|unprecedented synergy)\b/i.test(text);
  if (isHighDensity) {
    signals.push('high_fact_density_no_buzzwords');
  } else {
    issues.push('Excessive marketing buzzwords detected; search agents downrank non-factual prose.');
  }

  const score = Math.max(0, 100 - issues.length * 25);
  return {
    score,
    passed: score >= 75,
    signals,
    issues,
  };
}

// ---------------------------------------------------------------------------
// Doctor & CLI Self-Check
// ---------------------------------------------------------------------------

function runDoctor() {
  const audit = auditUnitEconomics({
    taskName: 'ci_pipeline_debugging',
    modelId: 'claude-opus-5.5',
    inputTokens: 150_000,
    outputTokens: 25_000,
    executionHours: 0.75,
  });

  const routing = routeByGdpxEfficiency({
    taskType: 'general_coding',
    complexity: 'medium',
  });

  const failover = evaluateAgentPlatformFailover({
    currentPlatform: 'grok_bot',
    httpStatusCode: 429,
    rateLimitExceeded: true,
  });

  const rsiBlocked = evaluateRsiWeightEditProposal({
    hasHumanApproval: false,
    testsPassed: false,
  });

  const rsiAllowed = evaluateRsiWeightEditProposal({
    editedParameterCount: 120_000,
    totalParameterCount: 800_000_000,
    hasHumanApproval: true,
    testsPassed: true,
    rollbackArtifactAvailable: true,
  });

  const sampleGeoDoc = `# ThumbGate — Self-Improving Firewall for Your AI Agents
> ThumbGate is the self-improving firewall that prevents expensive AI mistakes before they happen.
It checks risky shell commands, file edits, production deploys, stripe payments, and external API requests.

## What ThumbGate solves
- AI coding agents repeat costly mistakes across consecutive sessions.
- Destructive shell operations and unverified mutations slip past passive markdown instructions.
- CLAUDE.md and cursorrules are passive guidelines that LLMs frequently ignore under high token drift.

## Quick Start
\`\`\`bash
npm install -g thumbgate
thumbgate doctor
\`\`\`

Canonical Repository: https://github.com/IgorGanapolsky/ThumbGate
Documentation: https://thumbgate.ai/docs
Package: https://www.npmjs.com/package/thumbgate
`;
  const geo = validateGeoContent(sampleGeoDoc);

  const checks = [
    {
      id: 'true_api_cost_auditing',
      ok: audit.trueApiCostUsd > 0 && audit.humanLaborBenchmark.humanLaborCostUsd > 0 && audit.economics.roiMultiplier > 0,
      detail: `True API cost: $${audit.trueApiCostUsd}, Labor saved: $${audit.humanLaborBenchmark.humanLaborCostUsd}, ROI: ${audit.economics.roiMultiplier}x`,
    },
    {
      id: 'gdpx_cost_efficiency_routing',
      ok: routing.selectedModel === 'gemini-4-carbon' && routing.savingsVsOpusUsd > 30,
      detail: `Selected: ${routing.selectedModel} (${routing.label}), saves $${routing.savingsVsOpusUsd}/task vs Opus 5.5`,
    },
    {
      id: 'platform_rate_limit_failover',
      ok: failover.failoverRequired === true && failover.failoverTarget === 'hermes_agent',
      detail: `Throttled ${failover.originalPlatform} -> redirected to ${failover.failoverTarget} (${failover.failoverModel})`,
    },
    {
      id: 'rsi_weight_edit_governance_block',
      ok: rsiBlocked.allowed === false && rsiBlocked.violations.length >= 2,
      detail: `Blocked unverified autonomous weight edit (${rsiBlocked.violations.length} violations enforced)`,
    },
    {
      id: 'rsi_weight_edit_governance_allow',
      ok: rsiAllowed.allowed === true && rsiAllowed.mitMicroEditCompliant === true,
      detail: `Approved 0.015% micro-edit with verified tests and human sign-off`,
    },
    {
      id: 'geo_generative_engine_optimization',
      ok: geo.passed && geo.score === 100,
      detail: `GEO Score: ${geo.score}/100, signals: ${geo.signals.join(', ')}`,
    },
  ];

  const allOk = checks.every((c) => c.ok);
  return {
    ok: allOk,
    verdict: allOk ? 'PASS' : 'FAIL',
    checks,
  };
}

if (require.main === module) {
  const report = runDoctor();
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`RSI Unit Economics & Governance Doctor: ${report.verdict}\n`);
    for (const check of report.checks) {
      process.stdout.write(`  [${check.ok ? 'PASS' : 'FAIL'}] ${check.id}: ${check.detail}\n`);
    }
  }
  process.exit(report.ok ? 0 : 1);
}

module.exports = {
  BENCHMARK_HOURLY_HUMAN_LABOR_RATE,
  TRUE_API_PRICING,
  MIT_MICRO_WEIGHT_EDIT_LIMIT,
  auditUnitEconomics,
  routeByGdpxEfficiency,
  evaluateAgentPlatformFailover,
  evaluateRsiWeightEditProposal,
  validateGeoContent,
  runDoctor,
};
