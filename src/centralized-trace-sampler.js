/**
 * Centralized Trace Sampler & Sequence Boundary Inspector.
 * 
 * Inspired by Maude Lemaire (Scaling Slack, GitHub, and Cursor):
 * "Avoid letting LLMs scatter trace sampling logic right before export (e.g. to Datadog)
 * to save costs, as it leads to severe duplication and blind spots; always sample in
 * one centralized place. Inspect async vs. sync boundaries manually (such as printing
 * and annotating end-to-end sequence diagrams for metrics like time-to-first-token)
 * rather than letting AI generate millions of noisy, unusable spans."
 */

'use strict';

const crypto = require('crypto');

class CentralizedTraceSampler {
  constructor(options = {}) {
    // Single centralized sampling rate (e.g. 0.10 for 10% sampling)
    this.defaultSamplingRate = options.samplingRate !== undefined ? options.samplingRate : 0.10;
    // High-priority paths that must always be sampled (1.0)
    this.alwaysSamplePaths = new Set(options.alwaysSamplePaths || ['/api/checkout', '/api/charge', '/api/deploy']);
    // Deterministic seed for trace hashing
    this.seed = options.seed || 'thumbgate-trace-seed';
  }

  /**
   * Evaluates sampling once at trace inception (Root Span).
   * Downstream child spans must inherit the root decision.
   */
  shouldSampleTrace(traceId, path = '', metadata = {}) {
    if (this.alwaysSamplePaths.has(path) || metadata.isError || metadata.isCritical) {
      return {
        sample: true,
        reason: 'CRITICAL_PATH_OVERRIDE',
        samplingRate: 1.0,
      };
    }

    if (this.defaultSamplingRate >= 1.0) {
      return { sample: true, reason: 'FULL_SAMPLING', samplingRate: 1.0 };
    }
    if (this.defaultSamplingRate <= 0.0) {
      return { sample: false, reason: 'ZERO_SAMPLING', samplingRate: 0.0 };
    }

    // Deterministic hash-based sampling on traceId to prevent split traces
    const hash = crypto.createHash('md5').update(`${traceId}:${this.seed}`).digest('hex');
    const hashInt = parseInt(hash.slice(0, 8), 16);
    const normalized = hashInt / 0xffffffff;

    const sample = normalized < this.defaultSamplingRate;
    return {
      sample,
      reason: sample ? 'DETERMINISTIC_HASH_SELECTED' : 'DETERMINISTIC_HASH_DROPPED',
      samplingRate: this.defaultSamplingRate,
      hashValue: normalized,
    };
  }

  /**
   * Lints code for anti-patterns: scattered sampling right before export
   */
  lintInstrumentation(codeString) {
    const findings = [];
    const lines = codeString.split('\n');

    const multiLineCheck = /(?:Math\.random\(\)\s*<\s*0\.\d+|sampleRate|shouldSample)[\s\S]{0,120}(?:exporter|datadog|otel|sendTrace)/i;
    if (multiLineCheck.test(codeString)) {
      findings.push({
        line: 1,
        severity: 'ERROR',
        message: 'Scattered trace sampling detected right before exporter. Traces must be sampled centrally at the root span.',
        snippet: codeString.trim().slice(0, 80),
      });
    }

    const scatteredSamplingRegex = /(Math\.random\(\)\s*<\s*0\.\d+|sampleRate|shouldSample)\s*(?:&&|;)?.*(?:exporter|datadog|otel|sendTrace)/i;
    const adHocMathRandom = /if\s*\(\s*Math\.random\(\)\s*<\s*\d+/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (scatteredSamplingRegex.test(line) && !findings.some(f => f.line === i + 1)) {
        findings.push({
          line: i + 1,
          severity: 'ERROR',
          message: 'Scattered trace sampling detected right before exporter. Traces must be sampled centrally at the root span.',
          snippet: line.trim(),
        });
      } else if (adHocMathRandom.test(line) && /trace|span|telemetry/i.test(codeString) && !findings.some(f => f.severity === 'ERROR')) {
        findings.push({
          line: i + 1,
          severity: 'WARNING',
          message: 'Ad-hoc Math.random() sampling in telemetry path. Use centralized trace sampler instead.',
          snippet: line.trim(),
        });
      }
    }

    return {
      clean: findings.length === 0,
      findings,
    };
  }

  /**
   * Builds an annotated ASCII / Markdown Sequence Diagram showing
   * Sync vs Async boundaries and Time-To-First-Token (TTFT) milestones.
   */
  generateSequenceDiagram(traceEvents = []) {
    let diagram = '```mermaid\nsequenceDiagram\n';
    diagram += '  autonumber\n';
    diagram += '  actor Client\n';
    diagram += '  participant Gateway as API Gateway (Sync)\n';
    diagram += '  participant Agent as Agent Harness (Sync/Async)\n';
    diagram += '  participant LLM as Model Inference\n';
    diagram += '  participant DB as Relational Store\n\n';

    let ttftMarked = false;

    for (const ev of traceEvents) {
      const from = ev.from || 'Gateway';
      const to = ev.to || 'Agent';
      const isAsync = Boolean(ev.isAsync);
      const arrow = isAsync ? '-->>' : '->>';
      const note = ev.note ? ` Note over ${to}: ${ev.note}` : '';

      diagram += `  ${from}${arrow}${to}: ${ev.label} (${ev.durationMs || 0}ms)\n`;
      if (note) diagram += ` ${note}\n`;

      if (ev.isTTFT && !ttftMarked) {
        diagram += `  Note over Client,LLM: ⚡ [TTFT Milestone: ${ev.cumulativeMs || 0}ms]\n`;
        ttftMarked = true;
      }
    }

    diagram += '```\n';
    return diagram;
  }
}

module.exports = {
  CentralizedTraceSampler,
};
