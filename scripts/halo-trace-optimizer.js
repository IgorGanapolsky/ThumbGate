#!/usr/bin/env node
'use strict';

/**
 * HALO Trace Optimization FORMAT steal — not a product clone.
 *
 * Source: https://inference.net/products/halo/
 *
 * Core Concept:
 *   Analyze agent trace logs -> identify repeated failure modes (redundant tool calls,
 *   retry thrash, expensive spans, unhandled denies) -> rank failure modes by impact ->
 *   synthesize concrete pre-action gates & executable evals.
 *
 * Maps onto existing ThumbGate rails:
 *   - scripts/auto-promote-gates.js
 *   - scripts/agent-action-inventory.js
 *   - scripts/gates-engine.js
 *   - scripts/silent-failure-cluster.js
 *   - .thumbgate/auto-promoted-gates.json
 *
 * Anti-Clone Safeguards:
 *   - Never install Inference.net catalyst SDK or cloud OTLP exporter.
 *   - Pure local analysis over local audit-trail.jsonl and trace logs.
 *   - Fail closed if --clone-halo or third-party cloud SDK attempted.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const SOURCE_URL = 'https://inference.net/products/halo/';

const CLONE_PATTERNS = Object.freeze([
  { id: 'halo_engine_import', re: /\bfrom\s+engine\.(agents|models|engine_config)\b/i },
  { id: 'inference_net_api', re: /\b(api\.inference\.net|inference-app-icon|catalyst\.inference\.net)\b/i },
  { id: 'clone_sku', re: /\b(clone|install|vendor)\b.{0,40}\bhalo (agent )?optimization\b/i },
  { id: 'cloud_trace_export', re: /\b(stream_engine_output_async|otlp_catalyst_export)\b/i },
]);

const FAILURE_MODE_WEIGHTS = Object.freeze({
  redundant_tool_calls: 3,
  retry_stall: 4,
  expensive_span: 2,
  unhandled_denies: 5,
});

function detectCloneAttempt(text) {
  const t = String(text || '');
  return CLONE_PATTERNS.filter((p) => p.re.test(t)).map((p) => p.id);
}

function resolveTraceLogPaths(customTracePath) {
  if (customTracePath) {
    const resolved = path.resolve(customTracePath);
    return fs.existsSync(resolved) ? [resolved] : [];
  }

  const paths = [
    path.join(process.cwd(), '.thumbgate', 'audit-trail.jsonl'),
    path.join(process.cwd(), '.thumbgate', 'action-log.jsonl'),
    path.join(os.homedir(), '.thumbgate', 'audit-trail.jsonl'),
  ];

  return paths.filter((p) => fs.existsSync(p));
}

function parseJsonlFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8').trim();
    if (!content) return [];
    return content
      .split('\n')
      .map((line) => {
        try {
          return JSON.parse(line.trim());
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function extractActionString(entry) {
  if (!entry || typeof entry !== 'object') return '';
  if (entry.toolInput) {
    if (typeof entry.toolInput === 'string') return entry.toolInput;
    if (entry.toolInput.command) return String(entry.toolInput.command);
    if (entry.toolInput.file_path) return String(entry.toolInput.file_path);
    if (entry.toolInput.query) return String(entry.toolInput.query);
    try {
      return JSON.stringify(entry.toolInput);
    } catch {
      return '';
    }
  }
  if (entry.command) return String(entry.command);
  if (entry.input) return String(entry.input);
  return '';
}

function normalizeActionString(str) {
  return String(str || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * 1. Redundant Tool Thrashing Detection
 * Identifies 3+ repeated calls to the same tool with identical or near-identical action.
 */
function detectRedundantToolCalls(entries) {
  const findings = [];
  const sessionBuckets = new Map();

  for (const entry of entries) {
    const sId = entry.sessionId || entry.session_id || 'default';
    if (!sessionBuckets.has(sId)) sessionBuckets.set(sId, []);
    sessionBuckets.get(sId).push(entry);
  }

  for (const [sessionId, sessionEntries] of sessionBuckets.entries()) {
    const runCounts = new Map();
    for (const entry of sessionEntries) {
      const tool = entry.toolName || entry.tool_name || 'unknown';
      const action = normalizeActionString(extractActionString(entry));
      if (!action || action.length < 3) continue;

      const key = `${tool}::${action}`;
      runCounts.set(key, (runCounts.get(key) || 0) + 1);
    }

    for (const [key, count] of runCounts.entries()) {
      if (count >= 3) {
        const [tool, action] = key.split('::');
        findings.push({
          type: 'redundant_tool_calls',
          sessionId,
          tool,
          action,
          occurrences: count,
          severity: count >= 5 ? 'high' : 'medium',
          summary: `Tool "${tool}" called ${count} times with identical action: "${action.slice(0, 80)}"`,
        });
      }
    }
  }

  return findings;
}

