#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { computeToolKpis, getAtRiskTools } = require('./tool-kpi-tracker');
const { deliver } = require('./webhook-delivery');
const { resolveFeedbackDir } = require('./feedback-paths');

// Agentic tool-hop latency wall (Akamai State of AI Inference 2026): most critical
// use cases need ≤500ms end-to-end; many need ≤250ms. More GPUs do not fix
// CPU/tool hops — budget each hop and fail closed when p95 exceeds the tier.
const AGENTIC_HOP_LATENCY_BUDGETS_MS = Object.freeze({
  'read-only': 250,
  'minimal-impact': 250,
  'contained-write': 500,
  critical: 1000,
  default: 500,
});

const DEFAULT_SLOS = {
  successRate: 90,
  // Matches Akamai's published agentic 500ms wall for generic tool hops.
  p95LatencyMs: AGENTIC_HOP_LATENCY_BUDGETS_MS.default,
  minCallsForAlert: 3,
};

function getAlertLogPath() {
  return path.join(resolveFeedbackDir(), 'slo-alerts.jsonl');
}

function hopLatencyBudgetMs(writeRiskTier) {
  if (writeRiskTier && Object.prototype.hasOwnProperty.call(AGENTIC_HOP_LATENCY_BUDGETS_MS, writeRiskTier)) {
    return AGENTIC_HOP_LATENCY_BUDGETS_MS[writeRiskTier];
  }
  return AGENTIC_HOP_LATENCY_BUDGETS_MS.default;
}

/**
 * Evaluate per-tool p95 against WriteGuard-tier hop budgets.
 * Measures the hop chain ThumbGate actually sees (tool KPI), not tokens/sec.
 */
function checkHopLatencyBudgets({
  periodHours = 24,
  feedbackDir,
  minCalls = DEFAULT_SLOS.minCallsForAlert,
  budgets = AGENTIC_HOP_LATENCY_BUDGETS_MS,
} = {}) {
  const { tools, totalCalls, evidenceStatus } = computeToolKpis({ periodHours, feedbackDir });
  const evaluated = tools
    .filter((tool) => tool.requestCount >= minCalls)
    .map((tool) => {
      const budgetMs = hopLatencyBudgetMs(tool.writeRiskTier);
      const withinBudget = tool.p95 <= budgetMs;
      return {
        toolName: tool.toolName,
        writeRiskTier: tool.writeRiskTier || null,
        requestCount: tool.requestCount,
        p95: tool.p95,
        budgetMs,
        withinBudget,
        overBudgetMs: withinBudget ? 0 : tool.p95 - budgetMs,
      };
    });
  const violations = evaluated.filter((tool) => !tool.withinBudget);
  return {
    wallMs: budgets.default || AGENTIC_HOP_LATENCY_BUDGETS_MS.default,
    budgets: { ...AGENTIC_HOP_LATENCY_BUDGETS_MS, ...budgets },
    periodHours,
    totalCalls,
    evidenceStatus,
    tools: evaluated,
    violations,
    violationCount: violations.length,
    checkedAt: new Date().toISOString(),
  };
}

function checkSloViolations({ slos, periodHours = 24, feedbackDir } = {}) {
  const t = { ...DEFAULT_SLOS, ...slos };
  const atRisk = getAtRiskTools({
    successRateThreshold: t.successRate,
    p95Threshold: t.p95LatencyMs,
    periodHours,
    feedbackDir,
  });
  const hopBudgets = checkHopLatencyBudgets({
    periodHours,
    feedbackDir,
    minCalls: t.minCallsForAlert,
  });
  const byName = new Map(atRisk.map((tool) => [tool.toolName, { ...tool, reasons: [] }]));

  for (const tool of atRisk) {
    const entry = byName.get(tool.toolName);
    if (tool.successRate < t.successRate) {
      entry.reasons.push(`success rate ${tool.successRate}% < ${t.successRate}% SLO`);
    }
    if (tool.p95 > t.p95LatencyMs) {
      entry.reasons.push(`P95 ${tool.p95}ms > ${t.p95LatencyMs}ms SLO`);
    }
  }

  for (const hop of hopBudgets.violations) {
    if (!byName.has(hop.toolName)) {
      byName.set(hop.toolName, {
        toolName: hop.toolName,
        requestCount: hop.requestCount,
        successRate: null,
        p95: hop.p95,
        writeRiskTier: hop.writeRiskTier,
        reasons: [],
      });
    }
    const entry = byName.get(hop.toolName);
    entry.writeRiskTier = hop.writeRiskTier;
    entry.budgetMs = hop.budgetMs;
    entry.reasons.push(
      `hop P95 ${hop.p95}ms > ${hop.budgetMs}ms ${hop.writeRiskTier || 'default'} budget`,
    );
  }

  const violations = [...byName.values()]
    .filter((tool) => tool.reasons.length > 0)
    .map((tool) => ({
      ...tool,
      severity: (tool.successRate != null && tool.successRate < 70) ? 'critical' : 'warning',
    }));

  return {
    thresholds: t,
    periodHours,
    hopBudgets,
    violations,
    violationCount: violations.length,
    checkedAt: new Date().toISOString(),
  };
}

function logAlert(alert) {
  const lp = getAlertLogPath();
  const dir = path.dirname(lp);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(lp, `${JSON.stringify({ ...alert, loggedAt: new Date().toISOString() })}\n`);
}

async function runSloCheck({ slos, periodHours = 24, platform, webhookUrl } = {}) {
  const result = checkSloViolations({ slos, periodHours });
  if (result.violationCount > 0) {
    logAlert(result);
    if (platform && webhookUrl) {
      const title = `ThumbGate SLO Alert — ${result.violationCount} violation(s)`;
      const lines = result.violations.map((v) => `- ${v.toolName}: ${v.reasons.join(', ')} [${v.severity}]`);
      await deliver(platform, webhookUrl, title, lines.join('\n'));
    }
  }
  return result;
}

function formatSloSection(r) {
  if (!r || r.violationCount === 0) return '';
  const lines = ['', 'SLO Violations:'];
  for (const v of r.violations) {
    lines.push(`  - [${v.severity.toUpperCase()}] ${v.toolName}: ${v.reasons.join('; ')} (${v.requestCount} calls)`);
  }
  return lines.join('\n');
}

module.exports = {
  AGENTIC_HOP_LATENCY_BUDGETS_MS,
  DEFAULT_SLOS,
  checkHopLatencyBudgets,
  checkSloViolations,
  formatSloSection,
  getAlertLogPath,
  hopLatencyBudgetMs,
  logAlert,
  runSloCheck,
};
