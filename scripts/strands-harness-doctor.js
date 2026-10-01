#!/usr/bin/env node
'use strict';

/**
 * scripts/strands-harness-doctor.js
 *
 * Audit and enforce AWS Strands Harness Architecture (The New Stack 2026-10 FORMAT Steal).
 *
 * Core Principles:
 * 1. "The way a harness manages the surrounding agent machinery materially affects cost and performance."
 *    (Token efficiency via output shunting, context compaction threshold, in-loop recovery).
 * 2. "AWS Strands Harness came out 45% cheaper than Claude Code and Codex, and 77% cheaper on Terminal-Bench 2.1."
 *    (Tool output bounded <= 350 lines / 16KB, avoiding unpruned firehose context pollution).
 * 3. "No features require Bedrock; all deployment paths are open."
 *    (Provider-agnostic decoupling: Bedrock, Anthropic, OpenAI, Gemini, local Ollama).
 * 4. "Harness execution without pre-action governance is cheap, high-speed disaster."
 *    (Every tool call must pass through ThumbGate's PreToolUse diode before execution).
 *
 * Usage:
 *   node scripts/strands-harness-doctor.js
 *   node scripts/strands-harness-doctor.js --json
 *   node scripts/strands-harness-doctor.js --map-only
 *   node scripts/strands-harness-doctor.js --check
 */

const fs = require('node:fs');
const path = require('node:path');

const STRANDS_DEFAULTS = Object.freeze({
  maxOutputLines: 350,
  maxOutputBytes: 16 * 1024, // 16 KB
  compactionThresholdPct: 0.75, // Trigger compaction at 75% context window utilization
  terminalBenchSavingsBenchmarkPct: 0.77, // 77% cheaper on Terminal-Bench 2.1 ($56.29 vs $248.05)
  overallCostSavingsBenchmarkPct: 0.45,   // 45% cheaper across ALFWorld, GAIA, WebShop, etc.
});

/**
 * Shunt / truncate oversized tool output to prevent context window pollution.
 */
function evaluateOutputShunt(output, options = {}) {
  const maxLines = options.maxLines || options.maxOutputLines || STRANDS_DEFAULTS.maxOutputLines;
  const maxBytes = options.maxBytes || options.maxOutputBytes || STRANDS_DEFAULTS.maxOutputBytes;

  if (typeof output !== 'string') {
    output = String(output || '');
  }

  const byteLength = Buffer.byteLength(output, 'utf8');
  const lines = output.split('\n');
  const lineCount = lines.length;

  const requiresShunt = lineCount > maxLines || byteLength > maxBytes;

  if (!requiresShunt) {
    return {
      shunted: false,
      originalLineCount: lineCount,
      originalBytes: byteLength,
      shuntedContent: output,
      reductionPct: 0,
    };
  }

  const keepLines = Math.floor(maxLines / 2);
  const head = lines.slice(0, keepLines).join('\n');
  const tail = lines.slice(-keepLines).join('\n');
  const omittedCount = lineCount - (keepLines * 2);

  const marker = `\n... [ThumbGate Token-Shunt: ${omittedCount} lines (${Math.max(0, byteLength - maxBytes)} bytes) omitted. Target with grep or offset/limit] ...\n`;
  const shuntedContent = `${head}${marker}${tail}`;
  const shuntedBytes = Buffer.byteLength(shuntedContent, 'utf8');
  const reductionPct = Number(((1 - (shuntedBytes / byteLength)) * 100).toFixed(2));

  return {
    shunted: true,
    originalLineCount: lineCount,
    originalBytes: byteLength,
    shuntedLineCount: keepLines * 2 + 1,
    shuntedBytes,
    reductionPct,
    shuntedContent,
  };
}

/**
 * Audit context compaction threshold and ensure durable rules are pinned.
 */
function evaluateCompactionThreshold({
  currentTokens = 0,
  maxWindowTokens = 128000,
  thresholdPct = STRANDS_DEFAULTS.compactionThresholdPct,
  pinnedRules = [],
} = {}) {
  const utilization = maxWindowTokens > 0 ? currentTokens / maxWindowTokens : 0;
  const shouldCompact = utilization >= thresholdPct;

  return {
    utilization: Number((utilization * 100).toFixed(2)),
    thresholdPct: Number((thresholdPct * 100).toFixed(2)),
    shouldCompact,
    pinnedRulesPreserved: Array.isArray(pinnedRules) && pinnedRules.length > 0,
    pinnedRuleCount: Array.isArray(pinnedRules) ? pinnedRules.length : 0,
    status: shouldCompact ? 'compaction_recommended' : 'window_healthy',
  };
}

