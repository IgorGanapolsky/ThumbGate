#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { resolveFeedbackDir } = require('./feedback-paths');
const { readJsonl } = require('./fs-utils');

const TOOL_CALL_OUTCOMES = Object.freeze({
  SUCCESSFUL: 'successful',
  FAILED: 'failed',
  BLOCKED: 'blocked',
});

function getKpiLogPath(options = {}) {
  return path.join(
    options.feedbackDir ? path.resolve(options.feedbackDir) : resolveFeedbackDir(),
    'tool-kpi.jsonl',
  );
}

/**
 * WriteGuard-aligned outcome taxonomy for every MCP attempt.
 * Prefer explicit `outcome`; otherwise derive from blocked/denied/success.
 */
function normalizeToolCallOutcome({
  outcome,
  success,
  blocked,
  metadata,
} = {}) {
  if (
    outcome === TOOL_CALL_OUTCOMES.SUCCESSFUL
    || outcome === TOOL_CALL_OUTCOMES.FAILED
    || outcome === TOOL_CALL_OUTCOMES.BLOCKED
  ) {
    return outcome;
  }
  if (
    blocked === true
    || metadata?.denied === true
    || metadata?.outcome === TOOL_CALL_OUTCOMES.BLOCKED
  ) {
    return TOOL_CALL_OUTCOMES.BLOCKED;
  }
  if (success === false) return TOOL_CALL_OUTCOMES.FAILED;
  return TOOL_CALL_OUTCOMES.SUCCESSFUL;
}

function recordToolCall({
  toolName,
  serverName,
  latencyMs,
  success,
  blocked,
  outcome,
  agentId,
  clientId,
  sessionId,
  writeRiskTier,
  metadata,
  feedbackDir,
} = {}) {
  const logPath = getKpiLogPath({ feedbackDir });
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const normalizedOutcome = normalizeToolCallOutcome({
    outcome,
    success,
    blocked,
    metadata,
  });
  const entry = {
    id: `kpi_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    timestamp: new Date().toISOString(),
    toolName: toolName || 'unknown',
    serverName: serverName || 'default',
    latencyMs: typeof latencyMs === 'number' ? latencyMs : 0,
    // Backward-compatible boolean: blocked and failed are both non-success.
    success: normalizedOutcome === TOOL_CALL_OUTCOMES.SUCCESSFUL,
    outcome: normalizedOutcome,
    agentId: agentId || 'unknown',
    clientId: clientId || metadata?.clientId || null,
    sessionId: sessionId || metadata?.sessionId || null,
    writeRiskTier: writeRiskTier || metadata?.writeRiskTier || null,
    metadata: metadata || {},
  };
  fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
  return entry;
}

function percentile(sorted, quantile) {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((quantile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

function emptyOutcomeCounts() {
  return {
    successful: 0,
    failed: 0,
    blocked: 0,
  };
}

function pickDominantTier(tierCounts = {}) {
  let best = null;
  let bestCount = 0;
  for (const [tier, count] of Object.entries(tierCounts)) {
    if (count > bestCount) {
      best = tier;
      bestCount = count;
    }
  }
  return best;
}

function computeToolKpis({ periodHours = 24, feedbackDir } = {}) {
  const entries = readJsonl(getKpiLogPath({ feedbackDir }));
  const cutoff = Date.now() - periodHours * 60 * 60 * 1000;
  const recent = entries.filter((entry) => new Date(entry.timestamp).getTime() > cutoff);
  const byTool = {};
  const outcomes = emptyOutcomeCounts();
  for (const entry of recent) {
    const key = entry.toolName;
    if (!byTool[key]) {
      byTool[key] = {
        toolName: key,
        calls: [],
        successes: 0,
        failures: 0,
        blocked: 0,
        outcomes: emptyOutcomeCounts(),
        tierCounts: {},
      };
    }
    byTool[key].calls.push(entry.latencyMs);
    const tier = entry.writeRiskTier || entry.metadata?.writeRiskTier || null;
    if (tier) {
      byTool[key].tierCounts[tier] = (byTool[key].tierCounts[tier] || 0) + 1;
    }
    const normalized = normalizeToolCallOutcome(entry);
    byTool[key].outcomes[normalized] += 1;
    outcomes[normalized] += 1;
    if (normalized === TOOL_CALL_OUTCOMES.SUCCESSFUL) {
      byTool[key].successes += 1;
    } else if (normalized === TOOL_CALL_OUTCOMES.BLOCKED) {
      byTool[key].blocked += 1;
      byTool[key].failures += 1;
    } else {
      byTool[key].failures += 1;
    }
  }
  const tools = Object.values(byTool)
    .map((tool) => {
      const sorted = tool.calls.slice().sort((left, right) => left - right);
      const total = tool.successes + tool.failures;
      return {
        toolName: tool.toolName,
        requestCount: total,
        successRate: total > 0 ? Math.round((tool.successes / total) * 1000) / 10 : 100,
        p50: Math.round(percentile(sorted, 50)),
        p90: Math.round(percentile(sorted, 90)),
        p95: Math.round(percentile(sorted, 95)),
        successes: tool.successes,
        failures: tool.failures,
        blocked: tool.blocked,
        outcomes: tool.outcomes,
        writeRiskTier: pickDominantTier(tool.tierCounts),
      };
    })
    .sort((left, right) => right.requestCount - left.requestCount);

  const byServer = {};
  for (const entry of recent) {
    const key = entry.serverName;
    if (!byServer[key]) {
      byServer[key] = {
        serverName: key,
        total: 0,
        successes: 0,
        outcomes: emptyOutcomeCounts(),
      };
    }
    byServer[key].total += 1;
    const normalized = normalizeToolCallOutcome(entry);
    byServer[key].outcomes[normalized] += 1;
    if (normalized === TOOL_CALL_OUTCOMES.SUCCESSFUL) byServer[key].successes += 1;
  }
  const servers = Object.values(byServer).map((server) => ({
    serverName: server.serverName,
    totalCalls: server.total,
    successRate: server.total > 0
      ? Math.round((server.successes / server.total) * 1000) / 10
      : 100,
    outcomes: server.outcomes,
  }));
  return {
    periodHours,
    totalCalls: recent.length,
    evidenceStatus: recent.length > 0 ? 'measured' : 'insufficient_evidence',
    outcomes,
    tools,
    servers,
  };
}

function getAtRiskTools({
  successRateThreshold = 90,
  p95Threshold = 500,
  periodHours = 24,
  feedbackDir,
} = {}) {
  const { tools } = computeToolKpis({ periodHours, feedbackDir });
  return tools.filter((tool) => tool.requestCount >= 3
    && (tool.successRate < successRateThreshold || tool.p95 > p95Threshold));
}

module.exports = {
  TOOL_CALL_OUTCOMES,
  computeToolKpis,
  getAtRiskTools,
  getKpiLogPath,
  normalizeToolCallOutcome,
  percentile,
  recordToolCall,
};