/**
 * 2. Cascading Retry Stalls Detection
 * Identifies a failing tool call (exit != 0, deny, error) followed immediately by identical retry.
 */
function detectRetryStalls(entries) {
  const findings = [];
  let prevEntry = null;

  for (const entry of entries) {
    if (!prevEntry) {
      prevEntry = entry;
      continue;
    }

    const prevFailed =
      prevEntry.decision === 'deny' ||
      prevEntry.exitCode > 0 ||
      Boolean(prevEntry.error) ||
      prevEntry.status === 'failure';

    if (prevFailed) {
      const prevTool = prevEntry.toolName || prevEntry.tool_name || '';
      const currTool = entry.toolName || entry.tool_name || '';
      const prevAction = normalizeActionString(extractActionString(prevEntry));
      const currAction = normalizeActionString(extractActionString(entry));

      if (prevTool === currTool && prevAction && prevAction === currAction) {
        findings.push({
          type: 'retry_stall',
          sessionId: entry.sessionId || entry.session_id || 'default',
          tool: currTool,
          action: currAction,
          occurrences: 2,
          severity: 'high',
          summary: `Immediate duplicate retry of failed tool "${currTool}": "${currAction.slice(0, 80)}"`,
        });
      }
    }

    prevEntry = entry;
  }

  return findings;
}

/**
 * 3. Token / Span Blowout Detection
 * Identifies tool executions exceeding latency budgets (>10s) or generating huge dumps (>1000 lines).
 */
function detectExpensiveSpans(entries) {
  const findings = [];

  for (const entry of entries) {
    const latency = Number(entry.latencyMs || entry.duration_ms || 0);
    const lines = Number(entry.lineCount || (entry.toolInput && entry.toolInput.lines) || 0);
    const action = extractActionString(entry);

    if (latency >= 10000) {
      findings.push({
        type: 'expensive_span',
        sessionId: entry.sessionId || entry.session_id || 'default',
        tool: entry.toolName || entry.tool_name || 'unknown',
        action,
        metric: `${Math.round(latency / 1000)}s latency`,
        occurrences: 1,
        severity: latency >= 30000 ? 'high' : 'medium',
        summary: `Span exceeded 10s latency threshold (${latency}ms): "${action.slice(0, 80)}"`,
      });
    }

    if (lines >= 500) {
      findings.push({
        type: 'expensive_span',
        sessionId: entry.sessionId || entry.session_id || 'default',
        tool: entry.toolName || entry.tool_name || 'unknown',
        action,
        metric: `${lines} lines output`,
        occurrences: 1,
        severity: lines >= 1000 ? 'high' : 'medium',
        summary: `Span output exceeded 500 lines (${lines} lines, token-shunt risk): "${action.slice(0, 80)}"`,
      });
    }
  }

  return findings;
}

/**
 * 4. Unhandled Denies Detection
 * Identifies repeated triggers of the same gate ID.
 */
function detectUnhandledDenies(entries) {
  const findings = [];
  const gateCounts = new Map();

  for (const entry of entries) {
    if (entry.decision === 'deny' || entry.shadowDecision === 'block') {
      const gateId = entry.gateId || entry.gate_id || 'unknown-gate';
      gateCounts.set(gateId, (gateCounts.get(gateId) || 0) + 1);
    }
  }

  for (const [gateId, count] of gateCounts.entries()) {
    if (count >= 2) {
      findings.push({
        type: 'unhandled_denies',
        gateId,
        occurrences: count,
        severity: count >= 5 ? 'critical' : 'high',
        summary: `Gate "${gateId}" was triggered ${count} times without automated resolution`,
      });
    }
  }

  return findings;
}

/**
 * Rank failure modes by impact score: occurrences * severity_weight
 */
function rankFailureModes(findings) {
  return findings
    .map((f) => {
      const weight = FAILURE_MODE_WEIGHTS[f.type] || 1;
      const count = Number(f.occurrences || 1);
      const sevMultiplier = f.severity === 'critical' ? 3 : f.severity === 'high' ? 2 : 1;
      const impactScore = count * weight * sevMultiplier;
      return { ...f, impactScore };
    })
    .sort((a, b) => b.impactScore - a.impactScore);
}

/**
 * Synthesize concrete pre-action gate fix from a failure mode
 */
