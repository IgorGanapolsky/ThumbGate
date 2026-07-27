#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { resolveFeedbackDir } = require('./feedback-paths');
const { readJsonl } = require('./fs-utils');

function getKpiLogPath(options = {}) {
  return path.join(
    options.feedbackDir ? path.resolve(options.feedbackDir) : resolveFeedbackDir(),
    'tool-kpi.jsonl',
  );
}

function recordToolCall({
  toolName,
  serverName,
  latencyMs,
  success,
  agentId,
  metadata,
  feedbackDir,
} = {}) {
  const logPath = getKpiLogPath({ feedbackDir });
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const entry = {
    id: `kpi_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    timestamp: new Date().toISOString(),
    toolName: toolName || 'unknown',
    serverName: serverName || 'default',
    latencyMs: typeof latencyMs === 'number' ? latencyMs : 0,
    success: success !== false,
    agentId: agentId || 'unknown',
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

function computeToolKpis({ periodHours = 24, feedbackDir } = {}) {
  const entries = readJsonl(getKpiLogPath({ feedbackDir }));
  const cutoff = Date.now() - periodHours * 60 * 60 * 1000;
  const recent = entries.filter((entry) => new Date(entry.timestamp).getTime() > cutoff);
  const byTool = {};
  for (const entry of recent) {
    const key = entry.toolName;
    if (!byTool[key]) {
      byTool[key] = {
        toolName: key,
        calls: [],
        successes: 0,
        failures: 0,
      };
    }
    byTool[key].calls.push(entry.latencyMs);
    if (entry.success) byTool[key].successes += 1;
    else byTool[key].failures += 1;
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
      };
    })
    .sort((left, right) => right.requestCount - left.requestCount);

  const byServer = {};
  for (const entry of recent) {
    const key = entry.serverName;
    if (!byServer[key]) byServer[key] = { serverName: key, total: 0, successes: 0 };
    byServer[key].total += 1;
    if (entry.success) byServer[key].successes += 1;
  }
  const servers = Object.values(byServer).map((server) => ({
    serverName: server.serverName,
    totalCalls: server.total,
    successRate: server.total > 0
      ? Math.round((server.successes / server.total) * 1000) / 10
      : 100,
  }));
  return {
    periodHours,
    totalCalls: recent.length,
    evidenceStatus: recent.length > 0 ? 'measured' : 'insufficient_evidence',
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
  computeToolKpis,
  getAtRiskTools,
  getKpiLogPath,
  percentile,
  recordToolCall,
};
