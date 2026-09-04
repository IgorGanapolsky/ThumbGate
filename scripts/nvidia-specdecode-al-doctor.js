#!/usr/bin/env node
'use strict';

/**
 * NVIDIA speculative-decoding AL/D doctor for ThumbGate.
 *
 * Steals measurable mechanics from:
 * https://developer.nvidia.com/blog/co-designing-ai-models-using-speculative-decoding-for-faster-llm-inference/
 *
 * Transfers (only):
 *   - speedup ≈ AL / (1 + ρD) at low latency
 *   - attention draft length D = 128/G - 1
 *   - tile alignment: G × (1 + D) multiple of 128
 *   - increase D only while AL gains justify draft cost
 *   - pick draft mechanism by AL vs draft overhead (not brand)
 *
 * Does NOT clone TensorRT-LLM, EAGLE training, Model-Optimizer, or SPEED-Bench.
 * Maps findings onto existing checkpoint-speculative-decoding-acceptance gate.
 */

const path = require('node:path');

const ATTENTION_TILE = 128;
const DEFAULT_MIN_ACCEPT_LENGTH = 2;
const SOURCE_URL =
  'https://developer.nvidia.com/blog/co-designing-ai-models-using-speculative-decoding-for-faster-llm-inference/';

function normalizeBoolean(value) {
  if (value === true) return true;
  if (value === false || value === undefined || value === null) return false;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function round4(value) {
  return Number(Number(value).toFixed(4));
}

/**
 * Guideline 2: when attention dominates decode, D = 128/G - 1.
 * @param {number} queryHeadsPerKvHead G
 * @returns {number|null}
 */
function optimalDraftLengthForAttention(queryHeadsPerKvHead) {
  const g = Number(queryHeadsPerKvHead);
  if (!Number.isFinite(g) || g <= 0) return null;
  return Math.max(0, Math.floor(ATTENTION_TILE / g) - 1);
}

/**
 * Guideline 3: prefer D where G × (1 + D) is a multiple of 128.
 */
function isTileAligned(queryHeadsPerKvHead, draftLength) {
  const g = Number(queryHeadsPerKvHead);
  const d = Number(draftLength);
  if (!Number.isFinite(g) || g <= 0 || !Number.isFinite(d) || d < 0) return false;
  return (g * (1 + d)) % ATTENTION_TILE === 0;
}

/**
 * Next tile-aligned draft length at or above candidate D (or null).
 */
function nearestTileAlignedDraftLength(queryHeadsPerKvHead, draftLength) {
  const g = Number(queryHeadsPerKvHead);
  let d = Math.max(0, Math.floor(Number(draftLength) || 0));
  if (!Number.isFinite(g) || g <= 0) return null;
  for (let i = 0; i < ATTENTION_TILE; i += 1) {
    if (isTileAligned(g, d + i)) return d + i;
  }
  return null;
}

/** Draft overhead O_d = ρD */
function draftOverhead(draftDepthRatio, draftLength) {
  const rho = Number(draftDepthRatio);
  const d = Number(draftLength);
  if (!Number.isFinite(rho) || rho < 0 || !Number.isFinite(d) || d < 0) return null;
  return round4(rho * d);
}

/**
 * Low-latency approximation: speedup = AL / (1 + ρD)
 * AL ranges from 1 to 1+D (target always emits one ground-truth token).
 */
function theoreticalSpeedup(acceptLength, draftLength, draftDepthRatio) {
  const al = Number(acceptLength);
  const d = Number(draftLength);
  const rho = draftDepthRatio === undefined || draftDepthRatio === null
    ? 0
    : Number(draftDepthRatio);
  if (!Number.isFinite(al) || al <= 0) return null;
  if (!Number.isFinite(d) || d < 0) return null;
  if (!Number.isFinite(rho) || rho < 0) return null;
  const denom = 1 + (rho * d);
  if (denom <= 0) return null;
  return round4(al / denom);
}

/**
 * Guideline 4 helper: raising D helps only while AL gain beats added draft cost.
 * Compare speedup at (D, AL) vs (D+deltaD, AL+deltaAL) under fixed ρ.
 */
function shouldIncreaseDraftLength({
  acceptLength,
  draftLength,
  draftDepthRatio = 0,
  nextAcceptLength,
  nextDraftLength,
}) {
  const current = theoreticalSpeedup(acceptLength, draftLength, draftDepthRatio);
  const next = theoreticalSpeedup(nextAcceptLength, nextDraftLength, draftDepthRatio);
  if (current === null || next === null) return null;
  return {
    currentSpeedup: current,
    nextSpeedup: next,
    increase: next > current,
    deltaSpeedup: round4(next - current),
  };
}

/**
 * Guideline 5 (ThumbGate-shaped): recommend a draft *class*, not a vendor stack.
 * Never claims TensorRT/EAGLE/Model-Optimizer readiness.
 */
function recommendDraftMechanism(options = {}) {
  const workload = String(options.workload || options.workloadType || 'agentic').trim().toLowerCase();
  const latencyRegion = String(options.latencyRegion || options.latency || 'low').trim().toLowerCase();
  const modelSize = String(options.modelSize || options.size || 'medium').trim().toLowerCase();
  const repetitive = normalizeBoolean(options.repetitive)
    || /repetit|tool.?loop|code.?complete|suffix|ngram/.test(workload);

  if (repetitive) {
    return {
      mechanism: 'suffix-ngram',
      draftDepthRatioHint: 0,
      reason: 'Repetitive agent/tool token streams get free O(1) drafts; no learned drafter to retrain after target fine-tunes.',
      bestFor: 'high-repetition coding agents and tool-call loops',
    };
  }

  if (latencyRegion === 'low' && /small|tiny|7b|8b|3b/.test(modelSize)) {
    return {
      mechanism: 'parallel-draft-head',
      draftDepthRatioHint: 0.05,
      reason: 'Small targets at low latency: parallel draft heads keep O_d low even when AL is modest (DFlash/DSpark class).',
      bestFor: 'batch-1 interactive small models',
    };
  }

  if (/large|70b|120b|405b|moe/.test(modelSize)) {
    return {
      mechanism: 'target-attached-mtp',
      draftDepthRatioHint: 0.02,
      reason: 'Large GPU targets: one-layer MTP-style heads keep draft overhead tiny relative to L_target while AL stays competitive.',
      bestFor: 'large self-hosted targets on GPUs',
    };
  }

  return {
    mechanism: 'external-small-draft',
    draftDepthRatioHint: 0.15,
    reason: 'Default: small external draft can raise AL, but only if measured O_d still leaves AL/(1+ρD) above 1. Re-measure AL after every target fine-tune.',
    bestFor: 'general agentic workloads with measured AL evidence',
  };
}

function normalizeOptions(options = {}) {
  const queryHeads = toNumber(options['query-heads'] || options.queryHeads);
  const kvHeads = toNumber(options['kv-heads'] || options.kvHeads);
  let g = toNumber(options['query-heads-per-kv'] || options.g || options.G);
  if (g === null && queryHeads !== null && kvHeads !== null && kvHeads > 0) {
    g = queryHeads / kvHeads;
  }

  return {
    workload: String(options.workload || options.name || 'speculative-decoding').trim() || 'speculative-decoding',
    model: String(options.model || 'target-model').trim() || 'target-model',
    speculativeDecoding: normalizeBoolean(
      options['speculative-decoding'] || options.speculative || options.mtp || options.eagle || options.enabled
    ),
    acceptLength: toNumber(options['accept-length'] || options.al || options.AL),
    draftLength: toNumber(options['draft-length'] || options.d || options.D),
    draftDepthRatio: toNumber(options['draft-depth-ratio'] || options.rho || options['depth-ratio']),
    claimedSpeedup: toNumber(options['claimed-speedup'] || options.speedup || options['claimed-x']),
    minAcceptLength: toNumber(options['min-accept-length']) ?? DEFAULT_MIN_ACCEPT_LENGTH,
    queryHeadsPerKvHead: g,
    queryHeads,
    kvHeads,
    attentionDominated: normalizeBoolean(options['attention-dominated'] || options.attention),
    latencyRegion: String(options['latency-region'] || options.latency || 'low').trim().toLowerCase() || 'low',
    modelSize: String(options['model-size'] || options.size || 'medium').trim().toLowerCase() || 'medium',
    repetitive: normalizeBoolean(options.repetitive),
    nextAcceptLength: toNumber(options['next-accept-length'] || options['al-next']),
    nextDraftLength: toNumber(options['next-draft-length'] || options['d-next']),
    cacheCoherenceEval: normalizeBoolean(options['cache-coherence-eval'] || options['cache-eval']),
    strict: normalizeBoolean(options.strict),
  };
}

function buildFindings(options, metrics, mechanism) {
  const findings = [];

  if (options.speculativeDecoding && options.acceptLength === null) {
    findings.push({
      id: 'accept_length_missing',
      severity: 'fail',
      gateId: 'checkpoint-speculative-decoding-acceptance',
      message: 'Speculative decoding is enabled but measured accept length (AL) is missing. SPEED-Bench-style AL evidence is required before treating speculation as a speedup.',
    });
  }

  if (options.acceptLength !== null && options.acceptLength < options.minAcceptLength) {
    findings.push({
      id: 'accept_length_below_floor',
      severity: 'fail',
      gateId: 'checkpoint-speculative-decoding-acceptance',
      message: `Accept length ${options.acceptLength} is below the floor ${options.minAcceptLength}. Do not route production traffic until AL recovers.`,
    });
  }

  if (
    options.acceptLength !== null
    && options.draftLength !== null
    && options.acceptLength > (1 + options.draftLength)
  ) {
    findings.push({
      id: 'accept_length_impossible',
      severity: 'fail',
      gateId: 'checkpoint-speculative-decoding-acceptance',
      message: `AL=${options.acceptLength} exceeds 1+D=${1 + options.draftLength}. Measured AL must be in [1, 1+D].`,
    });
  }

  if (
    metrics.theoreticalSpeedup !== null
    && options.claimedSpeedup !== null
    && options.claimedSpeedup > metrics.theoreticalSpeedup + 1e-9
  ) {
    findings.push({
      id: 'claimed_speedup_over_theory',
      severity: 'fail',
      gateId: 'checkpoint-speculative-decoding-acceptance',
      message: `Claimed speedup ${options.claimedSpeedup}x exceeds theoretical AL/(1+ρD)=${metrics.theoreticalSpeedup}x. Reject the throughput claim.`,
    });
  }

  if (options.speculativeDecoding && !options.cacheCoherenceEval) {
    findings.push({
      id: 'cache_coherence_missing',
      severity: 'warn',
      gateId: 'checkpoint-speculative-decoding-acceptance',
      message: 'Speculation enabled without cache-coherence / rollback evidence. Pair with require-hybrid-prefix-cache-coherence-eval before production.',
    });
  }

  if (options.attentionDominated && options.queryHeadsPerKvHead !== null) {
    const optimal = metrics.attentionOptimalDraftLength;
    if (optimal !== null && options.draftLength !== null) {
      if (options.draftLength > optimal && !metrics.tileAligned) {
        findings.push({
          id: 'tile_underutilized',
          severity: 'warn',
          gateId: 'checkpoint-speculative-decoding-acceptance',
          message: `Attention-dominated: D=${options.draftLength} exceeds D*=${optimal} and G×(1+D) is not a multiple of ${ATTENTION_TILE}. Prefer tile-aligned D=${metrics.tileAlignedDraftLength}.`,
        });
      }
    } else if (optimal !== null && options.draftLength === null) {
      findings.push({
        id: 'suggest_attention_draft_length',
        severity: 'info',
        gateId: 'checkpoint-speculative-decoding-acceptance',
        message: `Attention-dominated workload: start with D=${optimal} (128/G - 1) for G=${options.queryHeadsPerKvHead}.`,
      });
    }
  }

  if (metrics.draftIncreaseDecision && metrics.draftIncreaseDecision.increase === false) {
    findings.push({
      id: 'draft_increase_not_justified',
      severity: 'warn',
      gateId: 'checkpoint-speculative-decoding-acceptance',
      message: `Guideline 4: raising D to ${options.nextDraftLength} drops speedup from ${metrics.draftIncreaseDecision.currentSpeedup}x to ${metrics.draftIncreaseDecision.nextSpeedup}x. Keep current D.`,
    });
  }

  if (mechanism && options.draftDepthRatio === null && mechanism.draftDepthRatioHint !== undefined) {
    findings.push({
      id: 'draft_depth_ratio_assumed',
      severity: 'info',
      gateId: null,
      message: `No --draft-depth-ratio provided. Mechanism hint ρ≈${mechanism.draftDepthRatioHint} for ${mechanism.mechanism}; measure serve-time O_d before claiming speedup.`,
    });
  }

  return findings;
}

function buildNvidiaSpecDecodeAlDoctorReport(rawOptions = {}) {
  const options = normalizeOptions(rawOptions);
  const rhoForTheory = options.draftDepthRatio === null ? 0 : options.draftDepthRatio;
  const attentionOptimalDraftLength = optimalDraftLengthForAttention(options.queryHeadsPerKvHead);
  const tileAligned = options.queryHeadsPerKvHead !== null && options.draftLength !== null
    ? isTileAligned(options.queryHeadsPerKvHead, options.draftLength)
    : null;
  const tileAlignedDraftLength = options.queryHeadsPerKvHead !== null
    ? nearestTileAlignedDraftLength(
      options.queryHeadsPerKvHead,
      options.draftLength ?? attentionOptimalDraftLength ?? 0
    )
    : null;

  const mechanism = recommendDraftMechanism({
    workload: options.workload,
    latencyRegion: options.latencyRegion,
    modelSize: options.modelSize,
    repetitive: options.repetitive,
  });

  const metrics = {
    acceptLength: options.acceptLength,
    draftLength: options.draftLength,
    draftDepthRatio: options.draftDepthRatio,
    draftOverhead: draftOverhead(rhoForTheory, options.draftLength ?? 0),
    theoreticalSpeedup: options.acceptLength !== null && options.draftLength !== null
      ? theoreticalSpeedup(options.acceptLength, options.draftLength, rhoForTheory)
      : null,
    claimedSpeedup: options.claimedSpeedup,
    attentionOptimalDraftLength,
    tileAligned,
    tileAlignedDraftLength,
    draftIncreaseDecision: (
      options.acceptLength !== null
      && options.draftLength !== null
      && options.nextAcceptLength !== null
      && options.nextDraftLength !== null
    )
      ? shouldIncreaseDraftLength({
        acceptLength: options.acceptLength,
        draftLength: options.draftLength,
        draftDepthRatio: rhoForTheory,
        nextAcceptLength: options.nextAcceptLength,
        nextDraftLength: options.nextDraftLength,
      })
      : null,
  };

  const findings = buildFindings(options, metrics, mechanism);
  const failCount = findings.filter((f) => f.severity === 'fail').length;
  const warnCount = findings.filter((f) => f.severity === 'warn').length;
  const recommendedGateIds = [...new Set(
    findings.map((f) => f.gateId).filter(Boolean)
  )];

  let status = 'ready';
  if (failCount > 0) status = 'fail';
  else if (warnCount > 0 || findings.some((f) => f.severity === 'info' && f.id !== 'draft_depth_ratio_assumed')) {
    status = 'actionable';
  } else if (
    options.speculativeDecoding
    && options.acceptLength !== null
    && options.acceptLength >= options.minAcceptLength
    && (options.claimedSpeedup === null
      || metrics.theoreticalSpeedup === null
      || options.claimedSpeedup <= metrics.theoreticalSpeedup + 1e-9)
  ) {
    status = 'ready';
  } else if (!options.speculativeDecoding && options.acceptLength === null) {
    status = 'ready';
  }

  return {
    name: 'thumbgate-nvidia-specdecode-al-doctor',
    status,
    source: SOURCE_URL,
    disclaimer: 'Process steal of AL/D co-design guidelines only. Not affiliated with NVIDIA. Does not ship TensorRT-LLM, EAGLE, or Model-Optimizer.',
    workload: options.workload,
    model: options.model,
    metrics,
    mechanism,
    findings,
    summary: {
      failCount,
      warnCount,
      findingCount: findings.length,
      recommendedGateCount: recommendedGateIds.length,
    },
    recommendedGates: recommendedGateIds,
    nextActions: [
      'Measure accept length (AL) on realistic agent prompts before claiming speculation speedup.',
      'Use speedup ≈ AL/(1+ρD); reject claims above that ceiling.',
      'For attention-heavy decode, start at D=128/G-1 and keep G×(1+D) tile-aligned.',
      'Increase D only while measured AL gains beat added draft overhead.',
      'Wire evidence through deepseek-v4-runtime-guardrails --speculative-decoding --accept-length=… and gate checkpoint-speculative-decoding-acceptance.',
    ],
    exampleCommand:
      'npx thumbgate nvidia-specdecode-al-doctor --speculative-decoding --accept-length=1.4 --draft-length=7 --draft-depth-ratio=0.05 --claimed-speedup=3 --query-heads-per-kv=8 --attention-dominated --json',
  };
}

function formatNvidiaSpecDecodeAlDoctorReport(report) {
  const lines = [
    '',
    'ThumbGate NVIDIA Speculative-Decoding AL/D Doctor',
    '-'.repeat(48),
    `Status  : ${report.status}`,
    `Workload: ${report.workload}`,
    `Model   : ${report.model}`,
    `Source  : ${report.source}`,
    `Findings: ${report.summary.findingCount} (fail=${report.summary.failCount}, warn=${report.summary.warnCount})`,
  ];

  if (report.metrics.acceptLength !== null) lines.push(`AL      : ${report.metrics.acceptLength}`);
  if (report.metrics.draftLength !== null) lines.push(`D       : ${report.metrics.draftLength}`);
  if (report.metrics.draftDepthRatio !== null) lines.push(`ρ       : ${report.metrics.draftDepthRatio}`);
  if (report.metrics.theoreticalSpeedup !== null) {
    lines.push(`Theory  : ${report.metrics.theoreticalSpeedup}x  (AL/(1+ρD))`);
  }
  if (report.metrics.claimedSpeedup !== null) lines.push(`Claimed : ${report.metrics.claimedSpeedup}x`);
  if (report.metrics.attentionOptimalDraftLength !== null) {
    lines.push(`D*(attn): ${report.metrics.attentionOptimalDraftLength}`);
  }
  if (report.metrics.tileAligned !== null) {
    lines.push(`Tile OK : ${report.metrics.tileAligned ? 'yes' : 'no'}`);
  }

  lines.push('', `Mechanism: ${report.mechanism.mechanism}`);
  lines.push(`  ${report.mechanism.reason}`);

  if (report.findings.length > 0) {
    lines.push('', 'Findings:');
    for (const finding of report.findings) {
      const gate = finding.gateId ? ` [${finding.gateId}]` : '';
      lines.push(`  - [${finding.severity}] ${finding.id}${gate}`);
      lines.push(`    ${finding.message}`);
    }
  }

  lines.push('', 'Next actions:');
  for (const action of report.nextActions) lines.push(`  - ${action}`);
  lines.push('', `Example: ${report.exampleCommand}`);
  lines.push(`Note: ${report.disclaimer}`, '');
  return `${lines.join('\n')}\n`;
}

function parseCliArgs(argv) {
  const options = {};
  for (const arg of argv) {
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--strict') {
      options.strict = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!m) continue;
    const key = m[1];
    const raw = m[2] === undefined ? true : m[2];
    options[key] = raw;
  }
  return options;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/nvidia-specdecode-al-doctor.js [flags]

Flags:
  --speculative-decoding          Speculation path is active
  --accept-length=AL              Measured acceptance length
  --draft-length=D                Draft tokens per target iteration
  --draft-depth-ratio=ρ           L_draft / L_target (default 0 for theory)
  --claimed-speedup=X             Throughput claim to check against AL/(1+ρD)
  --min-accept-length=N           Floor before production (default 2)
  --query-heads-per-kv=G          Attention group size G
  --attention-dominated           Apply D=128/G-1 + tile guidance
  --latency-region=low|throughput Pareto region hint for mechanism pick
  --model-size=small|medium|large Mechanism sizing hint
  --repetitive                    Prefer suffix/n-gram drafts
  --next-accept-length / --next-draft-length
                                  Guideline-4 compare for raising D
  --cache-coherence-eval          Rollback/coherence evidence present
  --strict                        Exit 1 on fail/actionable
  --json                          Machine-readable report

Source: ${SOURCE_URL}
`);
}

function runCli(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  const report = buildNvidiaSpecDecodeAlDoctorReport(args);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatNvidiaSpecDecodeAlDoctorReport(report));
  }
  if (args.strict && report.status !== 'ready') return 1;
  if (report.status === 'fail') return 1;
  return 0;
}

module.exports = {
  ATTENTION_TILE,
  DEFAULT_MIN_ACCEPT_LENGTH,
  SOURCE_URL,
  optimalDraftLengthForAttention,
  isTileAligned,
  nearestTileAlignedDraftLength,
  draftOverhead,
  theoreticalSpeedup,
  shouldIncreaseDraftLength,
  recommendDraftMechanism,
  normalizeOptions,
  buildNvidiaSpecDecodeAlDoctorReport,
  formatNvidiaSpecDecodeAlDoctorReport,
  parseCliArgs,
  runCli,
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  process.exitCode = runCli(process.argv.slice(2));
}
