#!/usr/bin/env node
'use strict';

/**
 * Decision Trace — full observability for gate evaluations.
 *
 * Inspired by Ethan Mollick's observation that operators need to *see* what
 * the agent was thinking when it made a decision. ThumbGate already captures
 * what was blocked; Decision Trace adds:
 *
 *   1. Full audit of every evaluation (passes, blocks, AND near-misses)
 *   2. Near-miss detection: constraints that almost matched
 *   3. Session trace summaries: single-glance safety posture view
 *
 * Near-miss heuristic: extract literal tokens from a regex deny pattern,
 * count how many appear in the input. If >50% match but the full regex
 * doesn't, flag as near-miss.
 */

const crypto = require('node:crypto');
const path = require('node:path');
const { readJsonl, appendJsonl } = require('./fs-utils');
const { resolveFeedbackDir } = require('./feedback-paths');
const {
  evaluateConstraints,
  evaluateInvariants,
  loadSpecDir,
} = require('./spec-gate');

const TRACE_FILE = 'decision-trace.jsonl';
const NEAR_MISS_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------
// Near-Miss Detection
// ---------------------------------------------------------------------------

/**
 * Extract literal tokens from a regex pattern.
 * Strips metacharacters and splits on boundaries to find human-readable tokens.
 */
function extractLiteralTokens(pattern) {
  // Remove common regex metacharacters and quantifiers
  const cleaned = pattern
    .replace(/\\[sdwbSDWB]/g, ' ')       // char classes
    .replace(/[.*+?^${}()|[\]\\]/g, ' ') // metacharacters
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned
    .split(/\s+/)
    .filter((t) => t.length >= 2) // ignore single chars
    .map((t) => t.toLowerCase());
}

/**
 * Compute near-miss score for a constraint against input text.
 * Returns { isNearMiss, score, matchedTokens, totalTokens }.
 */
function computeNearMiss(constraint, inputText) {
  const tokens = extractLiteralTokens(constraint.deny);
  if (tokens.length === 0) {
    return { isNearMiss: false, score: 0, matchedTokens: 0, totalTokens: 0 };
  }

  const lower = String(inputText).toLowerCase();
  let matched = 0;
  for (const token of tokens) {
    if (lower.includes(token)) matched++;
  }

  const score = matched / tokens.length;
  return {
    isNearMiss: score >= NEAR_MISS_THRESHOLD && score < 1.0,
    score: Math.round(score * 100) / 100,
    matchedTokens: matched,
    totalTokens: tokens.length,
  };
}

// ---------------------------------------------------------------------------
// Trace Evaluation
// ---------------------------------------------------------------------------

/**
 * Build the combined input text used for near-miss detection.
 */
function buildCombinedInput({ tool, command, content } = {}) {
  return [command, content, tool].filter(Boolean).join(' ');
}

/**
 * Evaluate specs with full trace: passes, blocks, and near-misses.
 */