function synthesizeGateFix(failureMode) {
  const actionText = failureMode.action || failureMode.gateId || 'repeated_action';
  const cleanToken = actionText.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
  const hash = crypto.createHash('sha256').update(actionText).digest('hex').slice(0, 8);
  const gateId = `auto-promoted-halo-${cleanToken}-${hash}`.toLowerCase();

  let pattern = '';
  if (failureMode.type === 'redundant_tool_calls' || failureMode.type === 'retry_stall') {
    // Escape regex specials for literal matching of root command/action
    const escaped = actionText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 60);
    pattern = escaped.length > 0 ? `^${escaped}` : '.*';
  } else if (failureMode.type === 'expensive_span') {
    pattern = 'cat\\s+.*|head\\s+-[0-9]{4,}|tail\\s+-[0-9]{4,}';
  } else {
    pattern = `.*${cleanToken}.*`;
  }

  const suggestedAction = failureMode.severity === 'critical' || failureMode.severity === 'high' ? 'warn' : 'warn';
  const remediation = failureMode.type === 'retry_stall'
    ? 'Do not retry the exact failed command without modifying input or environment state.'
    : failureMode.type === 'redundant_tool_calls'
    ? 'Cached state is unchanged; proceed with the next task step instead of repeating the query.'
    : failureMode.type === 'expensive_span'
    ? 'Use targeted line ranges or token-shunt instead of full file dumps.'
    : 'Review active gate requirements before invoking.';

  return {
    id: gateId,
    pattern,
    action: suggestedAction,
    severity: failureMode.severity,
    reason: `HALO trace optimizer detected ${failureMode.type} (${failureMode.occurrences}x): ${failureMode.summary}`,
    remediation,
    source: 'halo-trace-optimizer',
    evalFixture: {
      input: { command: actionText },
      expectedAction: suggestedAction,
      expectedGate: gateId,
    },
  };
}

/**
 * Apply synthesized fixes to .thumbgate/auto-promoted-gates.json
 */