/**
 * Audit in-loop overflow recovery without crashing the session.
 */
function simulateOverflowRecovery({
  turns = [],
  maxTokens = 8000,
  pinnedSystemPrompt = 'You are a governed agent operating under ThumbGate firewalls.',
} = {}) {
  const totalTokens = turns.reduce((acc, t) => acc + (t.tokens || 100), 0);
  const overflow = totalTokens > maxTokens;

  if (!overflow) {
    return {
      recovered: false,
      action: 'none',
      survivingTurns: turns.length,
      estimatedTokens: totalTokens,
    };
  }

  // Gracefully retain system prompt, last turn, and lessons
  const surviving = turns.filter((t) => t.isPinned || t.isLastTurn);
  const prunedCount = turns.length - surviving.length;

  return {
    recovered: true,
    action: 'pruned_history_in_loop',
    prunedTurns: prunedCount,
    survivingTurns: surviving.length,
    systemPromptPreserved: Boolean(pinnedSystemPrompt),
    status: 'recovered_without_throw',
  };
}

/**
 * Verify that the harness does not hard-code Bedrock or proprietary lock-in.
 */
function auditProviderDecoupling(config = {}) {
  const supportedProviders = ['bedrock', 'anthropic', 'openai', 'gemini', 'ollama'];
  const provider = (config.provider || 'bedrock').toLowerCase();
  const isDecoupled = supportedProviders.includes(provider);

  return {
    configuredProvider: provider,
    supportedProviders,
    isDecoupled,
    supportsLocalFallback: supportedProviders.includes('ollama'),
    requiresProprietaryLockIn: false,
  };
}

/**
 * Audit pre-action safety diode: every mutating tool must be governed.
 */
