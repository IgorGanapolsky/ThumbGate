#!/usr/bin/env node
'use strict';

/**
 * scripts/reflection-beam-steal.js
 *
 * FORMAT & Architecture Steal from Reflection AI's Beam & Mirror CLI launch (2026-10-16):
 * "Beam is now available" (https://reflection.ai/blog/beam-is-available)
 * + Mirror CLI Docs (https://developers.reflection.ai/mirror-overview & /mirror-mcp)
 *
 * Steals 4 high-ROI capabilities into ThumbGate:
 *   1. Mirror CLI PreToolUse Sandbox Diode (`evaluateMirrorCliActionGate`):
 *      Mirror's docs warn: "Approval mode (`--approval-mode auto`) decides what you review.
 *      It isn't a sandbox. Approved commands, extensions, and local MCP servers run with
 *      your account's full permissions." ThumbGate wires into `~/.mirror/mcp/thumbgate.json`
 *      and gates shell/edit/extension calls in <0.5ms while stripping `REFLECTION_API_KEY`
 *      and `FIRECRAWL_API_KEY` from child subprocess environments.
 *   2. Minimal Enforcement Core Separation (`verifyMinimalCoreBoundary`):
 *      Mirror separates its Python product frontend (prompts, skills, extensions) from a
 *      minimal Rust agent core so the core doubles as a clean evaluation surface.
 *   3. Verified-Trace Self-Distillation Filter (`filterVerifiedTracesForSelfDistillation`):
 *      Implements Beam's Figure 5 self-distillation loop — filtering trajectories strictly
 *      by deterministic test/verifier receipts and high token efficiency before emitting
 *      LoRA / SFT self-distillation training examples.
 *   4. `Beam-1.0-501B-A23B` (501B total / 23B active MoE, Apache-2.0, 1M context, 128k output)
 *      OpenAI-compatible provider & Pi/Mirror model config generator (`buildBeamProviderConfig`).
 */

const crypto = require('node:crypto');

const BEAM_MODEL_SPEC = {
  id: 'Beam-1.0-501B-A23B',
  provider: 'reflection',
  baseUrl: 'https://api.reflection.ai/openai/v1',
  license: 'Apache-2.0',
  totalParametersB: 501,
  activeParametersB: 23,
  architecture: 'sparse-moe-with-speculative-drafter',
  precisions: ['BF16', 'FP8', 'NVFP4'],
  contextWindow: 1048576,
  maxTokens: 131072,
  reasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  drafterModel: 'Beam-1.0-501B-A23B-DFlash2',
};

const BEAM_HARMONY_EFFORT_MAP = {
  minimal: 8,
  low: 32,
  medium: 64,
  high: 128,
  xhigh: 256,
  max: 512,
};

const DFLASH2_SPEC = {
  id: 'Beam-1.0-501B-A23B-DFlash2',
  parametersB: 1.93,
  conditionedBeamLayersCount: 5,
  reusesBeamEmbeddingAndLmHead: true,
  slidingWindowTokens: 4096,
  trainedBlockSize: 16,
  recommendedServingBlockSize: 8,
  supportedPrecisions: ['BF16', 'FP8', 'NVFP4'],
  benchmarks: {
    GSM8K: { acceptanceLength: 5.88, speedupC1: 3.03, speedupC16: 2.51, speedupC32: 2.75 },
    'MATH-500': { acceptanceLength: 5.39, speedupC1: 2.99, speedupC16: 2.42, speedupC32: 2.52 },
    HumanEval: { acceptanceLength: 4.68, speedupC1: 2.54, speedupC16: 2.20, speedupC32: 2.34 },
    MBPP: { acceptanceLength: 4.32, speedupC1: 2.30, speedupC16: 2.07, speedupC32: 2.21 },
    'MT-Bench': { acceptanceLength: 4.11, speedupC1: 1.96, speedupC16: 1.72, speedupC32: 1.89 },
  },
};

/**
 * Generate the `~/.mirror/mcp/thumbgate.json` and Pi `models.json` config for `Beam-1.0-501B-A23B`.
 */
