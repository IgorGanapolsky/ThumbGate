#!/usr/bin/env node
'use strict';

/**
 * ThumbGate Latency Budget CLI & Hop-Level SLA Auditor
 */

const path = require('node:path');
const { LatencyTracker, PROFILES } = require('../src/latency-budget.js');

function parseArgs(args) {
  const options = {
    profile: 'standard_agent',
    sample: null,
    benchmark: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--benchmark') {
      options.benchmark = true;
    } else if (arg === '--profile') {
      options.profile = args[++i];
    } else if (arg === '--sample') {
      try {
        options.sample = JSON.parse(args[++i]);
      } catch (err) {
        console.error('Invalid JSON for --sample:', err.message);
        process.exit(1);
      }
    }
  }

  return options;
}

const VALID_SAMPLE_PHASES = new Set([
  'reasoning_inference',
  'governance_gate',
  'tool_dispatch_transport',
  'cpu_data_processing',
  'memory_recall',
]);

function runBenchmark(tracker) {
  // Simulate standard 500ms enterprise agent cycle
  tracker.recordHop('reasoning_inference', 180, 'LLM initial step');
  tracker.recordHop('governance_gate', 4, 'ThumbGate local pre-action check');
  tracker.recordHop('tool_dispatch_transport', 65, 'MCP tool dispatch');
  tracker.recordHop('cpu_data_processing', 40, 'JSON filtering & transformation');
  tracker.recordHop('memory_recall', 15, 'LanceDB vector similarity');
}

/**
 * Validate --sample payload. Rejects non-arrays and malformed hops.
 * @param {*} sample
 * @returns {Array<{phase: string, durationMs: number, label?: string, metadata?: Object}>}
 */
function validateSampleHops(sample) {
  if (!Array.isArray(sample)) {
    throw new Error('--sample must be a JSON array of hop objects [{ phase, durationMs, label }]');
  }
  if (sample.length === 0) {
    throw new Error('--sample array must contain at least one hop object');
  }

  return sample.map((hop, index) => {
    if (!hop || typeof hop !== 'object' || Array.isArray(hop)) {
      throw new Error(`--sample[${index}] must be an object with phase and durationMs`);
    }
    const phase = hop.phase;
    if (typeof phase !== 'string' || !phase.trim()) {
      throw new Error(`--sample[${index}].phase must be a non-empty string`);
    }
    if (!VALID_SAMPLE_PHASES.has(phase)) {
      throw new Error(
        `--sample[${index}].phase must be one of: ${[...VALID_SAMPLE_PHASES].join(', ')}`,
      );
    }
    if (typeof hop.durationMs !== 'number' || !Number.isFinite(hop.durationMs)) {
      throw new Error(`--sample[${index}].durationMs must be a finite number`);
    }
    return hop;
  });
}

function main() {
  const args = process.argv.slice(2);
  const opts = parseArgs(args);

  if (opts.help) {
    console.log(`ThumbGate Latency Budget — Hop-Level SLA & CPU Bottleneck Auditor

Usage:
  thumbgate latency-budget [--profile standard_agent|interactive_voice|batch_workflow] [--json]
  thumbgate latency-budget --benchmark [--profile <name>] [--json]
  thumbgate latency-budget --sample <json-hops-array> [--json]

Options:
  --profile <name>  SLA profile to evaluate (standard_agent: 500ms, interactive_voice: 250ms, batch_workflow: 5000ms)
  --benchmark       Run standard local fast-path benchmark
  --sample <json>   Evaluate an array of hop objects [{ phase, durationMs, label }]
  --json            Emit structured JSON report
  --help, -h        Show this help text
`);
    process.exit(0);
  }

  const tracker = new LatencyTracker(opts.profile);

  if (opts.sample !== null) {
    let hops;
    try {
      hops = validateSampleHops(opts.sample);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
    for (const h of hops) {
      tracker.recordHop(h.phase, h.durationMs, h.label || h.phase, h.metadata || {});
    }
  } else {
    runBenchmark(tracker);
  }

  const report = tracker.analyze();

  if (opts.json) {
    console.log(JSON.stringify({ ...report, otelAttributes: tracker.exportOtelAttributes() }, null, 2));
  } else {
    console.log(`\n⏱️  ThumbGate Latency Budget Report [${report.profile.toUpperCase()}]`);
    console.log(`──────────────────────────────────────────────────────────`);
    console.log(`  SLA Target     : <= ${report.slaMs}ms (${report.meetsSla ? '✅ MET' : '❌ BREACHED'})`);
    console.log(`  Total Duration : ${report.totalDurationMs}ms (across ${report.hopCount} hops)`);
    console.log(`  GPU Inference  : ${report.gpuDurationMs}ms (${Math.round((report.gpuDurationMs / (report.totalDurationMs || 1)) * 100)}%)`);
    console.log(`  CPU/Transport  : ${report.cpuDurationMs}ms (${Math.round(report.cpuRatio * 100)}%) ${report.cpuBottleneck ? '⚠️  BOTTLENECK' : '✅ HEALTHY'}`);
    console.log(`\n  Phase Breakdown:`);
    for (const [phase, dur] of Object.entries(report.phaseTotals)) {
      console.log(`    - ${phase.padEnd(25)} : ${dur}ms`);
    }
    if (report.recommendations.length > 0) {
      console.log(`\n  Optimization Directives:`);
      for (const rec of report.recommendations) {
        console.log(`    👉 ${rec}`);
      }
    }
    console.log('');
  }

  process.exit(report.meetsSla ? 0 : 1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  main();
}

module.exports = { parseArgs, main, validateSampleHops, VALID_SAMPLE_PHASES };