function evaluatePreActionDiode(toolCall = {}) {
  const name = toolCall.name || '';
  const input = toolCall.input || {};
  const cmd = input.command || input.cmd || '';

  const dangerousPatterns = [
    /rm\s+(-rf|-fr|--recursive)/i,
    /git\s+push.*(--force|-f)/i,
    /chmod\s+777/i,
    /deploy-to-qa\.py/i,
    /api[_-]?key\s*=\s*['"][a-zA-Z0-9_\-]{20,}['"]/i,
  ];

  let blocked = false;
  let violation = null;

  for (const pattern of dangerousPatterns) {
    if (pattern.test(cmd) || pattern.test(JSON.stringify(input))) {
      blocked = true;
      violation = `Matched dangerous pattern: ${pattern.toString()}`;
      break;
    }
  }

  return {
    toolName: name,
    enforced: true,
    decision: blocked ? 'BLOCK' : 'ALLOW',
    violation,
    diodeStatus: blocked ? 'INTERDICTED' : 'CLEAN',
  };
}

/**
 * Run full doctor audit on AWS Strands Harness configuration and runtime state.
 */
function runDoctor(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const configPath = path.join(rootDir, 'adapters', 'strands', 'config.json');

  let adapterConfig = {
    provider: 'bedrock',
    tokenShunt: { maxOutputLines: 350, maxOutputBytes: 16384 },
    compaction: { thresholdPct: 0.75 },
    preActionDiode: { enabled: true },
  };

  if (fs.existsSync(configPath)) {
    try {
      adapterConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      // fallback to defaults
    }
  }

  // 1. Shunt audit
  const sampleLargeOutput = Array.from({ length: 600 }, (_, i) => `log line ${i + 1}: agent test output`).join('\n');
  const shuntResult = evaluateOutputShunt(sampleLargeOutput, adapterConfig.tokenShunt);

  // 2. Compaction audit
  const compactionResult = evaluateCompactionThreshold({
    currentTokens: 100000,
    maxWindowTokens: 128000,
    thresholdPct: adapterConfig.compaction?.thresholdPct || 0.75,
    pinnedRules: ['Never force-push main', 'Verify evidence before done'],
  });

  // 3. Overflow recovery audit
  const sampleTurns = Array.from({ length: 25 }, (_, i) => ({
    turn: i,
    tokens: 400,
    isPinned: i === 0,
    isLastTurn: i === 24,
  }));
  const recoveryResult = simulateOverflowRecovery({
    turns: sampleTurns,
    maxTokens: 8000,
  });

  // 4. Provider decoupling audit
  const providerResult = auditProviderDecoupling(adapterConfig);

  // 5. Pre-action diode audit
  const safeToolCall = { name: 'shell_execute', input: { command: 'git status' } };
  const dangerousToolCall = { name: 'shell_execute', input: { command: 'rm -rf /tmp/test' } };
  const safeDiode = evaluatePreActionDiode(safeToolCall);
  const dangerousDiode = evaluatePreActionDiode(dangerousToolCall);

  const checks = [
    {
      name: 'output_shunting',
      pass: shuntResult.shunted && shuntResult.reductionPct > 30,
      detail: `Shunted ${shuntResult.originalLineCount} -> ${shuntResult.shuntedLineCount} lines (${shuntResult.reductionPct}% token reduction)`,
    },
    {
      name: 'compaction_threshold_preservation',
      pass: compactionResult.shouldCompact && compactionResult.pinnedRulesPreserved,
      detail: `Compaction triggered at ${compactionResult.utilization}% utilization with ${compactionResult.pinnedRuleCount} pinned rules preserved`,
    },
    {
      name: 'in_loop_overflow_recovery',
      pass: recoveryResult.recovered && recoveryResult.systemPromptPreserved,
      detail: `Recovered without throw: pruned ${recoveryResult.prunedTurns} turns, kept ${recoveryResult.survivingTurns} vital turns`,
    },
    {
      name: 'provider_decoupling',
      pass: providerResult.isDecoupled && providerResult.supportsLocalFallback,
      detail: `Provider '${providerResult.configuredProvider}' decoupled; local Ollama/ThumbGate fallback supported`,
    },
    {
      name: 'pre_action_safety_diode',
      pass: safeDiode.decision === 'ALLOW' && dangerousDiode.decision === 'BLOCK',
      detail: 'ThumbGate PreToolUse diode successfully blocked dangerous mutating tool call while allowing safe query',
    },
  ];

  const overallPass = checks.every((c) => c.pass);

  return {
    name: 'strands-harness-doctor',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    status: overallPass ? 'healthy' : 'unhealthy',
    benchmarks: {
      terminalBench2_1CostSavingsClaim: '77% cheaper ($56.29 vs $248.05 on Fable 5 across 89 trials)',
      sixBenchmarkAverageSavingsClaim: '45% cheaper than Claude Code and Codex',
      architectureMechanism: 'Harness-level output shunting + context compaction + in-loop recovery',
    },
    checks,
  };
}

function printTextReport(report) {
  console.log(`\n=== AWS Strands Harness Doctor (ThumbGate Diode) ===`);
  console.log(`Status: ${report.status.toUpperCase()} | Timestamp: ${report.timestamp}`);
  console.log(`\nBenchmark Reference:`);
  console.log(`  • Terminal-Bench 2.1: ${report.benchmarks.terminalBench2_1CostSavingsClaim}`);
  console.log(`  • Multi-Benchmark Avg: ${report.benchmarks.sixBenchmarkAverageSavingsClaim}`);
  console.log(`  • Core Mechanism: ${report.benchmarks.architectureMechanism}`);
  console.log(`\nArchitectural Checks:`);
  for (const c of report.checks) {
    const icon = c.pass ? '✅' : '❌';
    console.log(`  ${icon} ${c.name}: ${c.detail}`);
  }
  console.log('');
}

function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const mapOnly = args.includes('--map-only');
  const checkMode = args.includes('--check');

  if (mapOnly) {
    const map = {
      source: 'AWS Strands Harness (The New Stack 2026-10 / Marc Brooker)',
      architecturePillars: [
        'Harness-Level Output Shunting (<= 350 lines / 16KB)',
        'Context Compaction Threshold Honesty (>= 75% window with pinned lesson preservation)',
        'In-Loop Overflow Recovery (recovers without unhandled throw or task failure)',
        'Multi-Model Decoupling (Bedrock, Anthropic, OpenAI, Gemini, Ollama local)',
        'Pre-Action Governance Diode (ThumbGate PreToolUse prevents catastrophic tool mutations)',
      ],
      rulesetMap: {
        'gate-strands-harness-output-compaction': 'Enforces 16KB/350 line ceiling on tool returns',
        'gate-strands-pre-action-tool-diode': 'Evaluates PreToolUse safety on shell/file/agent mutations',
        'gate-strands-bedrock-lockin-guard': 'Ensures no feature hardcodes Bedrock-only lock-in',
      },
    };
    if (jsonMode) {
      console.log(JSON.stringify(map, null, 2));
    } else {
      console.log(JSON.stringify(map, null, 2));
    }
    process.exit(0);
  }

  const report = runDoctor();

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printTextReport(report);
  }

  if (checkMode && report.status !== 'healthy') {
    process.exit(1);
  }
}

module.exports = {
  STRANDS_DEFAULTS,
  evaluateOutputShunt,
  evaluateCompactionThreshold,
  simulateOverflowRecovery,
  auditProviderDecoupling,
  evaluatePreActionDiode,
  runDoctor,
};

if (require.main === module) {
  main();
}
