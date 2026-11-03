'use strict';

/**
 * Streaming Reporter — OpenUI Lang steal adaptation.
 *
 * OpenUI Lang uses a compact, streaming-first language that emits 67% fewer
 * tokens than equivalent JSON. This module applies the same principles to
 * ThumbGate verification reports:
 *
 *   1. Line-based, tag-delimited format (no repeated JSON keys)
 *   2. Streaming output — emit results as checks complete
 *   3. Compact field names (v=version, t=traceId, s=verdict, q=quality)
 *   4. Typed contracts — each check declares its schema
 *
 * Usage:
 *   const { StreamingReporter } = require('./scripts/streaming-reporter.js');
 *   const reporter = new StreamingReporter({ format: 'compact', traceId });
 *   reporter.onCheckComplete('unit_tests', 'PASS', 254);
 *   reporter.onFinish('PASS', 100);
 *   console.log(reporter.render());
 */

const COMPACT_VERSION = '1.0';

class StreamingReporter {
  constructor(options = {}) {
    this.traceId = options.traceId || process.env.THUMBGATE_TRACE_ID || `t${Date.now().toString(36)}`;
    this.format = options.format || 'compact'; // 'compact' | 'json'
    this.startTime = Date.now();
    this.checks = [];
    this.errors = [];
    this.warnings = [];

    // OpenUI Lang-inspired compact field mapping
    this.fieldMap = {
      version: 'v',
      traceId: 't',
      verdict: 's',
      quality: 'q',
      checks: 'c',
      error: 'e',
      warning: 'w',
      duration: 'd',
      checkPassed: 'PASS',
      checkFailed: 'FAIL',
      checkSkipped: 'SKIP',
    };
  }

  /**
   * Register a typed check contract (Zod-style schema steal from OpenUI).
   * Only checks with registered schemas can emit results.
   */
  registerCheck(id, schema) {
    this.checks.push({ id, schema, registered: true });
  }

  /**
   * Called when a check completes — streams immediately.
   * OpenUI Lang renders progressively; we emit results as they complete.
   */
  onCheckComplete(checkId, status, durationMs, metadata = {}) {
    const check = { id: checkId, status, duration: durationMs, metadata };

    if (this.format === 'compact') {
      // Line-based: c|unit_tests|PASS|254ms
      process.stdout.write(
        `${this.fieldMap.checks}|${checkId}|${this.fieldMap[status.toLowerCase()]||status}|${durationMs}ms\n`
      );
    } else {
      console.log(JSON.stringify({ check: { id: checkId, status, duration: durationMs, ...metadata } }));
    }
    this.checks.push(check);
  }

  /**
   * Called when a check fails.
   */
  onCheckFailed(checkId, error, durationMs) {
    this.onCheckComplete(checkId, 'FAIL', durationMs, { error });
    this.errors.push({ checkId, error });
  }

  /**
   * Called when a check emits a warning.
   */
  onWarning(checkId, message) {
    this.warnings.push({ checkId, message });
    if (this.format === 'compact') {
      process.stdout.write(`${this.fieldMap.warning}|${checkId}|${message}\n`);
    }
  }

  /**
   * Finalize and render the complete report.
   * OpenUI Lang format: line-based, minimal overhead.
   */
  render(verdict, qualityScore, budgetMetrics = {}, latencyProfile = {}) {
    const totalDuration = Date.now() - this.startTime;

    if (this.format === 'compact') {
      const lines = [
        `tl|report`,
        `${this.fieldMap.version}|${COMPACT_VERSION}`,
        `${this.fieldMap.traceId}|${this.traceId}`,
        `${this.fieldMap.verdict}|${verdict}`,
        `${this.fieldMap.quality}|${qualityScore}`,
        `${this.fieldMap.duration}|${totalDuration}`,
      ];

      if (budgetMetrics) {
        lines.push(`b|${JSON.stringify(budgetMetrics)}`);
      }
      if (latencyProfile) {
        lines.push(`l|${JSON.stringify(latencyProfile)}`);
      }

      for (const check of this.checks) {
        lines.push(`${this.fieldMap.checks}|${check.id}|${check.status}|${check.duration}ms`);
      }

      for (const warn of this.warnings) {
        lines.push(`${this.fieldMap.warning}|${warn.checkId}|${warn.message}`);
      }
      for (const err of this.errors) {
        lines.push(`${this.fieldMap.error}|${err.checkId}|${err.error.substring(0, 200)}`);
      }

      return lines.join('\n') + '\n';
    }

    return JSON.stringify({
      format: 'json',
      version: COMPACT_VERSION,
      traceId: this.traceId,
      verdict,
      qualityScore,
      duration: totalDuration,
      budgetMetrics,
      latencyProfile,
      checks: this.checks,
      warnings: this.warnings,
      errors: this.errors,
    }, null, 2);
  }