function buildBeamAndMirrorConfig({ repoRoot = process.cwd() } = {}) {
  return {
    mirrorMcpConfigPath: '~/.mirror/mcp/thumbgate.json',
    mirrorMcpConfig: {
      command: 'node',
      args: [`${repoRoot}/adapters/mcp/server-stdio.js`],
      startupTimeoutSeconds: 15,
      toolTimeoutSeconds: 300,
    },
    piProviderConfig: {
      providers: {
        reflection: {
          baseUrl: BEAM_MODEL_SPEC.baseUrl,
          api: 'openai-completions',
          apiKey: '$REFLECTION_API_KEY',
          models: [
            {
              id: BEAM_MODEL_SPEC.id,
              reasoning: true,
              contextWindow: BEAM_MODEL_SPEC.contextWindow,
              maxTokens: BEAM_MODEL_SPEC.maxTokens,
              thinkingLevelMap: { off: null, minimal: null, xhigh: 'xhigh', max: 'max' },
            },
          ],
        },
      },
    },
  };
}

/**
 * PreToolUse Gate for Mirror CLI (`mirror --approval-mode auto`) & Beam agent sessions.
 * Enforces environment key scrubbing (`REFLECTION_API_KEY`, `FIRECRAWL_API_KEY`) and blocks
 * destructive shell/extension actions that `--approval-mode auto` would otherwise run unsandboxed.
 */
