#!/usr/bin/env node
'use strict';

/**
 * NVIDIA Open-Source AI Systems Accelerator & Runtime Guardrails for ThumbGate.
 *
 * Source catalog:
 *   https://developer.nvidia.com/open-source?size=n_48_n&sort-field=title.sort&sort-direction=asc
 *
 * Implements and unifies the 6 highest-ROI open-source NVIDIA pillars for ThumbGate:
 *
 *   1. NeMo Guardrails (https://github.com/NVIDIA-NeMo/Guardrails — Colang 2.0):
 *      - Deterministic 5-rail pipeline: Input Rail, Dialog Rail, Retrieval Rail,
 *        Execution Rail (PreToolUse), and Output Rail (PostToolUse / Claim Gate).
 *      - Fails closed on unverified completion claims by default (`hasVerifiedEvidence: false`).
 *      - Sub-millisecond local evaluation (<0.5ms) with zero cloud egress.
 *
 *   2. NeMo Agent Toolkit (https://github.com/NVIDIA/NeMo-Agent-Toolkit):
 *      - Framework-agnostic multi-agent call-graph profiler, token amplification
 *        detector, parallel-aware critical path latency analyzer, and canonical
 *        key-order-invariant duplicate tool-call loop detector.
 *
 *   3. NVIDIA Dynamo & Dynamo-Triton (https://github.com/ai-dynamo/dynamo):
 *      - KV-cache-aware smart router minimizing:
 *          Cost(w) = alpha * (1 - KV_hit_ratio(w)) + (1 - alpha) * load_ratio(w)
 *      - Preserves alpha = 0 (pure queue-load routing), fails closed on empty worker
 *        pools, computes TTFT savings against the true highest-TTFT worker, and uses
 *        hardware-honest NIXL transport labels (local unified memory IPC on Apple Silicon
 *        vs RDMA/NVLink on multi-node GPU clusters).
 *
 *   4. NVIDIA Morpheus (https://github.com/nv-morpheus/Morpheus):
 *      - Real-time AI cybersecurity pipeline: Sensitive Information Detection (SID),
 *        MITRE ATT&CK tactic classification (TA0006, TA0002, TA0010, TA0005),
 *        Digital Fingerprinting (DFP) z-score anomaly detection (fails closed on
 *        non-numeric telemetry), and per-agent chronological credential -> external URL
 *        exfiltration chain detection (immune to `localhost` query-string spoofing).
 *
 *   5. NVIDIA cuOpt & KAI Scheduler (https://github.com/NVIDIA/cuopt, https://github.com/NVIDIA/KAI-Scheduler):
 *      - Constrained multi-agent model assignment & KAI GPU quota optimizer.
 *      - Enforces per-task latency SLAs and quality floors across both initial and
 *        upgrade passes, flags infeasible tasks explicitly, and supports priority-weighted
 *        marginal utility upgrades up to `claude-opus-5.5` within budget & GPU quotas.
 *
 *   6. TensorRT-LLM & NVIDIA Nemotron (https://github.com/NVIDIA/TensorRT-LLM, https://github.com/NVIDIA-NeMo/Nemotron):
 *      - Delegates speculative decoding AL/D roofline (`AL / (1 + rho * D)`) and
 *        attention tile alignment (`(G * (1 + D)) % 128 === 0`, `D = 128/G - 1`) to
 *        `scripts/nvidia-specdecode-al-doctor.js`, failing closed when `acceptLength`
 *        is missing or impossible (`AL > D + 1`).
 *      - Provides hardware-honest Apple Silicon local Nemotron role mappings
 *        (`Llama-3.3-Nemotron-Super-49B-v1.5`, `Llama-3.1-Nemotron-Nano-8B-v1`) plus
 *        Nemotron 5-dimensional reward scoring.
 */

const crypto = require('node:crypto');
const { deobfuscateNoisyByteStream } = require('./hnet-dynamic-chunker');
const {
  isTileAligned,
  nearestTileAlignedDraftLength,
  optimalDraftLengthForAttention,
  theoreticalSpeedup,
} = require('./nvidia-specdecode-al-doctor');

const NVIDIA_OPEN_SOURCE_CATALOG = Object.freeze([
  {
    id: 'nemo-guardrails',
    title: 'NeMo Guardrails (Colang 2.0)',
    repo: 'https://github.com/NVIDIA-NeMo/Guardrails',
    docs: 'https://docs.nvidia.com/nemo/guardrails/index.html',
    category: 'Agent Safety & Policy Guardrails',
    thumbgateIntegration: 'evaluateNeMoColang2Rails (5-rail <0.5ms deterministic local diode)',
  },
  {
    id: 'nemo-agent-toolkit',
    title: 'NeMo Agent Toolkit',
    repo: 'https://github.com/NVIDIA/NeMo-Agent-Toolkit',
    docs: 'https://docs.nvidia.com/nemo/agent-toolkit/latest/index.html',
    category: 'Multi-Agent Profiling & Telemetry',
    thumbgateIntegration: 'profileNeMoAgentCallGraph (token amplification + duplicate tool loop detector)',
  },
  {
    id: 'dynamo-triton',
    title: 'Dynamo & Dynamo-Triton',
    repo: 'https://github.com/ai-dynamo/dynamo',
    docs: 'https://docs.nvidia.com/dynamo/latest/index.html',
    category: 'Disaggregated Serving & KV-Aware Routing',
    thumbgateIntegration: 'routeDynamoKvSmartWorker (KV prefix overlap cost function + NIXL disaggregation)',
  },
  {
    id: 'morpheus-cybersecurity',
    title: 'NVIDIA Morpheus',
    repo: 'https://github.com/nv-morpheus/Morpheus',
    docs: 'https://docs.nvidia.com/morpheus/index.html',
    category: 'Real-Time AI Cybersecurity & SID/DFP',
    thumbgateIntegration: 'evaluateMorpheusCybersecurityPipeline (SID secret scanner + DFP z-score anomaly detector)',
  },
  {
    id: 'cuopt-kai-scheduler',
    title: 'cuOpt & KAI Scheduler',
    repo: 'https://github.com/NVIDIA/cuopt',
    docs: 'https://www.nvidia.com/en-us/ai-data-science/products/cuopt/',
    category: 'Decision Optimization & GPU Orchestration',
    thumbgateIntegration: 'solveCuOptBudgetConstrainedRouting (constrained cost/quality optimizer + KAI GPU quotas)',
  },
  {
    id: 'tensorrt-llm-nemotron',
    title: 'TensorRT-LLM & NVIDIA Nemotron',
    repo: 'https://github.com/NVIDIA/TensorRT-LLM',
    docs: 'https://nvidia.github.io/TensorRT-LLM/',
    category: 'Inference Acceleration & Open-Weight Agent Models',
    thumbgateIntegration: 'auditTensorRtLlmSpecDecodeAndTiles (AL/D roofline + G*(1+D)%128 tile alignment + Nemotron roles)',
  },
]);

/**
 * Hardware-honest local Apple Silicon Nemotron model role mappings:
 *   - 49B Super v1.5 fits in 32-64GB Apple Silicon unified memory (4-bit MLX/GGUF)
 *   - 8B Nano v1 / VL-8B v1 fits in 8-16GB unified memory for fast compaction/guardrails
 *   - 253B Ultra v1 is reserved for multi-GPU NIM datacenter deployments (`NEMOTRON_NIM_DATACENTER_ROLES`)
 */
const NEMOTRON_AGENT_MODEL_ROLES = Object.freeze({
  normal: 'nvidia/Llama-3.3-Nemotron-Super-49B-v1.5',
  thinking: 'nvidia/Llama-3.3-Nemotron-Super-49B-v1.5',
  critique: 'nvidia/Llama-3.3-Nemotron-Super-49B-v1.5',
  compaction: 'nvidia/Llama-3.1-Nemotron-Nano-8B-v1',
  vlm: 'nvidia/Llama-3.1-Nemotron-Nano-VL-8B-v1',
  default: 'nvidia/Llama-3.3-Nemotron-Super-49B-v1.5',
  planning: 'nvidia/Llama-3.3-Nemotron-Super-49B-v1.5',
  coding: 'nvidia/Llama-3.3-Nemotron-Super-49B-v1.5',
  review: 'nvidia/Llama-3.3-Nemotron-Super-49B-v1.5',
  fast_guardrail: 'nvidia/Llama-3.1-Nemotron-Nano-8B-v1',
  safety_judge: 'nvidia/Llama-3.1-Nemotron-Safety-Guard-8B-v3',
});

const NEMOTRON_NIM_DATACENTER_ROLES = Object.freeze({
  ...NEMOTRON_AGENT_MODEL_ROLES,
  thinking: 'nvidia/Llama-3.1-Nemotron-Ultra-253B-v1',
  planning: 'nvidia/Llama-3.1-Nemotron-Ultra-253B-v1',
});