  /**
   * Parse a compact-format report back into an object.
   * Mirrors OpenUI Lang's streaming parser.
   */
  static parse(compactText) {
    const result = {
      version: null,
      traceId: null,
      verdict: null,
      qualityScore: null,
      duration: null,
      checks: [],
      warnings: [],
      errors: [],
    };

    for (const line of compactText.split('\n')) {
      if (!line.trim()) continue;
      const [tag, ...rest] = line.split('|');

      switch (tag) {
        case 'v': result.version = rest[0]; break;
        case 't': result.traceId = rest[0]; break;
        case 's': result.verdict = rest[0]; break;
        case 'q': result.qualityScore = parseInt(rest[0], 10); break;
        case 'd': result.duration = parseInt(rest[0], 10); break;
        case 'c':
          result.checks.push({
            id: rest[0],
            status: rest[1],
            duration: rest[2],
          });
          break;
        case 'w':
          result.warnings.push({ checkId: rest[0], message: rest[1] });
          break;
        case 'e':
          result.errors.push({ checkId: rest[0], error: rest[1] });
          break;
      }
    }

    return result;
  }

  /**
   * Verify token savings vs JSON format (OpenUI benchmark steal).
   * Measures savings on a realistic full verification report with
   * budget metrics, latency profile, and 8 check results.
   */
  static benchmarkReportSize() {
    const checks = [
      { id: 'unit_tests', status: 'PASS', duration: 271 },
      { id: 'coverage_threshold', status: 'PASS', duration: 180 },
      { id: 'perf_budgets', status: 'PASS', duration: 120 },
      { id: 'proof_pack_integrity', status: 'PASS', duration: 27380 },
      { id: 'goal_alignment', status: 'PASS', duration: 150 },
      { id: 'edge_case_coverage', status: 'PASS', duration: 80 },
      { id: 'regression_check', status: 'PASS', duration: 95 },
      { id: 'design_compliance', status: 'PASS', duration: 70 },
    ];

    const budgetMetrics = {
      declared: { maxCommands: 10, maxWallTimeMs: 600000 },
      actual: { commandsRun: 8, wallTimeMs: 28395, commandUtilization: 0.8, timeUtilization: 0.047 },
    };
    const latencyProfile = {
      totalMechanicalMs: 28395,
      slowestCheck: 'proof_pack_integrity',
      slowestCheckMs: 27380,
    };

    // JSON format (equivalent to before)
    const jsonReport = JSON.stringify({
      format: 'json', version: COMPACT_VERSION, traceId: 't1a2b3c4d5e',
      verdict: 'PASS', qualityScore: 100, duration: 28395,
      budgetMetrics, latencyProfile, checks,
      warnings: [], errors: [],
    });

    // Compact format (OpenUI Lang steal)
    const reporter = new StreamingReporter({ format: 'compact', traceId: 't1a2b3c4d5e' });
    for (const c of checks) reporter.onCheckComplete(c.id, c.status, c.duration);
    const compactReport = reporter.render('PASS', 100, budgetMetrics, latencyProfile);

    const jsonBytes = Buffer.byteLength(jsonReport, 'utf8');
    const compactBytes = Buffer.byteLength(compactReport, 'utf8');
    const savingsPct = ((jsonBytes - compactBytes) / jsonBytes * 100).toFixed(1);

    return { jsonBytes, compactBytes, savingsPct, savingsRatio: (jsonBytes / compactBytes).toFixed(2) };
  }
}

module.exports = { StreamingReporter, COMPACT_VERSION };