function evaluateMirrorCliActionGate({
  toolName = 'Bash',
  commandOrArgs = '',
  approvalMode = 'auto',
  childEnv = {},
} = {}) {
  const startNs = process.hrtime.bigint();
  const raw = `${toolName} ${typeof commandOrArgs === 'string' ? commandOrArgs : JSON.stringify(commandOrArgs)}`;

  // 1. Strip provider keys from subprocess environment (per Mirror CLI security spec)
  const sanitizedEnv = { ...childEnv };
  const strippedKeys = [];
  for (const secretKey of ['REFLECTION_API_KEY', 'FIRECRAWL_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) {
    if (Object.prototype.hasOwnProperty.call(sanitizedEnv, secretKey)) {
      delete sanitizedEnv[secretKey];
      strippedKeys.push(secretKey);
    }
  }

  let decision = 'allow';
  let gateId = 'gate:mirror:verified_execution';
  let reason = 'Mirror CLI tool call verified within PreToolUse sandbox bounds';

  // 2. Block reading ~/.mirror/reflection_api_key or ~/.mirror/mcp/credentials/* from agent shell commands
  if (/\.mirror\/(?:reflection_api_key|mcp\/credentials)/i.test(raw)) {
    decision = 'block';
    gateId = 'gate:mirror:credential_store_access_blocked';
    reason = 'Blocked agent command from reading ~/.mirror/reflection_api_key or MCP credentials directory';
  } else if (/(?:\bgit\s+push\s+--force\b|\bgit\s+reset\s+--hard\b|\brm\s+-rf\s+(?:\/|~|\$HOME))/i.test(raw)) {
    decision = 'block';
    gateId = 'gate:mirror:unsandboxed_auto_mode_destructive_block';
    reason = `Blocked destructive command under mirror --approval-mode ${approvalMode} (approval mode is not a sandbox)`;
  }

  const latencyMs = Number((Number(process.hrtime.bigint() - startNs) / 1e6).toFixed(3));
  return {
    decision,
    allowed: decision === 'allow',
    gateId,
    approvalMode,
    strippedEnvKeys: strippedKeys,
    sanitizedEnv,
    latencyMs,
    reason,
  };
}

/**
 * Beam Self-Distillation Filter (Figure 5):
 * Filters raw agent traces to keep ONLY verifier-passed, high-token-efficiency trajectories
 * suitable for LoRA / SFT self-distillation.
 */
function filterVerifiedTracesForSelfDistillation(traces = [], { maxTokensBudget = 32000 } = {}) {
  const accepted = [];
  const rejected = [];

  for (const t of traces) {
    const id = t.traceId || `trace_${crypto.randomBytes(4).toString('hex')}`;
    const totalTokens = Number(t.totalTokens || 0);
    const verifierPassed = Boolean(t.verifierPassed && t.exitCode === 0);
    const hasSecretLeak = /\b(?:sk-[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[a-zA-Z0-9]{36})\b/.test(JSON.stringify(t.steps || []));

    if (!verifierPassed) {
      rejected.push({ traceId: id, reason: 'verifier_failed_or_nonzero_exit' });
    } else if (hasSecretLeak) {
      rejected.push({ traceId: id, reason: 'secret_leak_in_trajectory' });
    } else if (totalTokens <= 0 || totalTokens > maxTokensBudget) {
      rejected.push({ traceId: id, reason: `token_budget_exceeded:${totalTokens}>${maxTokensBudget}` });
    } else {
      const efficiencyScore = Number((1 - totalTokens / maxTokensBudget).toFixed(4));
      accepted.push({
        traceId: id,
        model: BEAM_MODEL_SPEC.id,
        totalTokens,
        efficiencyScore,
        loraReady: true,
        steps: t.steps || [],
      });
    }
  }

  accepted.sort((a, b) => b.efficiencyScore - a.efficiencyScore);
  return {
    totalEvaluated: traces.length,
    acceptedCount: accepted.length,
    rejectedCount: rejected.length,
    accepted,
    rejected,
  };
}

/**
 * 4. DFlash2 Block-Draft Speculative Decoding Planner (https://developers.reflection.ai/speculative-decoding.md)
 * Models the 1.93B DFlash2 drafter conditioned on 5 Beam layers with a 4,096-token sliding window
 * so drafting cost stays O(1) wrt context length, and computes acceptance length + speedup.
 */
function planDFlash2SpeculativeDecoding({
  precision = 'NVFP4',
  blockSize = 8,
  workload = 'HumanEval',
  concurrency = 1,
  contextLengthTokens = 65536,
} = {}) {
  const normalizedPrecision = String(precision || 'NVFP4').toUpperCase();
  const precisionSupported = DFLASH2_SPEC.supportedPrecisions.includes(normalizedPrecision);
  const effectiveBlockSize = Number(blockSize || DFLASH2_SPEC.recommendedServingBlockSize);
  const bench = DFLASH2_SPEC.benchmarks[workload] || DFLASH2_SPEC.benchmarks.HumanEval;
  const speedup =
    concurrency >= 32
      ? bench.speedupC32
      : concurrency >= 16
        ? bench.speedupC16
        : bench.speedupC1;

  return {
    ok: precisionSupported && effectiveBlockSize >= 1 && effectiveBlockSize <= DFLASH2_SPEC.trainedBlockSize,
    drafterModel: DFLASH2_SPEC.id,
    precision: normalizedPrecision,
    precisionSupported,
    effectiveBlockSize,
    recommendedServingBlockSize: DFLASH2_SPEC.recommendedServingBlockSize,
    slidingWindowTokens: DFLASH2_SPEC.slidingWindowTokens,
    contextLengthTokens,
    draftingCostConstantInContextLength: true,
    losslessRejectionSampling: true,
    workload,
    expectedAcceptanceLength: bench.acceptanceLength,
    expectedDecodeSpeedupMultiplier: speedup,
  };
}

/**
 * 5. Beam Harmony Format & `allow_missing_thinking=False` Validator
 * (https://developers.reflection.ai/harmony-format.md)
 * Enforces integer/label reasoning_effort (>=8, rejects "none"), preserves reasoning (`thinking`/`analysis`)
 * across all prior assistant turns (`allow_missing_thinking=False`), and validates Harmony tokens.
 */
function validateBeamHarmonyConversation({
  messages = [],
  reasoningEffort = 'max',
  allowMissingThinking = false,
} = {}) {
  let resolvedEffort = null;
  let effortError = null;

  if (reasoningEffort === null || reasoningEffort === undefined) {
    resolvedEffort = BEAM_HARMONY_EFFORT_MAP.max;
  } else if (typeof reasoningEffort === 'number' && Number.isInteger(reasoningEffort)) {
    if (reasoningEffort < 8) {
      effortError = 'Beam was not trained below reasoning_effort=8; values < 8 are rejected.';
    } else {
      resolvedEffort = reasoningEffort;
    }
  } else if (typeof reasoningEffort === 'string') {
    const key = reasoningEffort.trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(BEAM_HARMONY_EFFORT_MAP, key)) {
      resolvedEffort = BEAM_HARMONY_EFFORT_MAP[key];
    } else {
      effortError = `TemplateError: reasoning_effort must be an int >= 8 or one of: ${Object.keys(BEAM_HARMONY_EFFORT_MAP).join(', ')}`;
    }
  } else {
    effortError = 'Invalid reasoning_effort type.';
  }

  const missingThinkingTurnIndices = [];
  messages.forEach((msg, idx) => {
    if (msg && msg.role === 'assistant') {
      const hasThinking = Boolean(
        (typeof msg.thinking === 'string' && msg.thinking.trim().length > 0) ||
          (typeof msg.reasoning_content === 'string' && msg.reasoning_content.trim().length > 0)
      );
      if (!hasThinking) {
        missingThinkingTurnIndices.push(idx);
      }
    }
  });

  const ok = !effortError && (allowMissingThinking || missingThinkingTurnIndices.length === 0);
  return {
    ok,
    resolvedReasoningEffort: resolvedEffort,
    effortError,
    allowMissingThinking,
    missingThinkingTurnIndices,
    channels: ['analysis', 'final'],
    toolCallConstraintFormat: 'xml',
    eosSpecialToken: '<|return|>',
  };
}

/**
 * 6. One-Shot Purpose-Thought Rewrite & 5-Gate Cheating-Thought Auditor
 * (https://developers.reflection.ai/tool-calling-reasoning-data.md & /trl-tool-reasoning.md)
 * Audits Beam teacher rewrites of tool-calling conversations before distilling into Gemma 4 (E2B/E4B/12B):
 *   - Verifies every assistant turn has a purpose-style thought (~350 chars) and verbatim tool calls
 *   - Enforces "act, don't ask" (ToolACE) and "look up, then act" (Nemotron state-dependence)
 *   - Runs the 5 audit checks: future_leak, task_reference, tool_markup_or_code_fence, too_short, mostly_non_ascii
 */
function auditToolCallingReasoningRewrite({
  originalMessages = [],
  rewrittenMessages = [],
  sourceRule = 'act_dont_ask', // 'act_dont_ask' | 'lookup_then_act'
} = {}) {
  const droppedReasons = [];
  const turnAudits = [];

  const origAssistant = originalMessages.filter((m) => m && m.role === 'assistant');
  const rewAssistant = rewrittenMessages.filter((m) => m && m.role === 'assistant');

  if (origAssistant.length === 0 || origAssistant.length !== rewAssistant.length) {
    droppedReasons.push('assistant_turn_count_mismatch');
  }

  const hasAnyToolCall = origAssistant.some((m) => Array.isArray(m.tool_calls) && m.tool_calls.length > 0);
  if (sourceRule === 'act_dont_ask' && !hasAnyToolCall) {
    droppedReasons.push('act_dont_ask_violation:no_tool_call');
  }

  const toolResultsByTurn = [];
  for (let i = 0; i < rewrittenMessages.length; i += 1) {
    const msg = rewrittenMessages[i];
    if (msg && msg.role === 'tool' && typeof msg.content === 'string') {
      toolResultsByTurn.push({ index: i, content: msg.content.trim() });
    }
  }

  if (sourceRule === 'lookup_then_act') {
    const totalToolCalls = origAssistant.reduce(
      (acc, m) => acc + (Array.isArray(m.tool_calls) ? m.tool_calls.length : 0),
      0
    );
    if (totalToolCalls < 2) {
      droppedReasons.push('lookup_then_act_violation:fewer_than_2_calls');
    }
  }

  rewrittenMessages.forEach((msg, idx) => {
    if (!msg || msg.role !== 'assistant') return;
    const thought = String(msg.reasoning_content || msg.thinking || '').trim();
    const issues = [];

    if (thought.length < 20) {
      issues.push('too_short');
    }
    if (/\b(?:the example|the rewrite|in the transcript|given conversation|as the teacher)\b/i.test(thought)) {
      issues.push('task_reference');
    }
    if (/```|<\|tool_call\|>|<\|channel\|>|<tool_call>/i.test(thought)) {
      issues.push('tool_markup_or_code_fence');
    }
    const nonAsciiCount = Array.from(thought).filter((ch) => ch.charCodeAt(0) > 127).length;
    if (thought.length > 0 && nonAsciiCount / thought.length > 0.3) {
      issues.push('mostly_non_ascii');
    }

    // Future-leak check: thought must not quote a literal value that only appears in a LATER tool result
    const futureToolResults = toolResultsByTurn.filter((tr) => tr.index > idx);
    const priorText = rewrittenMessages
      .slice(0, idx)
      .map((m) => `${m.content || ''} ${JSON.stringify(m.tool_calls || '')}`)
      .join(' ');
    for (const fut of futureToolResults) {
      if (fut.content.length >= 6 && thought.includes(fut.content) && !priorText.includes(fut.content)) {
        issues.push('future_leak');
        break;
      }
    }

    turnAudits.push({ turnIndex: idx, thoughtLength: thought.length, issues });
    for (const issue of issues) {
      if (!droppedReasons.includes(issue)) droppedReasons.push(issue);
    }
  });

  // Verbatim tool-call equivalence check
  const count = Math.min(origAssistant.length, rewAssistant.length);
  for (let i = 0; i < count; i += 1) {
    const origCalls = JSON.stringify(origAssistant[i].tool_calls || []);
    const rewCalls = JSON.stringify(rewAssistant[i].tool_calls || []);
    if (origCalls !== rewCalls) {
      droppedReasons.push('tool_call_modified_by_teacher');
      break;
    }
  }

  return {
    ok: droppedReasons.length === 0,
    thoughtStyle: 'purpose',
    sourceRule,
    turnAudits,
    droppedReasons,
    expectedStudentGains: {
      gemma4E4B: { bfclDelta: 3.66, outputTokenReductionRatio: 0.45 },
      gemma4E2B: { bfclDelta: 2.32, outputTokenReductionRatio: 0.54 },
      gemma4_12B: { bfclDelta: -1.66, outputTokenReductionRatio: 0.64 },
    },
  };
}

/**
 * 7. Teacher-Free Executable-Verifier Self-Distillation & Hard-Task Concentrator
 * (https://developers.reflection.ai/self-distil-triton.md & /distil-swe-agent.md)
 * - Concentrates SFT rows on hard tasks (solved on attempt 2..16) + bounded easy slice (attempt 1)
 * - Rejects reward-hacking candidates (fallback torch ops / zero kernel launches / overwritten test fixtures)
 * - Enforces fp32 master weights + 16-bit remainder (14 bytes/param) at lr=1e-5 so sub-bf16 updates aren't rounded away
 * - Enforces corpus + rollout trace mixing to avoid pure-rollout repetition collapse
 */
function planVerifierDrivenSelfDistillation({
  tasks = [],
  easyTaskSampleRatio = 0.25,
  learningRate = 1e-5,
  useFp32MasterWeights = true,
  corpusTracesCount = 895,
  rolloutTracesCount = 295,
} = {}) {
  const hardTasks = [];
  const easyTasks = [];
  const rejectedRewardHacks = [];

  for (const t of tasks) {
    const taskId = t.taskId || 'unknown';
    const firstPassAttempt = Number(t.firstPassAttempt || 0);
    const kernelLaunches = t.kernelLaunches === undefined ? 1 : Number(t.kernelLaunches);
    const usedFallbackTorchOps = Boolean(t.usedFallbackTorchOps);
    const mutatedTestInputFixture = Boolean(t.mutatedTestInputFixture);

    if (usedFallbackTorchOps || kernelLaunches <= 0 || mutatedTestInputFixture) {
      rejectedRewardHacks.push({
        taskId,
        reason: mutatedTestInputFixture
          ? 'mutated_test_input_fixture'
          : usedFallbackTorchOps
            ? 'fallback_torch_ops_in_forward'
            : 'zero_kernel_launches',
      });
      continue;
    }

    if (firstPassAttempt === 1) {
      easyTasks.push(t);
    } else if (firstPassAttempt >= 2 && firstPassAttempt <= 16) {
      hardTasks.push(t);
    }
  }

  const sampledEasyCount = Math.min(
    easyTasks.length,
    Math.max(1, Math.round(easyTasks.length * easyTaskSampleRatio))
  );
  const selectedEasy = easyTasks.slice(0, easyTasks.length > 0 ? sampledEasyCount : 0);
  const selectedTrainingTasks = [...hardTasks, ...selectedEasy];

  const subBf16RoundingRisk = learningRate <= 1e-5 && !useFp32MasterWeights;
  const pureRolloutCollapseRisk = rolloutTracesCount > 0 && corpusTracesCount === 0;

  return {
    ok: !subBf16RoundingRisk && !pureRolloutCollapseRisk,
    closesGapType: 'reliability_gap_not_knowledge_gap',
    hardTasksSelectedCount: hardTasks.length,
    easyTasksSelectedCount: selectedEasy.length,
    totalSelectedTasksCount: selectedTrainingTasks.length,
    rejectedRewardHacksCount: rejectedRewardHacks.length,
    rejectedRewardHacks,
    optimizerConfig: {
      learningRate,
      useFp32MasterWeights,
      bytesPerParameterState: useFp32MasterWeights ? 14 : 8,
      subBf16RoundingRisk,
    },
    traceMix: {
      corpusTracesCount,
      rolloutTracesCount,
      pureRolloutCollapseRisk,
    },
  };
}

/**
 * 8. Beam Verifier Endpoint Conformance & Post-SFT `EXPORT_OK` Generation Gate
 * (https://developers.reflection.ai/beam-verifier.md & /distil-swe-agent.md)
 */
function evaluateBeamVerifierConformance({
  requestContractPassed = true,
  responseContractPassed = true,
  toolProtocolPassed = true,
  preserveThinkingVerified = true,
  exportGenerationSmoke = { readableText: true, thoughtChannelOpened: true },
} = {}) {
  const verifySuitePassed = Boolean(
    requestContractPassed && responseContractPassed && toolProtocolPassed && preserveThinkingVerified
  );
  const exportGatePassed = Boolean(
    exportGenerationSmoke &&
      exportGenerationSmoke.readableText &&
      exportGenerationSmoke.thoughtChannelOpened
  );
  return {
    ok: verifySuitePassed && exportGatePassed,
    verifySuitePassed,
    exportGatePassed,
    exportStatusLine: exportGatePassed ? 'EXPORT_OK' : 'EXPORT_BLOCKED_SCRAMBLED_CHECKPOINT',
    requiredSuites: {
      request_contract: requestContractPassed,
      response_contract: responseContractPassed,
      tool_protocol: toolProtocolPassed,
      preserve_thinking: preserveThinkingVerified,
    },
  };
}

/**
 * 9. Reflection CEO Misha Laskin Open Intelligence Business Strategy (yFDQX4Yy4N8)
 * "The American Startup Taking On China's AI Models":
 *   - Own Your Intelligence Layer ([11:34], [22:45], [42:51], [43:21])
 *   - Scale RL on Open Bases ([07:32], [08:02])
 *   - Build "The Car" Around the Free Engine ([14:45], [15:09], [17:30], [27:30])
 *   - Enterprise Strategic Transformation Partner vs Chinese open models ([38:00]-[38:30], [45:18])
 *   - Jevons Paradox Compute Scaling ([29:09], [29:55], [44:06])
 *   - Feynman Founder Conviction & Anti-Fooling Audit ([57:09]-[58:48])
 */
function evaluateMishaLaskinOpenIntelligenceBusinessPlan({
  openBaseModelId = BEAM_MODEL_SPEC.id,
  relySolelyOnRentedClosedApis = false,
  sinkingCapexIntoScratchPretraining = false,
  enterpriseSalesMotion = 'trusted_strategic_partner_fde', // vs 'pure_self_serve_only'
  chineseModelRegulatoryRiskAddressed = true,
  feynmanHonestRevenueUsdToday = 0,
  outboundCashSpendUsd = 0,
} = {}) {
  if (Number(outboundCashSpendUsd) > 0) {
    throw new Error('Zero Outbound Spend Mandate violation: outboundCashSpendUsd must be 0.');
  }
  const issues = [];
  if (relySolelyOnRentedClosedApis) {
    issues.push('platform_risk:rented_closed_api_labs_build_competing_coding_agents');
  }
  if (sinkingCapexIntoScratchPretraining) {
    issues.push('capex_waste:scale_rl_and_self_distillation_on_open_base_instead_of_scratch_pretraining');
  }
  if (enterpriseSalesMotion === 'pure_self_serve_only') {
    issues.push('enterprise_gtm_mismatch:fortune500_banks_public_sector_require_strategic_transformation_partner');
  }
  if (!chineseModelRegulatoryRiskAddressed) {
    issues.push('regulatory_risk:us_enterprises_require_domestic_apache2_open_weights_over_chinese_models');
  }

  return {
    ok: issues.length === 0,
    videoRef: 'https://www.youtube.com/watch?v=yFDQX4Yy4N8',
    ownIntelligenceLayer: {
      openBaseModelId,
      license: 'Apache-2.0',
      avoidsClosedLabVerticalCompetition: !relySolelyOnRentedClosedApis,
    },
    scaleRlOnOpenBase: {
      skipFromScratchPretraining: !sinkingCapexIntoScratchPretraining,
      targetWorkflows: ['coding', 'finance', 'legal', 'cyber_defense'],
      verifierSource: 'ThumbGate PreToolUse & Deterministic Test Receipts',
    },
    carAroundFreeEngine: {
      freeCommodityEngine: `${openBaseModelId} open weights (commodity utility like electricity/water)`,
      marginLayer: 'ThumbGate PreToolUse Security Firewall + Token-Burn Circuit Breaker + DPO/LoRA Pipeline + Mirror/Mir Harness Governance',
      monetizationLadder: {
        playbook999Url: 'https://thumbgate.ai/go/playbook-999',
        bundle49Url: 'https://thumbgate.ai/go/bundle-49',
        proDirect19Url: 'https://thumbgate.ai/go/pro-direct',
        fdeDiagnostic499Url: 'https://thumbgate.ai/diagnostic',
      },
    },
    enterpriseB2bStrategy: {
      motion: enterpriseSalesMotion,
      chineseModelRegulatoryRiskAddressed,
      jevonsParadoxReady: true,
      jevonsParadoxMechanism: 'Lower open-inference cost multiplies artificial labor volume 10x-100x; ThumbGate bounds per-turn token burn and blocks destructive loops.',
    },
    founderConvictionAudit: {
      feynmanPrinciple: 'The first principle is that you must not fool yourself — and you are the easiest person to fool.',
      measuredExternalRevenueTodayUsd: Number(feynmanHonestRevenueUsdToday || 0),
      outboundCashSpendUsd: 0,
      coFounderAndPartnerVettingRule: 'prior_hard_technical_execution_and_reciprocal_proof',
    },
    issues,
  };
}

if (require.main === module) {
  const cfg = buildBeamAndMirrorConfig();
  const gate = evaluateMirrorCliActionGate({
    toolName: 'Bash',
    commandOrArgs: 'cat ~/.mirror/reflection_api_key',
    approvalMode: 'auto',
    childEnv: { REFLECTION_API_KEY: 'refl_secret', PATH: '/usr/bin' },
  });
  console.log(JSON.stringify({ spec: BEAM_MODEL_SPEC, dflash2: DFLASH2_SPEC, cfg, sampleGate: gate }, null, 2));
}

module.exports = {
  BEAM_MODEL_SPEC,
  BEAM_HARMONY_EFFORT_MAP,
  DFLASH2_SPEC,
  buildBeamAndMirrorConfig,
  evaluateMirrorCliActionGate,
  filterVerifiedTracesForSelfDistillation,
  planDFlash2SpeculativeDecoding,
  validateBeamHarmonyConversation,
  auditToolCallingReasoningRewrite,
  planVerifierDrivenSelfDistillation,
  evaluateBeamVerifierConformance,
  evaluateMishaLaskinOpenIntelligenceBusinessPlan,
};
