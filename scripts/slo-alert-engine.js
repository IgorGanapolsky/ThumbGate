#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { computeToolKpis, getAtRiskTools } = require('./tool-kpi-tracker');
const { deliver } = require('./webhook-delivery');
const { resolveFeedbackDir } = require('./feedback-paths');
const DEFAULT_SLOS = { successRate: 90, p95LatencyMs: 500, minCallsForAlert: 3 };
function getAlertLogPath() { return path.join(resolveFeedbackDir(), 'slo-alerts.jsonl'); }
function checkSloViolations({ slos, periodHours = 24 } = {}) { const t = { ...DEFAULT_SLOS, ...slos }; const atRisk = getAtRiskTools({ successRateThreshold: t.successRate, p95Threshold: t.p95LatencyMs, periodHours }); const violations = atRisk.map((tool) => { const reasons = []; if (tool.successRate < t.successRate) reasons.push(`success rate ${tool.successRate}% < ${t.successRate}% SLO`); if (tool.p95 > t.p95LatencyMs) reasons.push(`P95 ${tool.p95}ms > ${t.p95LatencyMs}ms SLO`); return { toolName: tool.toolName, ...tool, reasons, severity: tool.successRate < 70 ? 'critical' : 'warning' }; }); return { thresholds: t, periodHours, violations, violationCount: violations.length, checkedAt: new Date().toISOString() }; }
function logAlert(alert) { const lp = getAlertLogPath(); const dir = path.dirname(lp); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(lp, JSON.stringify({ ...alert, loggedAt: new Date().toISOString() }) + '\n'); }
async function runSloCheck({ slos, periodHours = 24, platform, webhookUrl } = {}) { const result = checkSloViolations({ slos, periodHours }); if (result.violationCount > 0) { logAlert(result); if (platform && webhookUrl) { const title = `ThumbGate SLO Alert — ${result.violationCount} violation(s)`; const lines = result.violations.map((v) => `- ${v.toolName}: ${v.reasons.join(', ')} [${v.severity}]`); await deliver(platform, webhookUrl, title, lines.join('\n')); } } return result; }
function formatSloSection(r) { if (!r || r.violationCount === 0) return ''; const lines = ['', 'SLO Violations:']; for (const v of r.violations) lines.push(`  - [${v.severity.toUpperCase()}] ${v.toolName}: ${v.reasons.join('; ')} (${v.requestCount} calls)`); return lines.join('\n'); }
module.exports = { DEFAULT_SLOS, checkSloViolations, runSloCheck, formatSloSection, logAlert, getAlertLogPath };