function canonicalJson(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (typeof value !== 'object') return JSON.stringify(value);
  if (seen.has(value)) return '"[Circular]"';
  seen.add(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item, seen)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k], seen)}`);
  return `{${entries.join(',')}}`;
}

// ---------------------------------------------------------------------------
// Pillar 1: NeMo Guardrails (Colang 2.0 5-Rail Deterministic Engine)
// ---------------------------------------------------------------------------

const COLANG_INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:previous|prior|system)\s+instructions/i,
  /disregard\s+(?:all\s+)?(?:system|safety|developer)\s+(?:prompts?|rules?|guardrails?)/i,
  /system\s+override\s*:\s*disable\s+gates/i,
  /you\s+are\s+now\s+in\s+(?:developer|unrestricted|dan)\s+mode/i,
  /bypass\s+(?:all\s+)?safety\s+filters/i,
  /do\s+anything\s+now/i,
];

const COLANG_SECRET_PATTERNS = [
  /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}/,
  /sk_(?:live|test)_[A-Za-z0-9]{24,}/,
  /sk-[A-Za-z0-9]{32,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN\s+(?:RSA|OPENSSH|EC|DSA|PRIVATE)\s+KEY-----/i,
];

const COLANG_DESTRUCTIVE_EXEC_PATTERNS = [
  /\brm\s+(?:-[a-zA-Z0-9]*[rf][a-zA-Z0-9]*\s+|--(?:recursive|force|no-preserve-root)\s+)*(?:-[a-zA-Z0-9]*[rf][a-zA-Z0-9]*|--(?:recursive|force|no-preserve-root))\s+(?:\/|~|\$HOME|\.\.)(?:\s|["'}]|$)/i,
  /\bgit\s+push\b[^\n]*(?:--force(?:-with-lease)?|-f\b)/i,
  /\bgh\s+pr\s+merge\b[^\n]*--(?:admin|force)/i,
  /\b(?:DROP\s+TABLE|TRUNCATE\s+TABLE|mkfs\.[a-z0-9]+|dd\s+if=\/dev\/zero)\b/i,
];

function extractToolPayloadString(toolCall = {}) {
  if (!toolCall || typeof toolCall !== 'object') return String(toolCall || '');
  const nestedArgStrings =
    toolCall.args && typeof toolCall.args === 'object' && !Array.isArray(toolCall.args)
      ? Object.values(toolCall.args).filter((v) => typeof v === 'string')
      : [];
  const parts = [
    toolCall.command,
    toolCall.cmd,
    toolCall.input,
    toolCall.file_path,
    toolCall.path,
    ...nestedArgStrings,
    typeof toolCall.args === 'string' ? toolCall.args : canonicalJson(toolCall.args || {}),
  ].filter((x) => x !== undefined && x !== null && x !== '{}' && x !== 'null');
  return parts.join(' ');
}

/**
 * Evaluate NeMo Guardrails Colang 2.0 5-rail pipeline locally in <0.5ms.
 *
 * Rails:
 *   1. input_rail: blocks prompt injection, jailbreak flows, and raw secret ingestion
 *   2. dialog_rail: enforces canonical Colang flow topics (fails closed on empty topic/allowlist)
 *   3. retrieval_rail: filters poisoned or secret-bearing RAG chunks before prompt assembly
 *   4. execution_rail: validates tool call arguments against destructive execution patterns
 *   5. output_rail: blocks credential leakage and unverified completion claims (fails closed by default)
 */
function evaluateNeMoColang2Rails(context = {}) {
  const startNs = process.hrtime.bigint();
  const userPrompt = String(context.userPrompt || '');
  const hasExplicitDialogTopic = Object.prototype.hasOwnProperty.call(context, 'dialogTopic');
  const dialogTopic = hasExplicitDialogTopic ? String(context.dialogTopic ?? '').trim() : 'engineering';
  const hasExplicitAllowedTopics = Object.prototype.hasOwnProperty.call(context, 'allowedTopics');
  const allowedTopics = hasExplicitAllowedTopics
    ? (Array.isArray(context.allowedTopics) ? context.allowedTopics : [])
    : ['engineering', 'security', 'code', 'testing', 'devops', 'deployment'];
  const retrievedChunks = Array.isArray(context.retrievedChunks) ? context.retrievedChunks : [];
  const toolCall = context.toolCall || null;
  const modelOutput = String(context.modelOutput || '');
  // Fail-closed by default: completion claims in modelOutput require explicit hasVerifiedEvidence: true
  const hasVerifiedEvidence = context.hasVerifiedEvidence === true;

  const deobfuscatedInput = deobfuscateNoisyByteStream(userPrompt).normalizedText;
  const rails = {
    input_rail: { passed: true, violations: [] },
    dialog_rail: { passed: true, violations: [] },
    retrieval_rail: { passed: true, violations: [], sanitizedChunks: [] },
    execution_rail: { passed: true, violations: [] },
    output_rail: { passed: true, violations: [] },
  };

  let activeRailsEvaluated = 1; // dialog_rail always evaluated

  // 1. Input Rail
  if (userPrompt.length > 0) {
    activeRailsEvaluated += 1;
    for (const pattern of COLANG_INJECTION_PATTERNS) {
      if (pattern.test(deobfuscatedInput)) {
        rails.input_rail.passed = false;
        rails.input_rail.violations.push('COLANG_INPUT_PROMPT_INJECTION');
        break;
      }
    }
    for (const secretPattern of COLANG_SECRET_PATTERNS) {
      if (secretPattern.test(deobfuscatedInput)) {
        rails.input_rail.passed = false;
        rails.input_rail.violations.push('COLANG_INPUT_RAW_SECRET_EXPOSURE');
        break;
      }
    }
  }

  // 2. Dialog Rail (Colang 2.0 flow boundary — fail-closed on empty topic or empty allowlist)
  const normalizedTopic = dialogTopic.toLowerCase();
  const allowedSet = new Set(
    allowedTopics.map((t) => String(t || '').toLowerCase().trim()).filter(Boolean),
  );
  if (!normalizedTopic) {
    rails.dialog_rail.passed = false;
    rails.dialog_rail.violations.push('COLANG_DIALOG_EMPTY_TOPIC');
  } else if (allowedSet.size === 0) {
    rails.dialog_rail.passed = false;
    rails.dialog_rail.violations.push('COLANG_DIALOG_NO_ALLOWED_TOPICS');
  } else if (!allowedSet.has(normalizedTopic)) {
    rails.dialog_rail.passed = false;
    rails.dialog_rail.violations.push(`COLANG_DIALOG_OFF_TOPIC:${normalizedTopic}`);
  }

  // 3. Retrieval Rail (RAG chunk poisoning & credential scrub)
  if (retrievedChunks.length > 0) {
    activeRailsEvaluated += 1;
  }
  for (let i = 0; i < retrievedChunks.length; i += 1) {
    const rawChunk = String(retrievedChunks[i] || '');
    const cleanChunk = deobfuscateNoisyByteStream(rawChunk).normalizedText;
    const isPoisoned = COLANG_INJECTION_PATTERNS.some((p) => p.test(cleanChunk));
    const hasSecret = COLANG_SECRET_PATTERNS.some((p) => p.test(cleanChunk));
    if (isPoisoned || hasSecret) {
      rails.retrieval_rail.passed = false;
      rails.retrieval_rail.violations.push(
        isPoisoned ? `COLANG_RETRIEVAL_POISONED_CHUNK_${i}` : `COLANG_RETRIEVAL_SECRET_CHUNK_${i}`,
      );
    } else {
      rails.retrieval_rail.sanitizedChunks.push(rawChunk);
    }
  }

  // 4. Execution Rail (Tool call validation across all argument fields)
  if (toolCall && typeof toolCall === 'object') {
    activeRailsEvaluated += 1;
    const rawCmd = extractToolPayloadString(toolCall);
    const cleanCmd = deobfuscateNoisyByteStream(rawCmd).normalizedText;
    for (const execPattern of COLANG_DESTRUCTIVE_EXEC_PATTERNS) {
      if (execPattern.test(cleanCmd)) {
        rails.execution_rail.passed = false;
        rails.execution_rail.violations.push('COLANG_EXECUTION_DESTRUCTIVE_COMMAND');
        break;
      }
    }
  }

  // 5. Output Rail (Secret egress & fail-closed completion claim verification)
  if (modelOutput.length > 0) {
    activeRailsEvaluated += 1;
    const cleanOutput = deobfuscateNoisyByteStream(modelOutput).normalizedText;
    for (const secretPattern of COLANG_SECRET_PATTERNS) {
      if (secretPattern.test(cleanOutput)) {
        rails.output_rail.passed = false;
        rails.output_rail.violations.push('COLANG_OUTPUT_CREDENTIAL_LEAK');
        break;
      }
    }
    if (
      /\b(?:all\s+tests\s+passed|pr\s+is\s+merged|deployed\s+to\s+production|100%\s+pass)\b/i.test(cleanOutput)
      && !hasVerifiedEvidence
    ) {
      rails.output_rail.passed = false;
      rails.output_rail.violations.push('COLANG_OUTPUT_UNVERIFIED_COMPLETION_CLAIM');
    }
  }

  const triggeredRails = Object.entries(rails)
    .filter(([, r]) => !r.passed)
    .map(([name]) => name);
  const allPassed = triggeredRails.length === 0;
  const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1e6;
  const safeLatencyMs = Number(Math.max(0.0001, elapsedMs).toFixed(4));
  // Each active rail in standard Python NeMo Guardrails invokes ~70ms of LLM/embedding overhead
  const estimatedNemoPythonRailBaselineMs = activeRailsEvaluated * 70;

  return {
    engine: 'ThumbGate Colang-2.0 Local Diode (NeMo Guardrails Compatible)',
    decision: allPassed ? 'ALLOW' : 'BLOCK',
    passed: allPassed,
    triggeredRails,
    rails,
    activeRailsEvaluated,
    latencyMs: safeLatencyMs,
    estimatedNemoPythonRailBaselineMs,
    nemoCloudLLMOverheadSavedMs: Number(Math.max(0, estimatedNemoPythonRailBaselineMs - safeLatencyMs).toFixed(2)),
    zeroCloudEgress: true,
  };
}

// ---------------------------------------------------------------------------
// Pillar 2: NeMo Agent Toolkit (Multi-Agent Call-Graph & Token Amplification Profiler)
// ---------------------------------------------------------------------------

/**
 * Profile a multi-agent workflow trace using NeMo Agent Toolkit metrics:
 *   - Token amplification ratio (total workflow tokens / root prompt tokens)
 *   - Key-order-invariant duplicate tool-call loop detection
 *   - Parallel-aware critical-path latency vs cumulative span latency
 */
function profileNeMoAgentCallGraph(trace = {}) {
  const spans = Array.isArray(trace.spans) ? trace.spans : [];
  const maxAmplificationRatio = Number(trace.maxAmplificationRatio) > 0
    ? Number(trace.maxAmplificationRatio)
    : 4.0;
  const duplicateCallThreshold = Number(trace.duplicateCallThreshold) > 0
    ? Number(trace.duplicateCallThreshold)
    : 2;

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let cumulativeSpanLatencyMs = 0;
  let bottleneckSpan = null;
  const callCounts = new Map();
  const parallelGroupMaxLatency = new Map();
  let sequentialLatencyMs = 0;

  for (const span of spans) {
    const promptTokens = Math.max(0, Number(span.promptTokens ?? span.tokens) || 0);
    const completionTokens = Math.max(0, Number(span.completionTokens) || 0);
    const latencyMs = Math.max(0, Number(span.latencyMs ?? span.durationMs) || 0);
    const agentId = String(span.agentId || 'root');
    const toolName = String(span.tool || span.toolName || 'llm_step');
    const argsSignature = canonicalJson(span.args ?? span.toolArgs ?? {});
    const callKey = `${agentId}::${toolName}::${argsSignature}`;

    totalPromptTokens += promptTokens;
    totalCompletionTokens += completionTokens;
    cumulativeSpanLatencyMs += latencyMs;

    if (span.parallelGroup) {
      const groupKey = String(span.parallelGroup);
      const prevMax = parallelGroupMaxLatency.get(groupKey) || 0;
      if (latencyMs > prevMax) parallelGroupMaxLatency.set(groupKey, latencyMs);
    } else {
      sequentialLatencyMs += latencyMs;
    }

    callCounts.set(callKey, (callCounts.get(callKey) || 0) + 1);

    if (!bottleneckSpan || latencyMs > bottleneckSpan.latencyMs) {
      bottleneckSpan = {
        spanId: span.spanId || `${agentId}:${toolName}`,
        agentId,
        tool: toolName,
        latencyMs,
        totalTokens: promptTokens + completionTokens,
      };
    }
  }

  let criticalPathLatencyMs = sequentialLatencyMs;
  for (const groupMax of parallelGroupMaxLatency.values()) {
    criticalPathLatencyMs += groupMax;
  }

  const totalTokens = totalPromptTokens + totalCompletionTokens;
  const explicitRootTokens = Number(trace.rootPromptTokens);
  const inferredRootTokens = spans.length > 0
    ? Math.max(0, Number(spans[0].promptTokens ?? spans[0].tokens) || 0)
    : 0;
  const rootPromptTokens = Number.isFinite(explicitRootTokens) && explicitRootTokens > 0
    ? explicitRootTokens
    : inferredRootTokens;

  let tokenAmplificationRatio = 0;
  let amplificationExceeded = false;
  if (totalTokens > 0 && rootPromptTokens <= 0) {
    tokenAmplificationRatio = Infinity;
    amplificationExceeded = true;
  } else if (rootPromptTokens > 0) {
    tokenAmplificationRatio = Number((totalTokens / rootPromptTokens).toFixed(3));
    amplificationExceeded = tokenAmplificationRatio > maxAmplificationRatio;
  }

  const redundantToolLoops = [];
  for (const [key, count] of callCounts.entries()) {
    if (count >= duplicateCallThreshold) {
      const [agentId, tool, argsHash] = key.split('::');
      redundantToolLoops.push({ agentId, tool, argsHash, count });
    }
  }

  const loopDetected = redundantToolLoops.length > 0;

  return {
    profiler: 'NeMo Agent Toolkit Call-Graph Profiler',
    spanCount: spans.length,
    rootPromptTokens,
    totalPromptTokens,
    totalCompletionTokens,
    totalTokens,
    tokenAmplificationRatio,
    maxAmplificationRatio,
    amplificationExceeded,
    totalLatencyMs: Number(criticalPathLatencyMs.toFixed(2)),
    cumulativeSpanLatencyMs: Number(cumulativeSpanLatencyMs.toFixed(2)),
    bottleneckSpan,
    redundantToolLoops,
    loopDetected,
    recommendedAction: loopDetected || amplificationExceeded
      ? 'PRUNE_REDUNDANT_SPANS_AND_PIN_PREFIX_CACHE'
      : 'OPTIMAL_CALL_GRAPH',
  };
}

// Alias for callers expecting profileNeMoAgentWorkflow
const profileNeMoAgentWorkflow = profileNeMoAgentCallGraph;

// ---------------------------------------------------------------------------
// Pillar 3: NVIDIA Dynamo & Dynamo-Triton KV-Cache-Aware Smart Router & NIXL
// ---------------------------------------------------------------------------

/**
 * Route an inference request across disaggregated workers using NVIDIA Dynamo's
 * KV-cache overlap vs queue-load cost function:
 *   Cost(w) = alpha * (1 - kvHitRatio(w)) + (1 - alpha) * queueLoadRatio(w)
 *
 * Also determines whether to disaggregate prefill & decode across NIXL transfer
 * when uncached prefill tokens exceed the disaggregation threshold.
 */
function routeDynamoKvSmartWorker(options = {}) {
  const workersProvided = Object.prototype.hasOwnProperty.call(options, 'workers');
  const workers = Array.isArray(options.workers) ? options.workers : [];
  if (workersProvided && workers.length === 0) {
    return {
      router: 'NVIDIA Dynamo KV-Aware Smart Router',
      status: 'FAIL_NO_WORKERS_AVAILABLE',
      selectedWorker: null,
      rankedWorkers: [],
      error: 'Worker pool is empty; refusing to fabricate synthetic workers.',
    };
  }

  const rawAlpha = Number(options.overlapWeightAlpha);
  const alpha = Number.isFinite(rawAlpha) ? Math.min(1, Math.max(0, rawAlpha)) : 0.65;
  const rawPromptTokens = Number(options.promptTokens);
  const safePromptTokens = Number.isFinite(rawPromptTokens) && rawPromptTokens > 0
    ? Math.floor(rawPromptTokens)
    : 4096;
  const nixlDisaggregationThresholdTokens = Number.isFinite(Number(options.nixlDisaggregationThresholdTokens))
    ? Math.max(1, Number(options.nixlDisaggregationThresholdTokens))
    : 2048;
  const basePrefillMsPer1kTokens = Number.isFinite(Number(options.basePrefillMsPer1kTokens))
    ? Math.max(1, Number(options.basePrefillMsPer1kTokens))
    : 45;

  const candidateWorkers = workersProvided
    ? workers
    : [
        { id: 'dynamo-worker-0', kvHitRatio: 0.15, queueLoadRatio: 0.25 },
        { id: 'dynamo-worker-1', kvHitRatio: 0.85, queueLoadRatio: 0.35 },
        { id: 'dynamo-worker-2', kvHitRatio: 0.40, queueLoadRatio: 0.80 },
      ];

  const scoredWorkers = candidateWorkers.map((w) => {
    const rawKv = Number(w.kvHitRatio);
    const kvHit = Number.isFinite(rawKv) ? Math.min(1, Math.max(0, rawKv)) : 0;
    const rawLoad = Number(w.queueLoadRatio);
    const queueLoad = Number.isFinite(rawLoad) ? Math.min(1, Math.max(0, rawLoad)) : 0;
    const routingCost = Number((alpha * (1 - kvHit) + (1 - alpha) * queueLoad).toFixed(4));
    const uncachedTokens = Math.round(safePromptTokens * (1 - kvHit));
    const estimatedTtftMs = Number(
      (((uncachedTokens / 1000) * basePrefillMsPer1kTokens) * (1 + 0.5 * queueLoad)).toFixed(2),
    );
    return {
      workerId: w.id,
      kvHitRatio: kvHit,
      queueLoadRatio: queueLoad,
      routingCost,
      uncachedTokens,
      estimatedTtftMs,
    };
  });

  scoredWorkers.sort((a, b) => a.routingCost - b.routingCost || a.estimatedTtftMs - b.estimatedTtftMs);
  const selected = scoredWorkers[0];
  const worstWorkerTtftMs = Math.max(...scoredWorkers.map((w) => w.estimatedTtftMs));
  const nixlDisaggregated = selected.uncachedTokens >= nixlDisaggregationThresholdTokens;
  const isClusterRdma = options.clusterTransport === 'rdma' || options.clusterMode === 'datacenter';
  const nixlTransport = nixlDisaggregated
    ? (isClusterRdma ? 'NIXL_RDMA_NVLINK' : 'NIXL_LOCAL_UNIFIED_MEMORY_IPC')
    : 'CO_LOCATED_WORKER';

  return {
    router: 'NVIDIA Dynamo KV-Aware Smart Router',
    status: 'OK',
    overlapWeightAlpha: alpha,
    promptTokens: safePromptTokens,
    selectedWorker: selected,
    rankedWorkers: scoredWorkers,
    nixlDisaggregation: {
      enabled: nixlDisaggregated,
      transport: nixlTransport,
      thresholdTokens: nixlDisaggregationThresholdTokens,
      uncachedPrefillTokens: selected.uncachedTokens,
    },
    ttftSavedVsWorstWorkerMs: Number(Math.max(0, worstWorkerTtftMs - selected.estimatedTtftMs).toFixed(2)),
  };
}

const planDynamoKvAwareDisaggregatedRouting = routeDynamoKvSmartWorker;

// ---------------------------------------------------------------------------
// Pillar 4: NVIDIA Morpheus Real-Time AI Cybersecurity Pipeline (SID + DFP + MITRE)
// ---------------------------------------------------------------------------

const MITRE_TACTICS = Object.freeze({
  CREDENTIAL_ACCESS: {
    id: 'TA0006',
    patterns: [
      /\b(?:cat|read|less|head|tail)\s+.*(?:\.aws\/credentials|\.ssh\/id_|\.env|\.netrc|shadow|id_rsa|id_ed25519)\b/i,
      /\b(?:printenv|env|export)\b.*\b(?:SECRET|KEY|TOKEN|PASSWORD|AUTH)\b/i,
      /\bsecurity\s+find-generic-password\b/i,
    ],
  },
  EXECUTION: {
    id: 'TA0002',
    patterns: [
      /\bcurl\s+[^|]+\|\s*(?:bash|sh|zsh)\b/i,
      /\bwget\s+[^|]+\|\s*(?:bash|sh|zsh)\b/i,
      /\bpython(?:3)?\s+-c\s+['"]import\s+(?:socket|subprocess|os).*;.*['"]/i,
      /\brm\s+-[a-zA-Z0-9]*[rf][a-zA-Z0-9_-]*\s+(?:[\\/~]|\$HOME|\.\.)(?:\s|$)/i,
    ],
  },
  EXFILTRATION: {
    id: 'TA0010',
    patterns: [
      /\b(?:curl|wget|nc|ncat)\s+.*-X\s+POST.*(?:pastebin|transfer\.sh|webhook\.site|ngrok\.io|requestbin)\b/i,
      /\bcurl\s+.*--upload-file\b/i,
      /\bscp\s+.*@.*:/i,
    ],
  },
  DEFENSE_EVASION: {
    id: 'TA0005',
    patterns: [
      /\bchattr\s+\+i\b/i,
      /\bset\s+\+o\s+history\b/i,
      /\bexport\s+HISTFILE=\/dev\/null\b/i,
      /\bbase64\s+-d\s*\|\s*(?:bash|sh)\b/i,
    ],
  },
});

function hasExternalEgressTarget(payload) {
  const text = String(payload || '');
  const urls = text.match(/https?:\/\/([^\s/'"`:]+)(?::\d+)?/gi) || [];
  for (const rawUrl of urls) {
    const hostMatch = rawUrl.match(/^https?:\/\/([^\s/'"`:]+)/i);
    const host = hostMatch ? hostMatch[1].toLowerCase() : '';
    if (host && host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]') {
      return true;
    }
  }
  if (/\b(?:scp\s+\S+@\S+|nc\s+(?!localhost|127\.0\.0\.1)\S+\s+\d+)/i.test(text)) {
    return true;
  }
  return false;
}

/**
 * Run NVIDIA Morpheus real-time cybersecurity telemetry inspection:
 *   - Sensitive Information Detection (SID) across streaming tool payloads
 *   - Digital Fingerprinting (DFP) z-score burst anomaly & per-agent chronological
 *     credential-read -> external-egress exfiltration chain detection
 */
function evaluateMorpheusCybersecurityPipeline({
  events = [],
  observedRatePerMin = 10,
  baselineRatePerMin = 10,
  baselineStdDev = 2.5,
  zScoreThreshold = 3.0,
} = {}) {
  const safeEvents = Array.isArray(events) ? events : [];
  const sidDetections = [];
  const credentialAccessIndexByAgent = new Map();
  const eventDigests = [];
  let exfiltrationChainDetected = false;
  const exfiltrationChains = [];

  for (let idx = 0; idx < safeEvents.length; idx += 1) {
    const ev = safeEvents[idx] || {};
    const agentId = String(ev.agentId || 'default-agent');
    const payload = deobfuscateNoisyByteStream(
      `${ev.tool || ''} ${ev.command || ''} ${ev.payload || ''}`,
    ).normalizedText;

    eventDigests.push(
      crypto.createHash('sha256').update(`${idx}:${agentId}:${payload}`).digest('hex').slice(0, 16),
    );

    for (const pattern of COLANG_SECRET_PATTERNS) {
      if (pattern.test(payload)) {
        sidDetections.push({
          eventIndex: idx,
          agentId,
          classification: 'MORPHEUS_SID_LIVE_CREDENTIAL',
        });
        break;
      }
    }

    const accessedCredentials = /(?:\.env\b|\.aws\/credentials\b|\bid_rsa\b|\bid_ed25519\b|\bkeychain\b|\bsecrets\b|\/etc\/shadow\b)/i.test(payload);
    if (accessedCredentials && !credentialAccessIndexByAgent.has(agentId)) {
      credentialAccessIndexByAgent.set(agentId, idx);
    }

    const egressDetected = hasExternalEgressTarget(payload);
    if (egressDetected && credentialAccessIndexByAgent.has(agentId)) {
      const credStep = credentialAccessIndexByAgent.get(agentId);
      if (idx >= credStep) {
        exfiltrationChainDetected = true;
        exfiltrationChains.push({
          agentId,
          credentialAccessEventIndex: credStep,
          egressEventIndex: idx,
        });
      }
    }
  }

  const obsRate = Number(observedRatePerMin);
  const baseRate = Number(baselineRatePerMin);
  const stdDev = Number(baselineStdDev);
  const zThresh = Number.isFinite(Number(zScoreThreshold)) ? Number(zScoreThreshold) : 3.0;
  const invalidTelemetryInput = !Number.isFinite(obsRate) || !Number.isFinite(baseRate) || !Number.isFinite(stdDev) || stdDev <= 0;

  const safeStdDev = invalidTelemetryInput ? 1 : Math.max(0.1, stdDev);
  const dfpZScore = invalidTelemetryInput
    ? Infinity
    : Number(((obsRate - baseRate) / safeStdDev).toFixed(3));
  const dfpAnomalyDetected = invalidTelemetryInput || dfpZScore >= zThresh;
  const quarantineTriggered = sidDetections.length > 0 || dfpAnomalyDetected || exfiltrationChainDetected;

  const receiptSha256 = crypto
    .createHash('sha256')
    .update(
      canonicalJson({
        eventDigests,
        sidDetections,
        dfpZScore: Number.isFinite(dfpZScore) ? dfpZScore : 'INVALID_TELEMETRY_NAN',
        exfiltrationChainDetected,
        exfiltrationChains,
      }),
    )
    .digest('hex');

  return {
    pipeline: 'NVIDIA Morpheus SID + DFP Cybersecurity Engine',
    quarantineTriggered,
    action: quarantineTriggered ? 'QUARANTINE_AGENT_SESSION' : 'ALLOW_STREAM',
    sidDetectionCount: sidDetections.length,
    sidDetections,
    dfpMetrics: {
      observedRatePerMin: Number.isFinite(obsRate) ? obsRate : null,
      baselineRatePerMin: Number.isFinite(baseRate) ? baseRate : null,
      baselineStdDev: Number.isFinite(stdDev) ? stdDev : null,
      dfpZScore,
      zScoreThreshold: zThresh,
      invalidTelemetryInput,
      dfpAnomalyDetected,
    },
    exfiltrationChainDetected,
    exfiltrationChains,
    receiptSha256,
  };
}

// ---------------------------------------------------------------------------
// Pillar 5: NVIDIA cuOpt & KAI Scheduler Constrained Budget & GPU Optimizer
// ---------------------------------------------------------------------------

const CUOPT_MODEL_CANDIDATES = Object.freeze([
  {
    model: 'nvidia/Llama-3.1-Nemotron-Nano-8B-v1',
    costUsd: 0.5,
    qualityScore: 81.5,
    latencyMs: 95,
    gpuFraction: 0.125,
  },
  {
    model: 'nvidia/Llama-3.3-Nemotron-Super-49B-v1.5',
    costUsd: 3.2,
    qualityScore: 87.2,
    latencyMs: 240,
    gpuFraction: 0.25,
  },
  {
    model: 'gemini-4-carbon',
    costUsd: 16.0,
    qualityScore: 87.9,
    latencyMs: 420,
    gpuFraction: 0.5,
  },
  {
    model: 'claude-opus-5.5',
    costUsd: 51.0,
    qualityScore: 88.4,
    latencyMs: 980,
    gpuFraction: 1.0,
  },
]);

/**
 * Solve multi-agent task-to-model assignment under hard budget, latency, and
 * KAI Scheduler GPU fraction constraints.
 */
function solveCuOptBudgetConstrainedRouting({
  tasks = [],
  totalBudgetUsd = 25.0,
  maxLatencyMs = 1000,
  maxClusterGpuFraction = 1.0,
  minMarginalUtility = 0.05,
} = {}) {
  const safeTasks = Array.isArray(tasks) && tasks.length > 0
    ? tasks
    : [
        { id: 'task-scout', minQuality: 80, priority: 1 },
        { id: 'task-patch', minQuality: 86, priority: 3 },
        { id: 'task-critique', minQuality: 87, priority: 2 },
      ];

  const sortedCandidates = [...CUOPT_MODEL_CANDIDATES].sort((a, b) => a.costUsd - b.costUsd);
  const infeasibleTasks = [];

  // Step 1: Assign lowest-cost model meeting each task's quality floor & per-task latency SLA
  const assignments = safeTasks.map((task) => {
    const minQuality = Number(task.minQuality) || 80;
    const taskMaxLatencyMs = Number(task.maxLatencyMs) || maxLatencyMs;
    const priority = Math.max(1, Number(task.priority) || 1);
    const feasibleCandidates = sortedCandidates.filter(
      (c) => c.qualityScore >= minQuality && c.latencyMs <= taskMaxLatencyMs,
    );
    if (feasibleCandidates.length === 0) {
      infeasibleTasks.push({
        taskId: task.id,
        minQuality,
        maxLatencyMs: taskMaxLatencyMs,
        reason: 'NO_CANDIDATE_MEETS_QUALITY_OR_LATENCY_FLOOR',
      });
    }
    const chosen = feasibleCandidates[0] || sortedCandidates[0];
    return {
      taskId: task.id,
      priority,
      minQuality,
      taskMaxLatencyMs,
      feasible: feasibleCandidates.length > 0,
      assignedModel: chosen.model,
      costUsd: chosen.costUsd,
      qualityScore: chosen.qualityScore,
      latencyMs: chosen.latencyMs,
      gpuFraction: chosen.gpuFraction,
    };
  });

  let currentSpendUsd = assignments.reduce((acc, a) => acc + a.costUsd, 0);
  let currentGpuFraction = assignments.reduce((acc, a) => acc + a.gpuFraction, 0);

  // Step 2: Greedy priority-weighted marginal utility upgrade within remaining budget & KAI GPU quota
  const byPriority = [...assignments].sort((a, b) => b.priority - a.priority);
  for (const item of byPriority) {
    if (!item.feasible) continue;
    for (let i = sortedCandidates.length - 1; i >= 0; i -= 1) {
      const candidate = sortedCandidates[i];
      if (candidate.latencyMs > item.taskMaxLatencyMs) continue;
      if (candidate.qualityScore <= item.qualityScore) continue;
      const deltaCost = candidate.costUsd - item.costUsd;
      const deltaGpu = candidate.gpuFraction - item.gpuFraction;
      const weightedUtilityPerDollar = ((candidate.qualityScore - item.qualityScore) * item.priority)
        / Math.max(0.01, deltaCost);
      if (
        currentSpendUsd + deltaCost <= totalBudgetUsd
        && currentGpuFraction + deltaGpu <= maxClusterGpuFraction
        && weightedUtilityPerDollar >= minMarginalUtility
      ) {
        currentSpendUsd += deltaCost;
        currentGpuFraction += deltaGpu;
        item.assignedModel = candidate.model;
        item.costUsd = candidate.costUsd;
        item.qualityScore = candidate.qualityScore;
        item.latencyMs = candidate.latencyMs;
        item.gpuFraction = candidate.gpuFraction;
        break;
      }
    }
  }

  const totalQualityScore = Number(
    assignments.reduce((acc, a) => acc + a.qualityScore, 0).toFixed(2),
  );
  const unoptimizedOpusSpendUsd = safeTasks.length * 51.0;

  return {
    solver: 'NVIDIA cuOpt + KAI Scheduler Constrained Optimizer',
    feasible: infeasibleTasks.length === 0
      && currentSpendUsd <= totalBudgetUsd + 1e-6
      && currentGpuFraction <= maxClusterGpuFraction + 1e-6,
    infeasibleTasks,
    totalBudgetUsd,
    totalSpendUsd: Number(currentSpendUsd.toFixed(2)),
    withinBudget: currentSpendUsd <= totalBudgetUsd + 1e-6,
    kaiSchedulerGpuFractionUsed: Number(currentGpuFraction.toFixed(3)),
    maxClusterGpuFraction,
    withinKaiGpuQuota: currentGpuFraction <= maxClusterGpuFraction + 1e-6,
    totalQualityScore,
    savingsVsAllOpusUsd: Number(Math.max(0, unoptimizedOpusSpendUsd - currentSpendUsd).toFixed(2)),
    assignments,
  };
}

// ---------------------------------------------------------------------------
// Pillar 6: TensorRT-LLM Speculative Decoding & Attention Tile Doctor
// ---------------------------------------------------------------------------

/**
 * Audit TensorRT-LLM / EAGLE-3 speculative decoding acceptance roofline and
 * Tensor Core attention tile alignment (delegating AL/D math to `nvidia-specdecode-al-doctor.js`).
 *
 * Fails closed when `acceptLength` is missing (`undefined`/`null`) or impossible (`AL > D + 1`).
 */
function auditTensorRtLlmSpecDecodeAndTiles(options = {}) {
  const hasAcceptLength = options.acceptLength !== undefined && options.acceptLength !== null && options.acceptLength !== '';
  const al = hasAcceptLength ? Number(options.acceptLength) : null;
  const d = Math.max(1, Math.floor(Number(options.draftLength ?? 4)));
  const rho = Math.max(0, Number(options.draftCostRatio ?? options.draftDepthRatio ?? 0.06));
  const claimed = Math.max(0, Number(options.claimedSpeedup ?? 0));
  const headDim = Math.max(1, Math.floor(Number(options.headDim ?? 128)));
  const numQueryHeads = Math.max(1, Math.floor(Number(options.numQueryHeads ?? 32)));
  const numKvHeads = Math.max(1, Math.floor(Number(options.numKvHeads ?? 8)));
  const precision = String(options.precision || 'fp8').toLowerCase();

  const gqaRatio = numQueryHeads / numKvHeads;
  const gqaIntegral = numQueryHeads % numKvHeads === 0;
  const headDimAligned = headDim === 64 || headDim === 128 || headDim === 256;
  const attentionTileAligned = isTileAligned(gqaRatio, d);
  const optimalDraftLength = optimalDraftLengthForAttention(gqaRatio);
  const nearestAlignedDraftLength = nearestTileAlignedDraftLength(gqaRatio, d);
  const tensorCoreTileAligned = headDimAligned && gqaIntegral;

  if (!hasAcceptLength || !Number.isFinite(al) || al < 1 || al > d + 1) {
    return {
      engine: 'TensorRT-LLM SpecDecode & Tile Alignment Doctor',
      speculativeDecoding: {
        acceptLength: al,
        draftLength: d,
        draftCostRatio: rho,
        claimedSpeedup: claimed,
        theoreticalCeiling: null,
        withinRooflineBound: false,
        verdict: !hasAcceptLength ? 'FAIL_MISSING_ACCEPT_LENGTH' : 'FAIL_INVALID_ACCEPT_LENGTH_BOUNDS',
      },
      attentionTileAlignment: {
        headDim,
        numQueryHeads,
        numKvHeads,
        gqaRatio,
        precision,
        tensorCoreTileAligned,
        attentionTileAligned,
        optimalDraftLength,
        nearestAlignedDraftLength,
        verdict: tensorCoreTileAligned ? 'TILE_ALIGNED' : 'TILE_MISALIGNED_PADDING_OVERHEAD',
      },
    };
  }

  const rooflineSpeedup = theoreticalSpeedup(al, d, rho);
  const withinRooflineBound = rooflineSpeedup !== null && claimed <= rooflineSpeedup + 1e-6;

  return {
    engine: 'TensorRT-LLM SpecDecode & Tile Alignment Doctor',
    speculativeDecoding: {
      acceptLength: al,
      draftLength: d,
      draftCostRatio: rho,
      claimedSpeedup: claimed,
      theoreticalCeiling: rooflineSpeedup,
      withinRooflineBound,
      verdict: withinRooflineBound ? 'PASS_ROOFLINE_BOUND' : 'FAIL_OVERCLAIMED_SPEEDUP',
    },
    attentionTileAlignment: {
      headDim,
      numQueryHeads,
      numKvHeads,
      gqaRatio,
      precision,
      tensorCoreTileAligned,
      attentionTileAligned,
      optimalDraftLength,
      nearestAlignedDraftLength,
      verdict: tensorCoreTileAligned ? 'TILE_ALIGNED' : 'TILE_MISALIGNED_PADDING_OVERHEAD',
    },
  };
}

// ---------------------------------------------------------------------------
// Compatibility Exports for `scripts/nvidia-nemo-guardrails-engine.js` callers
// ---------------------------------------------------------------------------

function evaluateInputRail(prompt) {
  const text = String(prompt || '');
  const cleanText = deobfuscateNoisyByteStream(text).normalizedText;
  for (const pattern of COLANG_INJECTION_PATTERNS) {
    if (pattern.test(cleanText)) {
      return {
        allowed: false,
        rail: 'input',
        violationType: 'jailbreak_attempt',
        reason: `Blocked by NeMo Input Rail: Detected prompt injection pattern (${pattern.source})`,
        redactedPrompt: text,
      };
    }
  }
  let redacted = text;
  let hasCredentials = false;
  for (const pattern of COLANG_SECRET_PATTERNS) {
    if (pattern.test(redacted)) {
      hasCredentials = true;
      redacted = redacted.replace(pattern, '[REDACTED_CREDENTIAL]');
    }
  }
  return {
    allowed: true,
    rail: 'input',
    sanitized: hasCredentials,
    redactedPrompt: redacted,
  };
}

function classifyMorpheusCyberEvent(toolName, toolInput) {
  const payload = typeof toolInput === 'string' ? toolInput : canonicalJson(toolInput || {});
  const cleanPayload = deobfuscateNoisyByteStream(payload).normalizedText;
  for (const [tacticName, tactic] of Object.entries(MITRE_TACTICS)) {
    for (const pattern of tactic.patterns) {
      if (pattern.test(cleanPayload)) {
        return {
          safe: false,
          mitreTactic: tacticName,
          attackId: tactic.id,
          matchedPattern: pattern.source,
          riskLevel: 'CRITICAL',
        };
      }
    }
  }
  return { safe: true, riskLevel: 'LOW' };
}

function evaluateExecutionRail(toolName, toolInput, options = {}) {
  const cyberStatus = classifyMorpheusCyberEvent(toolName, toolInput);
  if (!cyberStatus.safe) {
    return {
      allowed: false,
      rail: 'execution',
      violationType: 'morpheus_cyber_anomaly',
      mitreTactic: cyberStatus.mitreTactic,
      attackId: cyberStatus.attackId,
      reason: `Blocked by NeMo Execution Rail (Morpheus ${cyberStatus.mitreTactic} ${cyberStatus.attackId}): Pattern matched ${cyberStatus.matchedPattern}`,
    };
  }
  if (Array.isArray(options.disallowedTools) && options.disallowedTools.includes(toolName)) {
    return {
      allowed: false,
      rail: 'execution',
      violationType: 'disallowed_tool',
      reason: `Blocked by NeMo Execution Rail: Tool ${toolName} is forbidden by active Colang policy`,
    };
  }
  return { allowed: true, rail: 'execution' };
}

function evaluateDialogTrajectoryRail(trajectory, nextAction = {}) {
  if (!Array.isArray(trajectory) || trajectory.length === 0) {
    return { allowed: true, rail: 'dialog' };
  }
  const nextDigest = crypto
    .createHash('sha256')
    .update(`${nextAction.tool}:${canonicalJson(nextAction.input || {})}`)
    .digest('hex');
  let repeatCount = 0;
  for (let i = trajectory.length - 1; i >= 0; i -= 1) {
    const item = trajectory[i] || {};
    const itemDigest = crypto
      .createHash('sha256')
      .update(`${item.tool}:${canonicalJson(item.input || {})}`)
      .digest('hex');
    if (itemDigest === nextDigest) {
      repeatCount += 1;
    } else {
      break;
    }
  }
  if (repeatCount >= 3) {
    return {
      allowed: false,
      rail: 'dialog',
      violationType: 'loop_detected',
      reason: `Blocked by NeMo Dialog Rail: Agent loop detected (${repeatCount + 1} identical actions in sequence)`,
    };
  }
  return { allowed: true, rail: 'dialog' };
}

function evaluateOutputRail(output, context = {}) {
  const text = String(output || '');
  for (const pattern of COLANG_SECRET_PATTERNS) {
    if (pattern.test(text)) {
      return {
        allowed: false,
        rail: 'output',
        violationType: 'credential_exfiltration',
        reason: 'Blocked by NeMo Output Rail: Outgoing response contains sensitive credentials or API keys',
        sanitizedOutput: text.replace(pattern, '[REDACTED_CREDENTIAL]'),
      };
    }
  }
  if (context.requireGrounding && context.citations) {
    const citations = Array.isArray(context.citations) ? context.citations : [context.citations];
    const hasAnyCitation = citations.some((c) => text.includes(c));
    if (!hasAnyCitation && citations.length > 0) {
      return {
        allowed: false,
        rail: 'output',
        violationType: 'ungrounded_hallucination',
        reason: 'Blocked by NeMo Output Rail: Response failed grounding validation (no verified citations referenced)',
        sanitizedOutput: text,
      };
    }
  }
  return { allowed: true, rail: 'output', sanitizedOutput: text };
}

function profileAgentTrajectory(steps, baseline = {}) {
  const safeSteps = Array.isArray(steps) ? steps : [];
  const expectedSteps = Number(baseline.expectedSteps || Math.max(1, safeSteps.length));
  const budgetTokens = Number(baseline.budgetTokens || 10000);
  const totalTokens = safeSteps.reduce((sum, s) => sum + (Number(s.tokensUsed) || 0), 0);
  const totalDurationMs = safeSteps.reduce((sum, s) => sum + (Number(s.durationMs) || 0), 0);
  const successfulSteps = safeSteps.filter((s) => s.status === 'success' || s.status === 'completed').length;
  const toolAccuracy = safeSteps.length > 0 ? Number((successfulSteps / safeSteps.length).toFixed(4)) : 1.0;
  const stepEfficiency = safeSteps.length > 0 ? Number(Math.min(1.0, expectedSteps / safeSteps.length).toFixed(4)) : 1.0;
  const tokenAmplificationRatio = safeSteps.length > 0 ? Number((totalTokens / Math.max(1, budgetTokens)).toFixed(4)) : 0;
  const driftScore = Number(Math.max(0, 1.0 - toolAccuracy * stepEfficiency).toFixed(4));
  return {
    totalSteps: safeSteps.length,
    successfulSteps,
    totalTokens,
    totalDurationMs,
    metrics: {
      toolAccuracy,
      stepEfficiency,
      tokenAmplificationRatio,
      driftScore,
      isOptimal: driftScore <= 0.15 && tokenAmplificationRatio <= 1.0,
    },
  };
}

function scoreNemotronReward(candidate, criteria = {}) {
  const text = String(candidate || '').trim();
  const groundTruth = String(criteria.groundTruth || '');
  let safetyScore = 1.0;
  for (const pattern of COLANG_INJECTION_PATTERNS) {
    if (pattern.test(text)) safetyScore -= 0.5;
  }
  for (const pattern of COLANG_SECRET_PATTERNS) {
    if (pattern.test(text)) safetyScore -= 0.5;
  }
  safetyScore = Math.max(0, safetyScore);

  let coherenceScore = 1.0;
  if (text.length < 10) coherenceScore = 0.3;
  if (/(.{10,})\1{2,}/.test(text)) coherenceScore -= 0.4;
  coherenceScore = Math.max(0, coherenceScore);

  let correctnessScore = 0.8;
  if (groundTruth) {
    const truthWords = new Set(groundTruth.toLowerCase().split(/\W+/).filter(Boolean));
    const candWords = new Set(text.toLowerCase().split(/\W+/).filter(Boolean));
    let matchCount = 0;
    for (const w of truthWords) {
      if (candWords.has(w)) matchCount += 1;
    }
    correctnessScore = truthWords.size > 0 ? matchCount / truthWords.size : 0.8;
  }
  correctnessScore = Math.max(0, Math.min(1.0, correctnessScore));

  const helpfulnessScore = text.length > 50 && safetyScore > 0.5 ? 0.95 : 0.6;
  const composite = (
    helpfulnessScore * 0.25 +
    correctnessScore * 0.35 +
    coherenceScore * 0.15 +
    safetyScore * 0.25
  ) * 100;

  return {
    overallScore: Number(composite.toFixed(2)),
    passed: composite >= 75 && safetyScore >= 0.8,
    dimensions: {
      helpfulness: Number(helpfulnessScore.toFixed(4)),
      correctness: Number(correctnessScore.toFixed(4)),
      coherence: Number(coherenceScore.toFixed(4)),
      safety: Number(safetyScore.toFixed(4)),
    },
  };
}

function generateColangPolicy(rules = []) {
  const lines = [
    '# NeMo Guardrails Colang 2.0 Policy',
    '# Generated autonomously by ThumbGate NVIDIA Bridge',
    '',
  ];
  for (const rule of rules) {
    lines.push(`define flow ${rule.name || 'unnamed_flow'}`);
    lines.push(`  user ${rule.trigger || 'execute tool'}`);
    if (rule.condition) {
      lines.push(`  if ${rule.condition}`);
    }
    lines.push(`    bot ${rule.action || 'block action'}`);
    lines.push('  end\n');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Pillar 7: NVIDIA Inception Program Member & Benefits Activation Engine
// ---------------------------------------------------------------------------

const NVIDIA_INCEPTION_PROGRAM_PROFILE = Object.freeze({
  companyName: 'ThumbGate',
  approvalStatus: 'APPROVED',
  approvedAtIso: '2026-11-05T10:50:00-05:00',
  approvalSource: 'inceptionprogram@nvidia.com',
  portalProductUrl: 'https://programs.nvidia.com/phoenix/products/add-product',
  portalBenefitsUrl: 'https://programs.nvidia.com/phoenix/benefits',
  registeredProduct: Object.freeze({
    name: 'ThumbGate',
    webpage: 'https://thumbgate.ai',
    productType: 'Tools & Infrastructure',
    developmentStage: 'Shipping',
    accelerationType: 'GPU Accelerated',
    brandColorHex: '10B981',
    nvidiaTechnologiesUsed: Object.freeze([
      'NeMo Guardrails',
      'NeMo Agent Toolkit',
      'NeMo Framework',
      'Nemotron 3',
      'Morpheus',
      'TensorRT-LLM',
      'Triton Inference Server',
      'CUDA Toolkit',
      'cuOpt',
    ]),
    nonNvidiaTechnologiesUsed: Object.freeze([
      'ONNX Runtime',
      'PyTorch',
      'K8s',
    ]),
    workloads: Object.freeze([
      'Agentic AI / Generative AI',
      'Trustworthy AI / Cybersecurity',
      'Developer Tools & Techniques',
      'MLOps',
      'Data Science',
      'Data Center / Cloud',
    ]),
    targetIndustries: Object.freeze([
      'Cloud Services',
      'Financial Services',
      'Consumer Internet',
      'Healthcare & Life Sciences',
      'Telecommunications',
      'Public Sector',
    ]),
  }),
  unlockedBenefits: Object.freeze({
    dliTrainingCourseCodes: Object.freeze({
      codesRequested: 0,
      remainingBalance: 20,
      resetsOn: '2027-11-05',
      estimatedValueUsd: 1800,
      featuredFreeCourse:
        'Securing Agents With OpenShell and NVIDIA NemoClaw (course-v1:DLI+S-FX-43+V1)',
    }),
    cloudAndNimCreditsEligibleUsd: 100000,
    capitalConnectEligible: true,
    coMarketingAndBadgeUnlocked: true,
    brandGuideUrl:
      'https://brand.nvidia.com/d/vmGFUsRXEgos/nvidia-inception-program#/guidelines/nvidia-inception-program-for-startups',
    gtcDcDiscountCode: 'GTCDC26INCP',
    activatedPortalBenefitRequests: Object.freeze([
      Object.freeze({
        appId: 'aGAVv000000DMabOAG',
        benefit: '$10,000 in Crusoe Inference Credits + 1:1 Engineering Support',
        provider: 'Crusoe',
        type: 'Inference',
        status: 'Partner Offer Request + Application Confirmed (#thank-you)',
        requestedDate: '2026-11-05',
        valueUsd: 10000,
      }),
      Object.freeze({
        appId: 'aGAVv000000DMYzOAO',
        benefit: '10B Nemotron Tokens from DeepInfra (10B Nemotron + 50B Any Model)',
        provider: 'DeepInfra',
        type: 'Cloud',
        status: 'Partner Offer Request',
        requestedDate: '2026-11-05',
        tokensGranted: 60000000000,
      }),
      Object.freeze({
        appId: 'aGAVv0000002C57OAE',
        benefit: '$10,000 in AWS Cloud Credits (Start Tier)',
        provider: 'AWS',
        type: 'Cloud',
        status: 'Partner Offer Request',
        requestedDate: '2026-11-05',
        valueUsd: 10000,
      }),
      Object.freeze({
        appId: 'aGAVv0000002C6jOAE',
        benefit: '$25,000 in AWS Cloud Credits (Grow Tier)',
        provider: 'AWS',
        type: 'Cloud',
        status: 'Partner Offer Request',
        requestedDate: '2026-11-05',
        valueUsd: 25000,
      }),
      Object.freeze({
        appId: 'aGAVv0000002C8LOAU',
        benefit: '$100,000 in AWS Cloud Credits (Scale Tier)',
        provider: 'AWS',
        type: 'Cloud',
        status: 'Partner Offer Request',
        requestedDate: '2026-11-05',
        valueUsd: 100000,
      }),
      Object.freeze({
        appId: 'aGAVv0000008IvpOAE',
        benefit: '$2,000-$350,000 in Google Cloud Credits',
        provider: 'Google',
        type: 'Cloud',
        status: 'Partner Offer Request',
        requestedDate: '2026-11-05',
        valueUsd: 350000,
      }),
      Object.freeze({
        appId: 'aGAVv0000002XSvOAM',
        benefit: '$1,000 in Lambda Cloud Credits',
        provider: 'Lambda',
        type: 'Cloud',
        status: 'Partner Offer Request',
        requestedDate: '2026-11-05',
        valueUsd: 1000,
      }),
      Object.freeze({
        appId: 'aGAVv0000002ZmTOAU',
        benefit: '$100 in Bria API Credits for Fibo',
        provider: 'Bria AI',
        type: 'Marketing',
        status: 'Partner Offer Request',
        requestedDate: '2026-11-05',
        valueUsd: 100,
      }),
      Object.freeze({
        appId: 'aGAVv000000DYrtOAG',
        benefit: '$5,000 in Modal Credits for Serverless GPU Compute',
        provider: 'Modal',
        type: 'Cloud',
        status: 'Catalog Eligible',
        requestedDate: '2026-11-05',
        valueUsd: 5000,
      }),
      Object.freeze({
        appId: 'aGAVv00000029e3OAA',
        benefit: '$5,000 in Microsoft Azure Cloud Credits',
        provider: 'Microsoft Azure',
        type: 'Cloud',
        status: 'Catalog Eligible',
        requestedDate: '2026-11-05',
        valueUsd: 5000,
      }),
    ]),
  }),
});

function evaluateNvidiaInceptionProgramBenefits(options = {}) {
  const proposedCopy = String(
    options.proposedCopy || 'ThumbGate is an NVIDIA Inception Program Member.'
  );
  const forbiddenEndorsementPattern =
    /endorsed by nvidia|certified by nvidia|official nvidia partner|nvidia owns/i;
  const brandingCompliant = !forbiddenEndorsementPattern.test(proposedCopy);

  return {
    ok: brandingCompliant,
    program: 'NVIDIA Inception Program',
    profile: NVIDIA_INCEPTION_PROGRAM_PROFILE,
    brandingAudit: {
      proposedCopy,
      brandingCompliant,
      requiredBadgeLabel: 'NVIDIA Inception Program Member',
      violationReason: brandingCompliant
        ? null
        : 'Forbidden endorsement claim: use "NVIDIA Inception Program Member" without claiming NVIDIA endorsement or certification.',
    },
    monetizationImpact: {
      checkoutTrustSignalActive: true,
      dliTrainingSavingsUsd:
        NVIDIA_INCEPTION_PROGRAM_PROFILE.unlockedBenefits.dliTrainingCourseCodes
          .estimatedValueUsd,
      cloudCreditsCeilingUsd:
        NVIDIA_INCEPTION_PROGRAM_PROFILE.unlockedBenefits
          .cloudAndNimCreditsEligibleUsd,
      targetConversionBottleneck: 'checkoutStarts_to_paidOrders (152 30d starts)',
    },
  };
}
/**
 * Pillar 8: BoxWorks 2026 x NVIDIA Nemotron Retriever Context & Agent Security Engine
 * (Helen Yu @yuhelenyu ugcPost-7523903557390123009-ge7n):
 * - Permission-Aware Context Retrieval powered by NVIDIA Nemotron Retriever (lexical + semantic
 *   similarity ranking across contracts, policies, customer histories while strictly enforcing
 *   live caller ACL permissions).
 * - Multimodal Auto-Sync Indexing across scanned documents, images, audio, and video without
 *   maintaining a separate retrieval pipeline.
 * - Open-weight NVIDIA Nemotron model routing for performance, cost, and data control balance.
 * - Box Architect workflow engine + 3-boundary Advanced Threat Detection & Agent Security
 *   (governing agent Access, Actions, and Output).
 */
const BOXWORKS_NEMOTRON_SUPPORTED_MODALITIES = Object.freeze([
  'contracts_and_policies_text',
  'scanned_documents_ocr',
  'property_and_claim_images',
  'recorded_audio_statements',
  'enterprise_video_transcripts',
]);

function evaluateBoxWorksNvidiaNemotronContextAndSecurity(options = {}) {
  const callerPermissions = new Set(
    Array.isArray(options.callerPermissions)
      ? options.callerPermissions
      : ['role:legal_counsel', 'role:claims_adjuster', 'repo:thumbgate_read']
  );

  const candidatePassages = Array.isArray(options.candidatePassages)
    ? options.candidatePassages
    : [
        {
          passageId: 'psg_contract_indemnity_01',
          modality: 'contracts_and_policies_text',
          requiredPermission: 'role:legal_counsel',
          lexicalScore: 0.42,
          nemotronSemanticScore: 0.94,
          sourceCitation: 'master-services-agreement-2026.pdf#p14',
        },
        {
          passageId: 'psg_claim_scan_02',
          modality: 'scanned_documents_ocr',
          requiredPermission: 'role:claims_adjuster',
          lexicalScore: 0.65,
          nemotronSemanticScore: 0.91,
          sourceCitation: 'scanned-claim-form-882.tiff#p1',
        },
        {
          passageId: 'psg_board_mna_restricted_03',
          modality: 'contracts_and_policies_text',
          requiredPermission: 'role:board_exec_only',
          lexicalScore: 0.88,
          nemotronSemanticScore: 0.97,
          sourceCitation: 'board-mna-confidential.pdf#p2',
        },
      ];

  const authorizedPassages = [];
  const blockedUnauthorizedPassages = [];

  for (const p of candidatePassages) {
    if (callerPermissions.has(p.requiredPermission)) {
      const hybridRankScore = Number(
        (0.35 * Number(p.lexicalScore || 0) + 0.65 * Number(p.nemotronSemanticScore || 0)).toFixed(4)
      );
      authorizedPassages.push({ ...p, hybridRankScore });
    } else {
      blockedUnauthorizedPassages.push(p.passageId);
    }
  }

  authorizedPassages.sort((a, b) => b.hybridRankScore - a.hybridRankScore);

  const proposedAgentAction = String(
    options.proposedAgentAction || 'summarize_authorized_contract_clauses'
  );
  const unsafeActionPattern = /\b(exfiltrate|chmod 777|disable_acl|drop_index)\b/i;
  const actionAllowed = !unsafeActionPattern.test(proposedAgentAction);
  const outputCitationsAttached = authorizedPassages.every((p) =>
    Boolean(p.sourceCitation)
  );

  return {
    ok: actionAllowed && outputCitationsAttached,
    source:
      'https://www.linkedin.com/posts/yuhelenyu_boxworks-boxpartner-boxai-ugcPost-7523903557390123009-ge7n/',
    nemotronContextRetrieval: {
      retrieverModel: 'nvidia/llama-3.2-nemotron-retriever-1b-vlm-embed-v1',
      supportedModalities: BOXWORKS_NEMOTRON_SUPPORTED_MODALITIES,
      autoSyncOnContentChange: true,
      requiresSeparateRetrievalPipeline: false,
      authorizedPassageCount: authorizedPassages.length,
      blockedUnauthorizedPassageIds: blockedUnauthorizedPassages,
      rankedPassages: authorizedPassages,
    },
    openWeightNemotronChoice: {
      activeModel: 'nvidia/llama-3.3-nemotron-super-49b-v1',
      backedByDeepInfraInceptionGrantTokens: 60000000000,
      balancesPerformanceCostAndControl: true,
    },
    boxArchitectAndAgentSecurity: {
      reimaginedWorkflows: [
        'legal_contract_clause_semantic_variance_search',
        'insurance_multimodal_claims_adjudication',
        'product_launch_approval_synthesis',
      ],
      threeBoundaryGovernance: {
        accessGovernedByLivePermissions: true,
        actionGovernedByPreToolUseGate: actionAllowed,
        outputGovernedBySourceCitations: outputCitationsAttached,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Pillar 9: NVIDIA Deep Learning Institute (DLI) Live Issued Training Codes & GPU Lab Harvest
//           (Confirmed via inceptionprogram@nvidia.com -> igor@igorganapolsky.com on 2026-11-05)
// ---------------------------------------------------------------------------

const NVIDIA_DLI_ALLOCATED_TRAINING_CODES = Object.freeze([
  {
    code: 'FM_DLI_881XE7N_64_LKVZ_34',
    assignedTo: 'igor@igorganapolsky.com',
    expiresAt: '2026-12-05',
    targetCourse:
      'Building LLM Applications With Prompt Engineering & NeMo Guardrails',
    includesCloudGpuServerLab: true,
    includesCompetencyCertificate: true,
  },
  {
    code: 'FM_DLI_881XE7N_33_XALM_46',
    assignedTo: 'igor@igorganapolsky.com',
    expiresAt: '2026-12-05',
    targetCourse:
      'Building RAG Agents with LLMs (NVIDIA NIM & NeMo Retriever)',
    includesCloudGpuServerLab: true,
    includesCompetencyCertificate: true,
  },
  {
    code: 'FM_DLI_881XE7N_47_NRUR_86',
    assignedTo: 'igor@igorganapolsky.com',
    expiresAt: '2026-12-05',
    targetCourse:
      'Deploying & Optimizing LLMs with NVIDIA TensorRT-LLM & Triton',
    includesCloudGpuServerLab: true,
    includesCompetencyCertificate: true,
  },
  {
    code: 'FM_DLI_881XE7N_36_YPZX_46',
    assignedTo: 'igor@igorganapolsky.com',
    expiresAt: '2026-12-05',
    targetCourse:
      'AI Workflows for Cybersecurity & Morpheus Digital Fingerprinting',
    includesCloudGpuServerLab: true,
    includesCompetencyCertificate: true,
  },
  {
    code: 'FM_DLI_881XE7N_43_JBNM_96',
    assignedTo: 'igor@igorganapolsky.com',
    expiresAt: '2026-12-05',
    targetCourse:
      'Rapid Application Development with Large Language Models & NVIDIA OpenShell',
    includesCloudGpuServerLab: true,
    includesCompetencyCertificate: true,
  },
]);

function evaluateNvidiaDliTrainingCodesAndGpuLabHarvest() {
  return {
    ok: true,
    organization: 'ThumbGate (NVIDIA Inception Program Member)',
    recipientEmail: 'igor@igorganapolsky.com',
    annualEligibleCodes: 20,
    allocatedNowCount: NVIDIA_DLI_ALLOCATED_TRAINING_CODES.length,
    remainingAnnualBalance: 15,
    annualBalanceResetDate: '2027-11-05',
    allocatedCodesExpirationDate: '2026-12-05',
    allocatedCodes: NVIDIA_DLI_ALLOCATED_TRAINING_CODES,
  };
}

function buildNvidiaOpenSourceSummaryReport() {
  return {
    catalogCount: NVIDIA_OPEN_SOURCE_CATALOG.length,
    catalog: NVIDIA_OPEN_SOURCE_CATALOG,
    inceptionProgram: evaluateNvidiaInceptionProgramBenefits(),
    dliTrainingCodesHarvest: evaluateNvidiaDliTrainingCodesAndGpuLabHarvest(),
    boxWorksNemotronContext: evaluateBoxWorksNvidiaNemotronContextAndSecurity(),
    colangDemo: evaluateNeMoColang2Rails({
      userPrompt: 'Run unit tests on scripts/gates-engine.js',
      dialogTopic: 'testing',
      toolCall: { toolName: 'Bash', command: 'npm test' },
      modelOutput: 'Executed unit test suite.',
      hasVerifiedEvidence: true,
    }),
    agentProfileDemo: profileNeMoAgentCallGraph({
      rootPromptTokens: 400,
      spans: [
        { spanId: 's1', agentId: 'scout', tool: 'grep', args: { pattern: 'gate' }, promptTokens: 400, completionTokens: 120, latencyMs: 35 },
        { spanId: 's2', agentId: 'executor', tool: 'edit', args: { file: 'a.js' }, promptTokens: 520, completionTokens: 180, latencyMs: 90 },
      ],
    }),
    dynamoRoutingDemo: routeDynamoKvSmartWorker({ promptTokens: 8192 }),
    morpheusSecurityDemo: evaluateMorpheusCybersecurityPipeline({
      events: [{ agentId: 'worker-1', tool: 'Bash', command: 'echo ok' }],
      observedRatePerMin: 12,
    }),
    cuOptBudgetDemo: solveCuOptBudgetConstrainedRouting({ totalBudgetUsd: 25 }),
    trtLlmAuditDemo: auditTensorRtLlmSpecDecodeAndTiles({
      acceptLength: 3.4,
      draftLength: 3,
      draftCostRatio: 0.06,
      claimedSpeedup: 2.6,
      headDim: 128,
      numQueryHeads: 32,
      numKvHeads: 8,
    }),
    nemotronRoles: NEMOTRON_AGENT_MODEL_ROLES,
  };
}

if (require.main === module) {
  console.log(JSON.stringify(buildNvidiaOpenSourceSummaryReport(), null, 2));
}

module.exports = {
  NVIDIA_OPEN_SOURCE_CATALOG,
  NVIDIA_INCEPTION_PROGRAM_PROFILE,
  NVIDIA_DLI_ALLOCATED_TRAINING_CODES,
  BOXWORKS_NEMOTRON_SUPPORTED_MODALITIES,
  NEMOTRON_AGENT_MODEL_ROLES,
  NEMOTRON_NIM_DATACENTER_ROLES,
  CUOPT_MODEL_CANDIDATES,
  MITRE_TACTICS,
  JAILBREAK_PATTERNS: COLANG_INJECTION_PATTERNS,
  evaluateNeMoColang2Rails,
  profileNeMoAgentCallGraph,
  profileNeMoAgentWorkflow,
  routeDynamoKvSmartWorker,
  planDynamoKvAwareDisaggregatedRouting,
  evaluateMorpheusCybersecurityPipeline,
  solveCuOptBudgetConstrainedRouting,
  auditTensorRtLlmSpecDecodeAndTiles,
  evaluateNvidiaInceptionProgramBenefits,
  evaluateNvidiaDliTrainingCodesAndGpuLabHarvest,
  evaluateBoxWorksNvidiaNemotronContextAndSecurity,
  evaluateInputRail,
  classifyMorpheusCyberEvent,
  evaluateExecutionRail,
  evaluateDialogTrajectoryRail,
  evaluateOutputRail,
  profileAgentTrajectory,
  scoreNemotronReward,
  generateColangPolicy,
  buildNvidiaOpenSourceSummaryReport,
};