function applyFixes(fixes, options = {}) {
  const autoGatesPath =
    options.autoGatesPath ||
    path.join(process.cwd(), '.thumbgate', 'auto-promoted-gates.json');

  let currentConfig = { version: 1, gates: [], promotionLog: [] };
  if (fs.existsSync(autoGatesPath)) {
    try {
      currentConfig = JSON.parse(fs.readFileSync(autoGatesPath, 'utf8'));
    } catch {
      currentConfig = { version: 1, gates: [], promotionLog: [] };
    }
  }

  currentConfig.gates = Array.isArray(currentConfig.gates) ? currentConfig.gates : [];
  currentConfig.promotionLog = Array.isArray(currentConfig.promotionLog) ? currentConfig.promotionLog : [];

  const existingIds = new Set(currentConfig.gates.map((g) => g.id));
  const applied = [];

  for (const fix of fixes) {
    if (!existingIds.has(fix.id)) {
      const newGate = {
        id: fix.id,
        pattern: fix.pattern,
        action: fix.action,
        message: fix.reason,
        remediation: fix.remediation,
        severity: fix.severity,
        source: fix.source,
        promotedAt: new Date().toISOString(),
      };
      currentConfig.gates.push(newGate);
      currentConfig.promotionLog.push({
        id: fix.id,
        promotedAt: newGate.promotedAt,
        source: 'halo-trace-optimizer',
      });
      existingIds.add(fix.id);
      applied.push(fix.id);
    }
  }

  if (applied.length > 0) {
    const dir = path.dirname(autoGatesPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(autoGatesPath, JSON.stringify(currentConfig, null, 2) + '\n', 'utf8');
  }

  return applied;
}

function buildHaloTraceOptimizerReport(options = {}) {
  // 1. Anti-clone check
  const cloneDetected = detectCloneAttempt(options.cloneTarget || process.env.HALO_CLONE_MODE);
  if (cloneDetected.length > 0 || options['clone-halo'] || options.cloneHalo) {
    return {
      ok: false,
      name: 'halo-trace-optimizer',
      status: 'fail',
      source: SOURCE_URL,
      refusal: 'halo_clone_refused',
      reason: 'ThumbGate steals the HALO Trace-to-Fix FORMAT onto existing rails. We do not clone Inference.net catalyst or cloud OTLP dependencies.',
      cloneSignals: cloneDetected,
      rankedFailureModes: [],
      synthesizedFixes: [],
      applied: [],
    };
  }

  if (options['map-only'] || options.mapOnly) {
    return {
      ok: true,
      name: 'halo-trace-optimizer',
      status: 'ready',
      source: SOURCE_URL,
      refusal: null,
      mapping: {
        haloConcept: 'Analyze OpenTelemetry traces -> rank failure modes -> ship concrete fixes',
        thumbGateRail: 'Analyze local audit-trail.jsonl -> detect loops/stalls -> synthesize auto-promoted gates & evals',
        traceInputs: ['~/.thumbgate/audit-trail.jsonl', '.thumbgate/action-log.jsonl'],
        targetGateStore: '.thumbgate/auto-promoted-gates.json',
      },
      rankedFailureModes: [],
      synthesizedFixes: [],
      applied: [],
    };
  }

  // 2. Load trace entries
  const tracePaths = resolveTraceLogPaths(options.trace || options.tracePath);
  let entries = [];
  if (Array.isArray(options.entries)) {
    entries = options.entries;
  } else {
    for (const p of tracePaths) {
      entries.push(...parseJsonlFile(p));
    }
  }

  // 3. Detect failure modes
  const rawFindings = [
    ...detectRedundantToolCalls(entries),
    ...detectRetryStalls(entries),
    ...detectExpensiveSpans(entries),
    ...detectUnhandledDenies(entries),
  ];

  // 4. Rank failure modes
  const minOccurrences = Number(options['min-occurrences'] || options.minOccurrences || 1);
  const rankedFailureModes = rankFailureModes(rawFindings).filter((f) => f.occurrences >= minOccurrences);

  // 5. Synthesize concrete gate fixes
  const synthesizedFixes = rankedFailureModes.map(synthesizeGateFix);

  // 6. Apply if requested
  let applied = [];
  if (options.apply && synthesizedFixes.length > 0) {
    applied = applyFixes(synthesizedFixes, { autoGatesPath: options.autoGatesPath });
  }

  return {
    ok: true,
    name: 'halo-trace-optimizer',
    status: 'ready',
    source: SOURCE_URL,
    refusal: null,
    summary: {
      tracePaths,
      tracesAnalyzed: entries.length,
      failureModesFound: rankedFailureModes.length,
      appliedCount: applied.length,
    },
    rankedFailureModes,
    synthesizedFixes,
    applied,
  };
}

function formatHaloTraceOptimizerReport(report) {
  const lines = [
    '=== HALO Trace Optimizer (ThumbGate FORMAT Steal) ===',
    `source: ${report.source}`,
    `status: ${report.status}`,
  ];

  if (report.refusal) {
    lines.push(`refusal: ${report.refusal}`);
    lines.push(`reason: ${report.reason}`);
    return lines.join('\n') + '\n';
  }

  if (report.mapping) {
    lines.push('Architecture Mapping:');
    lines.push(`  HALO Concept   : ${report.mapping.haloConcept}`);
    lines.push(`  ThumbGate Rail : ${report.mapping.thumbGateRail}`);
    lines.push(`  Gate Store     : ${report.mapping.targetGateStore}`);
    return lines.join('\n') + '\n';
  }

  lines.push(`traces analyzed : ${report.summary.tracesAnalyzed}`);
  lines.push(`failure modes   : ${report.summary.failureModesFound}`);
  lines.push(`fixes applied   : ${report.summary.appliedCount}`);
  lines.push('');

  if (report.rankedFailureModes.length === 0) {
    lines.push('✓ No agent trace thrashing, retry stalls, or unhandled denies detected.');
  } else {
    lines.push('Top Ranked Failure Modes:');
    report.rankedFailureModes.slice(0, 5).forEach((m, idx) => {
      lines.push(`  [#${idx + 1}] (${m.type}) impact: ${m.impactScore} | severity: ${m.severity}`);
      lines.push(`      ${m.summary}`);
    });

    lines.push('');
    lines.push('Synthesized Gate Fixes:');
    report.synthesizedFixes.slice(0, 3).forEach((f, idx) => {
      lines.push(`  [Fix #${idx + 1}] ${f.id} [${f.action}]`);
      lines.push(`      pattern    : ${f.pattern}`);
      lines.push(`      remediation: ${f.remediation}`);
    });
  }

  return lines.join('\n') + '\n';
}

function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (const arg of args) {
    if (arg === '--json') options.json = true;
    else if (arg === '--map-only') options.mapOnly = true;
    else if (arg === '--apply') options.apply = true;
    else if (arg.startsWith('--trace=')) options.trace = arg.slice(8);
    else if (arg.startsWith('--min-occurrences=')) options.minOccurrences = Number(arg.slice(18));
    else if (arg === '--clone-halo') options.cloneHalo = true;
  }

  const report = buildHaloTraceOptimizerReport(options);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    process.stdout.write(formatHaloTraceOptimizerReport(report));
  }

  if (report.status === 'fail') process.exitCode = 1;
}

if (require.main === module) {
  main();
}

module.exports = {
  SOURCE_URL,
  CLONE_PATTERNS,
  detectCloneAttempt,
  detectRedundantToolCalls,
  detectRetryStalls,
  detectExpensiveSpans,
  detectUnhandledDenies,
  rankFailureModes,
  synthesizeGateFix,
  applyFixes,
  buildHaloTraceOptimizerReport,
  formatHaloTraceOptimizerReport,
};