function traceEvaluation(specs, context = {}) {
  const traceId = `trace_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const timestamp = new Date().toISOString();
  const combinedInput = buildCombinedInput(context);
  const results = [];

  for (const spec of specs) {
    const constraintResults = evaluateConstraints(spec, context);
    const invariantResults = evaluateInvariants(spec, context);

    // Annotate constraint results with near-miss info
    for (const cr of constraintResults) {
      const constraint = spec.constraints.find((c) => c.id === cr.constraintId);
      let nearMiss = { isNearMiss: false, score: 0, matchedTokens: 0, totalTokens: 0 };

      if (cr.passed && constraint) {
        // Only compute near-miss for constraints that passed (weren't blocked)
        nearMiss = computeNearMiss(constraint, combinedInput);
      }

      results.push({
        ...cr,
        nearMiss: nearMiss.isNearMiss,
        nearMissScore: nearMiss.score,
        nearMissDetail: nearMiss.isNearMiss ? nearMiss : null,
      });
    }

    // Invariant results (no near-miss concept for invariants)
    for (const ir of invariantResults) {
      results.push({
        ...ir,
        nearMiss: false,
        nearMissScore: 0,
        nearMissDetail: null,
      });
    }
  }

  const blocked = results.filter((r) => !r.passed);
  const nearMisses = results.filter((r) => r.nearMiss);
  const passed = results.filter((r) => r.passed && !r.nearMiss);

  return {
    traceId,
    timestamp,
    allowed: blocked.length === 0,
    results,
    blocked,
    nearMisses,
    passed,
    counts: {
      total: results.length,
      blocked: blocked.length,
      nearMiss: nearMisses.length,
      passed: passed.length,
    },
    context: {
      tool: context.tool || null,
      command: truncate(context.command, 200),
      action: truncate(context.action, 200),
    },
  };
}

// ---------------------------------------------------------------------------
// Trace Persistence
// ---------------------------------------------------------------------------

function getTracePath({ feedbackDir } = {}) {
  const dir = feedbackDir || resolveFeedbackDir();
  return path.join(dir, TRACE_FILE);
}

function recordTrace(trace, options = {}) {
  const entry = {
    traceId: trace.traceId,
    timestamp: trace.timestamp,
    allowed: trace.allowed,
    counts: trace.counts,
    blocked: trace.blocked.map(summarizeResult),
    nearMisses: trace.nearMisses.map(summarizeResult),
    context: trace.context,
  };
  appendJsonl(getTracePath(options), entry);
  return entry;
}

function loadTraces(options = {}) {
  return readJsonl(getTracePath(options));
}

function summarizeResult(r) {
  return {
    specName: r.specName,
    id: r.constraintId || r.invariantId,
    type: r.type,
    reason: r.reason,
    severity: r.severity,
    nearMissScore: r.nearMissScore || 0,
  };
}

// ---------------------------------------------------------------------------
// Session Trace Summary
// ---------------------------------------------------------------------------

/**
 * Summarize all traces from a session into a single-glance safety posture.
 */
function summarizeSessionTraces(traces) {
  let totalEvaluations = traces.length;
  let totalChecks = 0;
  let totalBlocked = 0;
  let totalNearMisses = 0;
  let totalPassed = 0;

  const blocksBySpec = new Map();
  const blocksByConstraint = new Map();
  const nearMissByConstraint = new Map();

  for (const trace of traces) {
    const counts = trace.counts || {};
    totalChecks += counts.total || 0;
    totalBlocked += counts.blocked || 0;
    totalNearMisses += counts.nearMiss || 0;
    totalPassed += counts.passed || 0;

    for (const block of trace.blocked || []) {
      const specKey = block.specName || 'unknown';
      blocksBySpec.set(specKey, (blocksBySpec.get(specKey) || 0) + 1);
      const cKey = block.id || 'unknown';
      blocksByConstraint.set(cKey, (blocksByConstraint.get(cKey) || 0) + 1);
    }

    for (const nm of trace.nearMisses || []) {
      const cKey = nm.id || 'unknown';
      const existing = nearMissByConstraint.get(cKey) || { count: 0, maxScore: 0 };
      existing.count += 1;
      existing.maxScore = Math.max(existing.maxScore, nm.nearMissScore || 0);
      nearMissByConstraint.set(cKey, existing);
    }
  }

  return {
    totalEvaluations,
    totalChecks,
    totalBlocked,
    totalNearMisses,
    totalPassed,
    blockRate: totalChecks > 0 ? Math.round((totalBlocked / totalChecks) * 100) : 0,
    nearMissRate: totalChecks > 0 ? Math.round((totalNearMisses / totalChecks) * 100) : 0,
    safetyPosture: computeSafetyPosture(totalBlocked, totalNearMisses, totalChecks),
    topBlockedSpecs: mapToSorted(blocksBySpec, 'name', 'count'),
    topBlockedConstraints: mapToSorted(blocksByConstraint, 'id', 'count'),
    topNearMisses: Array.from(nearMissByConstraint.entries())
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 10)
      .map(([id, data]) => ({ id, count: data.count, maxScore: data.maxScore })),
  };
}

/**
 * Format a trace summary as human-readable text.
 */
function formatTraceSummary(summary) {
  const lines = [];
  lines.push(`Safety Posture: ${summary.safetyPosture.toUpperCase()}`);
  lines.push(`Evaluations: ${summary.totalEvaluations} | Checks: ${summary.totalChecks}`);
  lines.push(`Blocked: ${summary.totalBlocked} (${summary.blockRate}%) | Near-Misses: ${summary.totalNearMisses} (${summary.nearMissRate}%) | Passed: ${summary.totalPassed}`);

  if (summary.topBlockedConstraints.length > 0) {
    lines.push('');
    lines.push('Top Blocked:');
    for (const c of summary.topBlockedConstraints) {
      lines.push(`  - ${c.id}: ${c.count}x`);
    }
  }

  if (summary.topNearMisses.length > 0) {
    lines.push('');
    lines.push('Top Near-Misses:');
    for (const nm of summary.topNearMisses) {
      lines.push(`  - ${nm.id}: ${nm.count}x (max score: ${nm.maxScore})`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeSafetyPosture(blocked, nearMisses, total) {
  if (total === 0) return 'unknown';
  if (blocked > 0) return 'critical';
  if (nearMisses > 0) return 'cautious';
  return 'clean';
}

function mapToSorted(map, keyName, valueName) {
  return Array.from(map.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([k, v]) => ({ [keyName]: k, [valueName]: v }));
}

function truncate(value, maxLength) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function isCliInvocation(argv = process.argv) {
  const invokedPath = argv[1];
  return invokedPath ? path.resolve(invokedPath) === __filename : false;
}

if (isCliInvocation()) {
  const command = process.argv[2] || 'summary';

  if (command === 'summary') {
    const traces = loadTraces();
    const summary = summarizeSessionTraces(traces);
    console.log(formatTraceSummary(summary));
  } else if (command === 'json') {
    const traces = loadTraces();
    const summary = summarizeSessionTraces(traces);
    console.log(JSON.stringify(summary, null, 2));
  } else if (command === 'eval') {
    // Evaluate current specs against a test command
    const testCommand = process.argv[3] || '';
    const specs = loadSpecDir();
    const trace = traceEvaluation(specs, { command: testCommand, action: testCommand });
    console.log(JSON.stringify({
      allowed: trace.allowed,
      counts: trace.counts,
      blocked: trace.blocked.map(summarizeResult),
      nearMisses: trace.nearMisses.map(summarizeResult),
    }, null, 2));
  } else {
    console.error(`Unknown command: ${command}. Use: summary, json, eval`);
    process.exit(1);
  }
}

module.exports = {
  NEAR_MISS_THRESHOLD,
  computeNearMiss,
  extractLiteralTokens,
  formatTraceSummary,
  loadTraces,
  recordTrace,
  summarizeSessionTraces,
  traceEvaluation,
};
